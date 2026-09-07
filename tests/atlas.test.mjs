// What the browser is about to trust.
//
// The viewer reads typed arrays straight out of a region's buffer at the byte
// offsets the manifest gives, and an offset that is wrong by four bytes is a
// blank screen with nothing in the console to say why. These checks read the
// same manifest the same way and assert that every window it describes lands
// inside its file, is aligned for its element type, and holds indices that
// point at vertices that exist.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const ROOT = join(import.meta.dirname, "..");
const atlas = JSON.parse(readFileSync(join(ROOT, "public", "models", "atlas.json"), "utf8"));

test("the manifest describes twelve regions of one specimen", () => {
  assert.equal(atlas.regions.length, 12);
  assert.equal(atlas.specimen.taxon, "Felis catus");
  const ids = atlas.regions.map((region) => region.id);
  assert.equal(new Set(ids).size, ids.length, "region ids repeat");
  for (const region of atlas.regions) {
    assert.match(region.media, /^\d{9}$/, `${region.id}: media id is not a MorphoSource id`);
    assert.ok(region.triangles > 0 && region.triangles <= atlas.budget);
  }
});

test("every buffer window lands inside its file, aligned", () => {
  for (const region of atlas.regions) {
    const path = join(ROOT, "public", region.buffer.replace(/^\//, ""));
    const bytes = statSync(path).size;
    assert.equal(bytes, region.bufferBytes, `${region.id}: file size is not what the manifest says`);
    const windows = [
      ["positions", region.positions, region.vertexCount * 3 * 4, 4],
      ["normals", region.normals, region.vertexCount * 3 * 2, 2],
      ["indices", region.indices, region.indexCount * 4, 4],
    ];
    for (const [field, offset, length, alignment] of windows) {
      assert.equal(offset % alignment, 0, `${region.id}: ${field} is not ${alignment} byte aligned`);
      assert.ok(offset >= 0 && offset + length <= bytes, `${region.id}: ${field} runs past the file`);
    }
    assert.equal(region.indexCount % 3, 0, `${region.id}: indices do not make whole triangles`);
    assert.equal(region.indexCount / 3, region.triangles);
  }
});

test("no index points past its own vertex count, and no position is adrift", () => {
  for (const region of atlas.regions) {
    const file = readFileSync(join(ROOT, "public", region.buffer.replace(/^\//, "")));
    const indices = new Uint32Array(
      file.buffer.slice(file.byteOffset + region.indices, file.byteOffset + region.indices + region.indexCount * 4),
    );
    let highest = 0;
    for (const index of indices) if (index > highest) highest = index;
    assert.ok(highest < region.vertexCount, `${region.id}: an index points past the vertices`);

    const positions = new Float32Array(
      file.buffer.slice(
        file.byteOffset + region.positions,
        file.byteOffset + region.positions + region.vertexCount * 12,
      ),
    );
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    for (let at = 0; at < positions.length; at++) {
      assert.ok(Number.isFinite(positions[at]), `${region.id}: a position is not a number`);
      const axis = at % 3;
      low[axis] = Math.min(low[axis], positions[at]);
      high[axis] = Math.max(high[axis], positions[at]);
    }
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(
        Math.abs(low[axis] - region.bounds[0][axis]) < 0.01 &&
          Math.abs(high[axis] - region.bounds[1][axis]) < 0.01,
        `${region.id}: the manifest bounds do not match the buffer on axis ${axis}`,
      );
      // Each region is centered on its own bounding box, so the two ends of
      // every axis are the same distance from zero.
      assert.ok(
        Math.abs(low[axis] + high[axis]) < 0.01,
        `${region.id}: axis ${axis} is not centered`,
      );
    }
  }
});

test("the slice sheet holds as many tiles as the volume has slices", () => {
  for (const region of atlas.regions) {
    const [width, height, depth] = region.volume.dims;
    const [columns, rows] = region.volume.tiles;
    assert.ok(columns * rows >= depth, `${region.id}: the sheet has fewer tiles than slices`);
    assert.ok((columns - 1) * rows < depth, `${region.id}: the sheet has a wasted column`);
    assert.ok(width > 0 && height > 0 && depth > 0);
    const bytes = statSync(join(ROOT, "public", region.volume.sheet.replace(/^\//, ""))).size;
    assert.equal(bytes, region.volume.bytes, `${region.id}: the sheet is not the size claimed`);
  }
});

test("landmarks sit on the surface they name", () => {
  const head = atlas.regions.find((region) => region.id === "head");
  assert.ok(head.landmarks.length >= 12, "the head should carry the landmark set");
  for (const region of atlas.regions) {
    for (const landmark of region.landmarks ?? []) {
      assert.ok(landmark.name && landmark.note, `${region.id}: a landmark has no text`);
      // Each point is lifted off the surface along its normal, so one on the
      // outermost vertex of an axis sits just past the bounding box.
      const lift = 2;
      for (let axis = 0; axis < 3; axis++)
        assert.ok(
          landmark.position[axis] >= region.bounds[0][axis] - lift &&
            landmark.position[axis] <= region.bounds[1][axis] + lift,
          `${region.id}: ${landmark.short} is outside the region`,
        );
      // Every point is snapped onto a mesh vertex, so the distance it moved is
      // how far the placement was from the surface to begin with.
      assert.ok(
        landmark.snappedBy < 10,
        `${region.id}: ${landmark.short} was placed ${landmark.snappedBy} mm off the surface`,
      );
    }
  }
});

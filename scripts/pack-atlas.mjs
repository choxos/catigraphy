// Decimate the extracted surfaces and pack them for the browser.
//
// scripts/extract-ct.py writes one raw surface per region, straight off
// marching cubes, at a few million triangles each. Nothing that size crosses a
// network, so every region is collapsed to a budget here and written as its
// own buffer: a reader who opens the skull downloads the skull.
//
// Positions are millimeters, centered on the region's own bounding box. There
// is no shared coordinate system to center them in: the twelve series were
// acquired independently and every one of them starts at its own origin.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { MeshoptSimplifier } from "meshoptimizer";

const ROOT = resolve(import.meta.dirname, "..");
const BUILD = join(ROOT, "build");
const MODELS = join(ROOT, "public", "models");
const VOLUMES = join(ROOT, "public", "volumes");

// Triangles kept per region. A cat skull at this budget still resolves the
// infraorbital foramen and the cusps of the carnassial; past it the file grows
// faster than the surface improves.
const BUDGET = 320_000;
// Meshopt stops here rather than reaching the budget through visible error.
const TOLERANCE = 0.02;

/** How a region's own voxel axes map onto the viewer's. Slice, row and column
 *  are axes 0, 1 and 2 of the extracted mesh; the rows below say which viewer
 *  axis each one becomes and which way round. Read off the orthographic
 *  previews in build/, one region at a time. Identity means the scan already
 *  sits with its long axis across, dorsal up. */
const ORIENTATION = JSON.parse(readFileSync(join(import.meta.dirname, "orientation.json"), "utf8"));

/** Named points on the surface, in the same raw scan millimeters the meshes
 *  arrive in. They go through the region's orientation and centering here, and
 *  then onto the nearest vertex of the decimated mesh, so a coordinate read off
 *  an orthographic preview ends up on the surface rather than floating inside
 *  it or hovering outside. */
const LANDMARKS = JSON.parse(readFileSync(join(import.meta.dirname, "landmarks.json"), "utf8"));

function readMesh(path) {
  const bytes = readFileSync(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vertexCount = view.getUint32(0, true);
  const indexCount = view.getUint32(4, true);
  const positions = new Float32Array(
    bytes.buffer.slice(bytes.byteOffset + 8, bytes.byteOffset + 8 + vertexCount * 12),
  );
  const start = bytes.byteOffset + 8 + vertexCount * 12;
  const indices = new Uint32Array(bytes.buffer.slice(start, start + indexCount * 4));
  assert.equal(positions.length, vertexCount * 3, `${path}: truncated positions`);
  assert.equal(indices.length, indexCount, `${path}: truncated indices`);
  return { positions, indices };
}

/** Collapse to the triangle budget and report the error meshopt allowed. */
async function simplify(positions, indices, budget) {
  if (indices.length / 3 <= budget) return { indices, error: 0 };
  await MeshoptSimplifier.ready;
  const [kept, error] = MeshoptSimplifier.simplify(
    indices,
    positions,
    3,
    budget * 3,
    TOLERANCE,
    ["LockBorder"],
  );
  return { indices: kept, error };
}

/** Reverse every triangle's winding.
 *
 *  Marching cubes winds its output so that the front face is the one seen from
 *  inside the solid. A viewer lighting the outside of a bone wants the
 *  opposite, and the normals written beside these indices are the outward ones,
 *  so the winding has to agree with them or every surface is lit from within.
 */
function flip(indices) {
  for (let at = 0; at < indices.length; at += 3) {
    const swap = indices[at + 1];
    indices[at + 1] = indices[at + 2];
    indices[at + 2] = swap;
  }
  return indices;
}

/** Drop the vertices no surviving triangle refers to, and renumber. */
function compact(positions, indices) {
  const moved = new Int32Array(positions.length / 3).fill(-1);
  const kept = [];
  const out = new Uint32Array(indices.length);
  for (let at = 0; at < indices.length; at++) {
    const from = indices[at];
    if (moved[from] < 0) {
      moved[from] = kept.length;
      kept.push(from);
    }
    out[at] = moved[from];
  }
  const packed = new Float32Array(kept.length * 3);
  for (let at = 0; at < kept.length; at++)
    packed.set(positions.subarray(kept[at] * 3, kept[at] * 3 + 3), at * 3);
  return { positions: packed, indices: out };
}

/** Place the region in the viewer's axes, in millimeters, centered on itself.
 *  The rows of `orient` are the viewer's x, y and z written in the scan's own
 *  slice, row and column axes. */
function place(point, rows) {
  return rows.map((row) => {
    const source = row.findIndex((value) => value !== 0);
    return point[source] * row[source];
  });
}

function orient(positions, rows) {
  const out = new Float32Array(positions.length);
  for (let at = 0; at < positions.length; at += 3)
    out.set(place([positions[at], positions[at + 1], positions[at + 2]], rows), at);
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at < out.length; at++) {
    const axis = at % 3;
    if (out[at] < low[axis]) low[axis] = out[at];
    if (out[at] > high[axis]) high[axis] = out[at];
  }
  const center = low.map((value, axis) => (value + high[axis]) / 2);
  for (let at = 0; at < out.length; at++) out[at] -= center[at % 3];
  return {
    positions: out,
    center,
    bounds: [low.map((value, axis) => value - center[axis]), high.map((value, axis) => value - center[axis])],
    size: high.map((value, axis) => value - low[axis]),
  };
}

/** Area weighted vertex normals, quantized. A normal is a direction, so
 *  sixteen bits of it is more than a screen can show. */
function normalsFor(positions, indices) {
  const accumulated = new Float32Array(positions.length);
  for (let at = 0; at < indices.length; at += 3) {
    const [a, b, c] = [indices[at] * 3, indices[at + 1] * 3, indices[at + 2] * 3];
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    // Not normalized: the cross product's length is twice the triangle's area,
    // which is the weight a vertex normal wants anyway. The winding was
    // reversed above, so this already points out of the bone.
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const corner of [a, b, c]) {
      accumulated[corner] += nx;
      accumulated[corner + 1] += ny;
      accumulated[corner + 2] += nz;
    }
  }
  const out = new Int16Array(positions.length);
  for (let at = 0; at < accumulated.length; at += 3) {
    const length = Math.hypot(accumulated[at], accumulated[at + 1], accumulated[at + 2]) || 1;
    for (let axis = 0; axis < 3; axis++)
      out[at + axis] = Math.max(-32767, Math.round((accumulated[at + axis] / length) * 32767));
  }
  return out;
}

const built = JSON.parse(readFileSync(join(BUILD, "regions-built.json"), "utf8"));
mkdirSync(MODELS, { recursive: true });
mkdirSync(VOLUMES, { recursive: true });

const regions = [];
for (const record of built.regions) {
  const raw = readMesh(join(BUILD, record.meshes.bone.file));
  const reduced = await simplify(raw.positions, raw.indices, BUDGET);
  const packed = compact(raw.positions, flip(reduced.indices));
  const rows = ORIENTATION[record.id] ?? [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const placed = orient(packed.positions, rows);
  const normals = normalsFor(placed.positions, packed.indices);
  for (const index of packed.indices)
    assert(index < placed.positions.length / 3, `${record.id}: index past the vertex count`);

  // Snap each named point onto the nearest surviving vertex. Brute force over
  // a few hundred thousand vertices, a handful of times, is not worth an index.
  const landmarks = (LANDMARKS[record.id] ?? []).map((landmark) => {
    // Lifted this far off the surface, so the marker reads as sitting on the
    // bone rather than fighting it for the same pixels.
    const lift = 1.6;
    const wanted = place(landmark.position, rows).map((value, axis) => value - placed.center[axis]);
    let best = 0;
    let nearest = Infinity;
    for (let vertex = 0; vertex < placed.positions.length / 3; vertex++) {
      const distance =
        (placed.positions[vertex * 3] - wanted[0]) ** 2 +
        (placed.positions[vertex * 3 + 1] - wanted[1]) ** 2 +
        (placed.positions[vertex * 3 + 2] - wanted[2]) ** 2;
      if (distance < nearest) {
        nearest = distance;
        best = vertex;
      }
    }
    return {
      short: landmark.short,
      name: landmark.name,
      note: landmark.note,
      position: [0, 1, 2].map((axis) =>
        Number(
          (placed.positions[best * 3 + axis] + (normals[best * 3 + axis] / 32767) * lift).toFixed(2),
        ),
      ),
      snappedBy: Number(Math.sqrt(nearest).toFixed(2)),
    };
  });

  const chunks = [];
  const offsets = {};
  let offset = 0;
  for (const [field, array] of [
    ["positions", placed.positions],
    ["normals", normals],
    ["indices", packed.indices],
  ]) {
    const padding = (4 - (offset % 4)) % 4;
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      offset += padding;
    }
    offsets[field] = offset;
    const buffer = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    chunks.push(buffer);
    offset += buffer.length;
  }
  writeFileSync(join(MODELS, `${record.id}.bin`), Buffer.concat(chunks));

  const slices = join(BUILD, record.volume.sheet);
  writeFileSync(join(VOLUMES, record.volume.sheet), readFileSync(slices));

  regions.push({
    id: record.id,
    name: record.name,
    group: record.group,
    series: record.series,
    media: record.media,
    buffer: `/models/${record.id}.bin`,
    bufferBytes: offset,
    ...offsets,
    vertexCount: placed.positions.length / 3,
    indexCount: packed.indices.length,
    sourceTriangles: record.meshes.bone.triangles,
    triangles: packed.indices.length / 3,
    simplifyError: Number(reduced.error.toFixed(5)),
    level: record.meshes.bone.level,
    voxel: record.voxel,
    sourceVoxel: record.sourceVoxel,
    bounds: placed.bounds.map((point) => point.map((value) => Number(value.toFixed(3)))),
    size: placed.size.map((value) => Number(value.toFixed(2))),
    orient: rows,
    landmarks,
    volume: {
      sheet: `/volumes/${record.volume.sheet}`,
      dims: record.volume.dims,
      tiles: record.volume.tiles,
      window: record.volume.window,
      voxel: record.volume.voxel,
      bytes: record.volume.bytes,
    },
  });
  console.log(
    `${record.id.padEnd(9)} ` +
      `${(packed.indices.length / 3 / 1000).toFixed(0)}k tri from ` +
      `${(record.meshes.bone.triangles / 1000).toFixed(0)}k, ` +
      `error ${reduced.error.toFixed(4)}, ${(offset / 1e6).toFixed(1)} MB mesh, ` +
      `${(record.volume.bytes / 1e6).toFixed(1)} MB slices, ` +
      `${placed.size.map((value) => value.toFixed(0)).join(" x ")} mm` +
      (landmarks.length
        ? `, ${landmarks.length} landmarks snapped by up to ` +
          `${Math.max(...landmarks.map((one) => one.snappedBy)).toFixed(1)} mm`
        : ""),
  );
}

writeFileSync(
  join(MODELS, "atlas.json"),
  JSON.stringify(
    {
      source: "MorphoSource",
      collection: "Scans of Carolina Biological Supply Specimens",
      specimen: built.specimen,
      scope:
        "Twelve independently acquired CT series of one disarticulated domestic cat. " +
        "The series share no coordinate system, so each is its own region and no " +
        "assembled skeleton is shown. Bones within a region are not separated from " +
        "one another.",
      budget: BUDGET,
      regions,
    },
    null,
    2,
  ),
);

const total = regions.reduce((sum, region) => sum + region.bufferBytes + region.volume.bytes, 0);
console.log(
  `\n${regions.length} regions, ${(regions.reduce((sum, r) => sum + r.triangles, 0) / 1e6).toFixed(2)}M triangles, ${(total / 1e6).toFixed(1)} MB total`,
);

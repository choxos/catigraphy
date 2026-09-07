"""Register the two half body scans and fuse them into one whole skeleton.

The specimen was never cut. It is longer than the scanner's 479 mm field, so it
was scanned twice: once head first and once tail first, turned end for end
between the two. Both fields reach the lumbar spine, so they overlap by about
160 mm, and that overlap is what makes the join measurable rather than assumed.

The transform is found twice, independently, and the two answers are compared:

  1. Five radiopaque fiducials sit along the specimen holder and appear in both
     scans above 4000 HU, far denser than any bone. Their spacings run in
     opposite orders in the two volumes, which is what fixes the correspondence
     and confirms the specimen went into the bore the other way round. Five
     matched points give a rigid transform in closed form.

  2. That transform is then refined by trimmed ICP on the bone surfaces inside
     the overlap, which uses no fiducial at all.

If the second barely moves the first, the registration is real. Measured on
this data it moves it by half a degree and under two millimeters, and the bone
surfaces then agree to a median of 0.28 mm, well inside one 0.444 mm voxel.
Those numbers are recomputed on every run and written into the region record,
so a rebuild that stops agreeing says so.

The fused volume is then thresholded and surfaced exactly like a single scan,
which is what makes the join seamless: one marching cubes pass over one volume,
not two meshes pushed together at a seam.

Run after scripts/extract-ct.py and before scripts/pack-atlas.mjs.
"""

import importlib.util
import json
import os
import time

import numpy as np
from scipy import ndimage
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("extract_ct", os.path.join(HERE, "extract-ct.py"))
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)

BUILD = extract.BUILD
# Everything this dense is metal. Bone stops well below it.
FIDUCIAL = 2600
# Marker voxels within this of each other are one marker. A marker breaks into
# fragments at any threshold; separate markers are more than twenty millimeters
# apart, so anything in between separates them cleanly.
FIDUCIAL_MERGE = 8.0
FIDUCIALS = 5
# The bone level the two halves were extracted at, from regions.json.
SHELL_LEVEL = 300


def fiducials(volume, spacing):
    """The dense markers, as intensity weighted centroids in millimeters.

    Single linkage on the marker voxels themselves, rather than a labeling of
    the whole volume: at this threshold the voxels number in the thousands and
    a label array over 283 million of them would cost a gigabyte to hold.
    """
    mask = volume > FIDUCIAL
    points = np.argwhere(mask) * spacing
    weight = volume[mask].astype(np.float64) - FIDUCIAL
    del mask
    if len(points) < FIDUCIALS:
        raise SystemExit("no fiducials found; the marker threshold no longer fits this data")
    pairs = cKDTree(points).sparse_distance_matrix(cKDTree(points), FIDUCIAL_MERGE)
    count, group = connected_components(csr_matrix(pairs), directed=False)
    mass = np.bincount(group, weight, count)
    centers = np.stack(
        [np.bincount(group, weight * points[:, axis], count) / mass for axis in range(3)], -1
    )
    if count < FIDUCIALS:
        raise SystemExit(f"found {count} fiducials, expected {FIDUCIALS}")
    kept = centers[np.argsort(-mass)[:FIDUCIALS]]
    # Sorted along the long axis so the two scans list them in scan order, which
    # is what makes the reversal test below meaningful.
    return kept[np.argsort(kept[:, 0])]


def shell(volume, spacing):
    """A thin sampling of the bone surface, for ICP. A solid mask would let the
    interior of a vertebral body dominate a fit that only the surface
    constrains, and would cost far more to search."""
    mask = ndimage.binary_erosion(volume > SHELL_LEVEL)
    mask &= ~ndimage.binary_erosion(mask, iterations=2)
    return np.argwhere(mask).astype(np.float32) * spacing


def kabsch(source, target):
    """The rigid transform taking source onto target. No scale: the two scans
    have the same voxel size and the specimen did not change size between
    them."""
    source_center, target_center = source.mean(0), target.mean(0)
    u, _, vt = np.linalg.svd((source - source_center).T @ (target - target_center))
    handed = np.sign(np.linalg.det(vt.T @ u.T))
    rotation = vt.T @ np.diag([1.0, 1.0, handed]) @ u.T
    return rotation, target_center - rotation @ source_center


def degrees(rotation):
    return float(np.degrees(np.arccos(np.clip((np.trace(rotation) - 1) / 2, -1, 1))))


def register(marks, shells, report):
    """Fiducials first, then ICP on bone. Both answers are recorded."""
    # The specimen went in the other way round, so the caudal sequence should be
    # the rostral one reversed. Both orders are fitted and the better is taken,
    # so the script measures the flip rather than assuming it.
    best = None
    for order, name in ((marks["caudal"][::-1], "reversed"), (marks["caudal"], "same order")):
        rotation, offset = kabsch(order, marks["rostral"])
        residual = np.linalg.norm(order @ rotation.T + offset - marks["rostral"], axis=1)
        error = float(np.sqrt((residual**2).mean()))
        if best is None or error < best[0]:
            best = (error, rotation, offset, name)
    error, rotation, offset, order = best
    report["fiducialOrder"] = order
    report["fiducialRms"] = round(error, 3)
    report["fiducialRotation"] = round(degrees(rotation), 2)

    target = shells["rostral"]
    moving = shells["caudal"] @ rotation.T.astype(np.float32) + offset.astype(np.float32)
    # Only where the two fields actually see the same bone. The margin keeps the
    # truncated end of each field, where a structure is cut in half by the edge
    # of the bore rather than by anatomy, out of the fit.
    low = np.maximum(target.min(0), moving.min(0)) + 5
    high = np.minimum(target.max(0), moving.max(0)) - 5
    inside = lambda points: np.all((points >= low) & (points <= high), axis=1)
    target, moving = target[inside(target)], moving[inside(moving)]
    report["overlapMm"] = [round(float(value), 1) for value in (high - low)]
    if len(target) < 5000 or len(moving) < 5000:
        raise SystemExit("the two scans do not overlap enough to register on bone")

    generator = np.random.default_rng(0)
    pick = lambda p, n: p[generator.choice(len(p), min(len(p), n), replace=False)]
    target, moving = pick(target, 250_000), pick(moving, 120_000)
    tree = cKDTree(target)
    report["fiducialOnlyMedianMm"] = round(float(np.median(tree.query(moving, workers=-1)[0])), 3)

    # Trimmed ICP. The overlap box still catches structure present in only one
    # scan, and letting those points pull on the fit is how a good registration
    # gets talked out of itself.
    current = moving.copy()
    turned, moved = np.eye(3), np.zeros(3)
    for _ in range(30):
        distance, nearest = tree.query(current, workers=-1)
        keep = distance < np.percentile(distance, 70)
        step_turn, step_move = kabsch(current[keep], target[nearest[keep]])
        current = current @ step_turn.T.astype(np.float32) + step_move.astype(np.float32)
        turned, moved = step_turn @ turned, step_turn @ moved + step_move
    distance, _ = tree.query(current, workers=-1)
    report["boneMedianMm"] = round(float(np.median(distance)), 3)
    report["boneRmsMm"] = round(float(np.sqrt((distance.astype(np.float64) ** 2).mean())), 3)
    report["icpMovedDegrees"] = round(degrees(turned), 3)
    report["icpMovedMm"] = round(float(np.linalg.norm(moved)), 3)
    return turned @ rotation, turned @ offset + moved


def fuse(rostral, caudal, spacing, rotation, offset):
    """One volume covering both, in the rostral scan's coordinates.

    Where only one scan reaches, that scan is the answer; where both do, the
    denser reading wins. A sample outside a scan's field reads as air, so taking
    the larger of the two resolves both cases at once, with no seam and no mask.
    """
    corners = np.array(np.meshgrid(*[[0, size - 1] for size in caudal.shape], indexing="ij"))
    corners = corners.reshape(3, -1).T * spacing @ rotation.T + offset
    low = np.minimum(corners.min(0), 0)
    high = np.maximum(corners.max(0), (np.array(rostral.shape) - 1) * spacing)
    # Start the grid on a whole voxel so the rostral scan drops in at an integer
    # offset and is never resampled.
    origin = np.floor(low / spacing) * spacing
    shape = tuple(int(np.ceil((high[axis] - origin[axis]) / spacing)) + 1 for axis in range(3))

    fused = np.full(shape, -1000, np.int16)
    at = np.round(-origin / spacing).astype(int)
    fused[
        at[0] : at[0] + rostral.shape[0],
        at[1] : at[1] + rostral.shape[1],
        at[2] : at[2] + rostral.shape[2],
    ] = rostral
    inverse = rotation.T.astype(np.float32)
    origin32, offset32 = origin.astype(np.float32), offset.astype(np.float32)
    for start in range(0, shape[0], 48):
        stop = min(start + 48, shape[0])
        block = np.meshgrid(
            np.arange(start, stop, dtype=np.float32),
            np.arange(shape[1], dtype=np.float32),
            np.arange(shape[2], dtype=np.float32),
            indexing="ij",
        )
        world = np.stack(block, -1) * np.float32(spacing) + origin32
        source = (world - offset32) @ inverse / np.float32(spacing)
        sampled = ndimage.map_coordinates(
            caudal, np.moveaxis(source, -1, 0), order=1, mode="constant", cval=-1000.0
        )
        np.maximum(fused[start:stop], sampled.astype(np.int16), out=fused[start:stop])
    return fused


def main():
    started = time.time()
    config = json.load(open(os.path.join(HERE, "regions.json")))
    halves = {region["id"]: region for region in config["regions"] if region["group"] == "overview"}
    if set(halves) != {"rostral", "caudal"}:
        raise SystemExit("expected a rostral and a caudal half in regions.json")

    # One full resolution volume in memory at a time. Each is reduced to the two
    # things registration needs, and to the grid the fusion needs, before the
    # next is read.
    marks, shells, small, spacing = {}, {}, {}, None
    for key, region in halves.items():
        volume, voxel = extract.read_volume(extract.series_files(region["series"]))
        if spacing is None:
            spacing = voxel[0]
        elif abs(voxel[0] - spacing) > 1e-6:
            raise SystemExit("the halves were acquired at different voxel sizes")
        marks[key] = fiducials(volume, spacing)
        shells[key] = shell(volume, spacing)
        small[key] = extract.block_mean(volume, region["downsample"])
        del volume
        print(
            f"{region['series']}: {small[key].shape} at {spacing:.3f} mm, "
            f"{len(marks[key])} fiducials, {len(shells[key])} shell points",
            flush=True,
        )

    report = {}
    rotation, offset = register(marks, shells, report)
    report["rotationDegrees"] = round(degrees(rotation), 2)
    report["translationMm"] = [round(float(value), 1) for value in offset]
    del shells
    print(json.dumps(report, indent=1), flush=True)

    factor = halves["rostral"]["downsample"]
    fused = fuse(small["rostral"], small["caudal"], spacing * factor, rotation, offset)
    del small
    print(f"fused volume {fused.shape} at {spacing * factor:.3f} mm", flush=True)

    region = {
        "id": "skeleton",
        "series": "Rostral and caudal halves of body, registered",
        "media": halves["rostral"]["media"],
        "name": "Whole skeleton",
        "group": "overview",
        "bone": halves["rostral"]["bone"],
        "sourceVoxel": (spacing,) * 3,
    }
    record = extract.extract(region, fused.astype(np.float32), (spacing * factor,) * 3)
    # This scene is built from both series, so it has to credit both.
    record["mediaAlso"] = [halves["caudal"]["media"]]
    record["registration"] = report
    record["seconds"] = round(time.time() - started, 1)
    json.dump(record, open(os.path.join(BUILD, "skeleton.json"), "w"), indent=1)

    # Replace the two halves in the build manifest. They are the same animal at
    # the same voxel size, so listing them beside the fused scene would offer one
    # specimen three times over.
    # Dropping any previous skeleton too, so running this twice replaces the
    # scene rather than listing it a second time.
    built = json.load(open(os.path.join(BUILD, "regions-built.json")))
    built["regions"] = [
        r for r in built["regions"] if r["id"] not in ("rostral", "caudal", "skeleton")
    ]
    built["regions"].append(record)
    json.dump(built, open(os.path.join(BUILD, "regions-built.json"), "w"), indent=1)
    print(
        f"skeleton  {record['shape']} bone {record['meshes']['bone']['triangles'] / 1000:.0f}k tri"
        f", slices {record['volume']['bytes'] / 1e6:.1f} MB, {record['seconds']}s"
    )


if __name__ == "__main__":
    main()

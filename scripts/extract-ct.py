"""Turn the MorphoSource DICOM series into surfaces and display volumes.

The specimen was scanned disarticulated: twelve independent series, each with
its own frame of reference and every one of them starting at the origin. There
is no transform that puts them in a shared space, so nothing here tries to
assemble a skeleton. Each series becomes its own region, and each region
carries what CT can actually give: a bone surface and the volume itself, so the
soft tissue is read off the slices rather than modeled. Thresholding for a soft
tissue envelope does not produce the animal here; the specimen was scanned
wrapped, and the wrap is continuous with the tissue at every level that
separates tissue from air.

Bones are not separated from one another. In a fresh specimen the articular
surfaces touch, so a connected component pass returns one mass per region
rather than one per bone: the head comes back as a single component holding
skull, mandible and atlas together. Splitting those is a segmentation problem
this script does not pretend to solve, so a region is one surface and the
anatomy is named by landmarks instead.

Output goes to build/ and is read by scripts/pack-atlas.mjs, which decimates
and packs. Everything here is deterministic; rerunning overwrites.
"""

import glob
import json
import os
import struct
import sys
import time

import numpy as np
import pydicom
from PIL import Image
from scipy import ndimage
from skimage import measure, morphology

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "documentation", "data")
BUILD = os.path.join(ROOT, "build")

# The display volume is sliced in the browser, so it has to arrive as pixels a
# canvas can decode. Past this many voxels it is downsampled again: the sheet
# has to fit in a canvas and cross a network.
VOLUME_VOXELS = 40e6
# Voxels below this are speckle: scanner noise and specimen mount fragments
# that threshold as bone but are not attached to anything.
MIN_COMPONENT = 400
# A component whose mean value is past this is metal, not bone.
METAL = 3000.0
# A component smaller than this share of the largest one is a mount, a tag
# or a wire rather than a bone.
RELATIVE_COMPONENT = 0.005


def series_files(series):
    """Every slice of one named series, sorted. Names are zero padded, so the
    filename order is the acquisition order; the headers agree."""
    for entry in sorted(os.listdir(DATA)):
        found = sorted(glob.glob(os.path.join(DATA, entry, "*", "*", "*.dcm")))
        if found and os.path.basename(os.path.dirname(found[0])) == series:
            return found
    raise SystemExit(f"series not found: {series}")


def read_volume(files):
    """The stack in Hounsfield units, with the voxel size the headers report.

    Every series here is uncompressed explicit VR, isotropic, slope 1 and
    intercept 0, but the rescale is applied rather than assumed.
    """
    first = pydicom.dcmread(files[0])
    spacing = float(first.PixelSpacing[0])
    thickness = float(getattr(first, "SliceThickness", spacing))
    slope = float(getattr(first, "RescaleSlope", 1))
    intercept = float(getattr(first, "RescaleIntercept", 0))
    volume = np.empty((len(files), int(first.Rows), int(first.Columns)), np.int16)
    for index, path in enumerate(files):
        volume[index] = pydicom.dcmread(path).pixel_array
    data = volume.astype(np.float32)
    if slope != 1 or intercept != 0:
        data = data * slope + intercept
    return data, (thickness, spacing, spacing)


def block_mean(volume, factor):
    """Downsample by averaging whole blocks. Striding would alias a surface
    this thin; a mean keeps the partial volume information that marching cubes
    then reads back as sub-voxel position."""
    if factor == 1:
        return volume
    depth, height, width = (size - size % factor for size in volume.shape)
    return (
        volume[:depth, :height, :width]
        .reshape(depth // factor, factor, height // factor, factor, width // factor, factor)
        .mean((1, 3, 5))
    )


def clean_mask(volume, level, min_size=MIN_COMPONENT, fraction=RELATIVE_COMPONENT):
    """Threshold, then drop the speckle, the specimen mount and the metal.

    A flat voxel floor is not enough on its own. Every one of these scans has a
    mount, a tag or a wire in the field, and some of them are larger than a
    distal phalanx. What separates them from anatomy is that they are small
    beside the bone they sit next to, so the floor is also relative: a
    component has to reach a fraction of the largest one to be kept.
    """
    mask = volume > level
    # max_size drops objects smaller than or equal to it, so the bound is
    # one below the size this keeps.
    mask = morphology.remove_small_objects(mask, max_size=min_size - 1)
    labels, count = ndimage.label(mask)
    if not count:
        return mask, 0
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    means = ndimage.mean(volume, labels, range(1, count + 1))
    floor = max(min_size, sizes.max() * fraction)
    kept = np.zeros(sizes.size, bool)
    for index in range(1, count + 1):
        kept[index] = sizes[index] >= floor and means[index - 1] <= METAL
    return kept[labels], int(kept.sum())


def surface(volume, mask, level, spacing):
    """Marching cubes on the smoothed values, restricted to the cleaned mask.

    Running it on the binary mask instead would give a blocked voxel surface.
    Running it on the values without the mask would bring the speckle back.
    """
    room = ndimage.binary_dilation(mask, iterations=2)
    vertices, faces, _, _ = measure.marching_cubes(
        volume, level=level, spacing=spacing, mask=room, step_size=1
    )
    return vertices.astype(np.float32), faces.astype(np.uint32)


def write_mesh(path, vertices, faces):
    """A vertex count, a triangle count, the positions, the indices. The packer
    is the only reader and it needs nothing else."""
    with open(path, "wb") as out:
        out.write(struct.pack("<II", len(vertices), len(faces) * 3))
        out.write(np.ascontiguousarray(vertices, np.float32).tobytes())
        out.write(np.ascontiguousarray(faces, np.uint32).tobytes())
    return os.path.getsize(path)


def write_volume(path, volume, window):
    """The volume as one JPEG sheet of axial tiles.

    The browser has a JPEG decoder and no DICOM parser, so the slices travel as
    an image and are read back into a typed array once, on selection. Lossy is
    acceptable: this is a display volume for scrolling, not a measurement.
    """
    low, high = window
    scaled = np.clip((volume - low) / (high - low), 0, 1)
    tiles = (scaled * 255).astype(np.uint8)
    depth, height, width = tiles.shape
    columns = int(np.ceil(np.sqrt(depth)))
    rows = int(np.ceil(depth / columns))
    sheet = np.zeros((rows * height, columns * width), np.uint8)
    for index in range(depth):
        row, column = divmod(index, columns)
        sheet[row * height : (row + 1) * height, column * width : (column + 1) * width] = tiles[index]
    Image.fromarray(sheet).save(path, quality=82, optimize=True)
    return {
        "sheet": os.path.basename(path),
        "dims": [int(width), int(height), int(depth)],
        "tiles": [int(columns), int(rows)],
        "window": [float(low), float(high)],
        "bytes": os.path.getsize(path),
    }


def extract(region, volume, spacing):
    record = {
        "id": region["id"],
        "series": region["series"],
        "media": region["media"],
        "name": region["name"],
        "group": region["group"],
        "voxel": [round(value, 6) for value in spacing],
        "sourceVoxel": [round(value, 6) for value in region["sourceVoxel"]],
        "shape": [int(size) for size in volume.shape],
        "meshes": {},
    }
    smoothed = ndimage.gaussian_filter(volume, 0.7)

    bone, components = clean_mask(smoothed, region["bone"])
    if not bone.any():
        raise SystemExit(f"{region['id']}: nothing above the bone level")
    vertices, faces = surface(smoothed, bone, region["bone"], spacing)
    record["meshes"]["bone"] = {
        "file": f"{region['id']}-bone.mesh",
        "vertices": int(len(vertices)),
        "triangles": int(len(faces)),
        "level": region["bone"],
        "voxels": int(bone.sum()),
        "components": int(components),
        "bytes": write_mesh(os.path.join(BUILD, f"{region['id']}-bone.mesh"), vertices, faces),
    }

    factor = 1
    while np.prod(volume.shape) / factor**3 > VOLUME_VOXELS:
        factor += 1
    display = block_mean(volume, factor)
    record["volume"] = write_volume(
        os.path.join(BUILD, f"{region['id']}-slices.jpg"), display, (-1000.0, 2000.0)
    )
    record["volume"]["voxel"] = [round(value * factor, 6) for value in spacing]
    return record


def main(only=None):
    os.makedirs(BUILD, exist_ok=True)
    config = json.load(open(os.path.join(HERE, "regions.json")))
    records = []
    for region in config["regions"]:
        if only and region["id"] not in only:
            continue
        started = time.time()
        volume, spacing = read_volume(series_files(region["series"]))
        factor = region["downsample"]
        region["sourceVoxel"] = spacing
        volume = block_mean(volume, factor)
        spacing = tuple(value * factor for value in spacing)
        record = extract(region, volume, spacing)
        record["seconds"] = round(time.time() - started, 1)
        records.append(record)
        meshes = ", ".join(
            f"{key} {value['triangles'] / 1000:.0f}k tri" for key, value in record["meshes"].items()
        )
        print(
            f"{region['id']:9s} {record['shape']} {meshes}"
            f", slices {record['volume']['bytes'] / 1e6:.1f} MB, {record['seconds']}s",
            flush=True,
        )
        json.dump(record, open(os.path.join(BUILD, f"{region['id']}.json"), "w"), indent=1)
    summary = {"specimen": config["specimen"], "regions": records}
    if not only:
        json.dump(summary, open(os.path.join(BUILD, "regions-built.json"), "w"), indent=1)
    return summary


if __name__ == "__main__":
    main(sys.argv[1:] or None)

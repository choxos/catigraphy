"""Orthographic previews of an extracted surface, for checking it by eye.

Two things about these meshes cannot be settled by a number: which way up a
region should sit, and where on its surface a named landmark actually is. An
ex vivo specimen has no anatomical frame, so the DICOM orientation tags say
nothing, and a landmark is a claim about anatomy that has to be looked at.

This renders the surface from six directions with a millimeter grid over it,
so a coordinate can be read off a view and checked in the next render. Vertices
are splatted rather than triangles rasterized: the meshes carry a vertex every
fraction of a millimeter, so the point cloud is denser than the output raster
and the result is the same picture for a fraction of the work.
"""

import json
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw

BUILD = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build")

# Each entry is (depth axis and the across axis), (depth axis and the up axis),
# and which end of the depth axis the camera is on. The z buffer keeps the
# nearest surface, so a sign of -1 looks back down the axis from its high end.
VIEWS = {
    "front": ((0, 2), (0, 1), 1),
    "back": ((0, 2), (0, 1), -1),
    "left": ((2, 0), (2, 1), 1),
    "right": ((2, 0), (2, 1), -1),
    "top": ((1, 0), (1, 2), -1),
    "bottom": ((1, 0), (1, 2), 1),
}


def read_mesh(path):
    with open(path, "rb") as handle:
        vertices, indices = struct.unpack("<II", handle.read(8))
        positions = np.frombuffer(handle.read(vertices * 12), np.float32).reshape(-1, 3)
        faces = np.frombuffer(handle.read(indices * 4), np.uint32).reshape(-1, 3)
    return positions, faces


def project(positions, view, size):
    """Vertices to pixels and depth, for one of the six axis aligned views."""
    (depth_axis, horizontal), (_, vertical), sign = view
    across = positions[:, horizontal]
    up = positions[:, vertical]
    away = positions[:, depth_axis] * sign
    low = np.array([across.min(), up.min()])
    high = np.array([across.max(), up.max()])
    span = (high - low).max() or 1.0
    scale = (size - 20) / span
    x = ((across - low[0]) * scale + 10).astype(np.int32)
    y = (size - 10 - (up - low[1]) * scale).astype(np.int32)
    return x, y, away, low, scale, size


def shade(positions, view, size):
    x, y, away, low, scale, _ = project(positions, view, size)
    inside = (x >= 0) & (x < size) & (y >= 0) & (y < size)
    x, y, away = x[inside], y[inside], away[inside]
    buffer = np.full((size, size), np.inf, np.float32)
    # Splat a small block per vertex. One pixel per vertex leaves the surface
    # dithered wherever the raster is finer than the mesh.
    for offset_y in (-1, 0, 1):
        for offset_x in (-1, 0, 1):
            at_y = np.clip(y + offset_y, 0, size - 1)
            at_x = np.clip(x + offset_x, 0, size - 1)
            np.minimum.at(buffer, (at_y, at_x), away)
    seen = np.isfinite(buffer)
    if not seen.any():
        return np.zeros((size, size), np.uint8), low, scale
    filled = np.where(seen, buffer, buffer[seen].max())
    gradient_y, gradient_x = np.gradient(filled)
    length = np.sqrt(gradient_x**2 + gradient_y**2 + 1.0)
    light = np.clip((0.45 * -gradient_x + 0.45 * -gradient_y + 1.0) / length, 0, 1)
    near = filled[seen].min()
    far = filled[seen].max()
    image = light * 0.8 + 0.2
    image *= 1.0 - 0.5 * (filled - near) / (far - near + 1e-6)
    image[~seen] = 0.06
    return (np.clip(image, 0, 1) * 255).astype(np.uint8), low, scale


def annotate(array, view, low, scale, size, label, marks):
    """A grid every 10 mm with the axis values written on it, plus any
    landmarks that have been placed so far."""
    image = Image.fromarray(array).convert("RGB")
    draw = ImageDraw.Draw(image)
    (_, horizontal), (_, vertical), _ = view
    step = 10.0
    start = np.floor(low / step) * step
    for index in range(60):
        value = start[0] + index * step
        x = int((value - low[0]) * scale + 10)
        if 0 <= x < size:
            draw.line([(x, 0), (x, size)], fill=(40, 70, 110), width=1)
            draw.text((x + 2, size - 12), f"{value:.0f}", fill=(120, 170, 230))
    for index in range(60):
        value = start[1] + index * step
        y = int(size - 10 - (value - low[1]) * scale)
        if 0 <= y < size:
            draw.line([(0, y), (size, y)], fill=(40, 70, 110), width=1)
            draw.text((2, y + 1), f"{value:.0f}", fill=(120, 170, 230))
    draw.text((6, 6), f"{label}  across=axis{horizontal}  up=axis{vertical}", fill=(255, 230, 120))
    for name, point in marks:
        x = int((point[horizontal] - low[0]) * scale + 10)
        y = int(size - 10 - (point[vertical] - low[1]) * scale)
        draw.ellipse([x - 4, y - 4, x + 4, y + 4], outline=(255, 90, 90), width=2)
        draw.text((x + 6, y - 6), name, fill=(255, 140, 140))
    return image


def main(mesh, size=560, marks=()):
    positions, _ = read_mesh(mesh)
    name = os.path.basename(mesh).replace(".mesh", "")
    tiles = []
    for label, view in VIEWS.items():
        array, low, scale = shade(positions, view, size)
        tiles.append(annotate(array, view, low, scale, size, label, marks))
    sheet = Image.new("RGB", (size * 3, size * 2))
    for index, tile in enumerate(tiles):
        sheet.paste(tile, ((index % 3) * size, (index // 3) * size))
    out = os.path.join(BUILD, f"preview-{name}.png")
    sheet.save(out)
    bounds = np.stack([positions.min(0), positions.max(0)])
    print(f"{name}: {len(positions)} vertices, bounds mm {bounds.round(1).tolist()} -> {out}")
    return out


if __name__ == "__main__":
    marks = []
    if len(sys.argv) > 2:
        marks = [(entry["name"], entry["position"]) for entry in json.load(open(sys.argv[2]))]
    main(sys.argv[1], marks=marks)

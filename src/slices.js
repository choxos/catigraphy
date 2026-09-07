// The slice viewer.
//
// The surface in the 3D stage is one threshold through the scan. This is the
// scan itself: the soft tissue that no threshold separates from the wrapping,
// the trabecular pattern inside a vertebral body, the septum inside the
// tympanic bulla, all of which exist in the data and none of which survive
// into a bone surface.
//
// The volume arrives as one JPEG sheet of transverse tiles, because a browser
// has a JPEG decoder and no DICOM parser. It is decoded once per region into a
// byte per voxel and then resliced here.

const HU_LOW = -1000;
const HU_HIGH = 2000;

export function createSlices(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: false });
  const state = { volume: null, dims: [0, 0, 0], voxel: [1, 1, 1], id: null };

  /** Decode the sheet into one byte per voxel. */
  async function load(region) {
    if (state.id === region.id) return state;
    const image = new Image();
    image.decoding = "async";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () =>
        reject(new Error(`The slice volume for this region could not be loaded: ${region.volume.sheet}.`));
      image.src = region.volume.sheet;
    });
    const [width, height, depth] = region.volume.dims;
    const [columns] = region.volume.tiles;
    const sheet = document.createElement("canvas");
    sheet.width = image.width;
    sheet.height = image.height;
    const draw = sheet.getContext("2d", { willReadFrequently: true });
    draw.drawImage(image, 0, 0);
    const volume = new Uint8Array(width * height * depth);
    // One getImageData per tile row rather than one for the whole sheet: a
    // sheet can be 4096 by 4096, and asking for all of it at once allocates
    // four bytes a pixel where three of them are the same value repeated.
    for (let row = 0; row * columns < depth; row++) {
      const pixels = draw.getImageData(0, row * height, sheet.width, height).data;
      for (let column = 0; column < columns; column++) {
        const slice = row * columns + column;
        if (slice >= depth) break;
        const target = slice * width * height;
        for (let y = 0; y < height; y++) {
          const source = (y * sheet.width + column * width) * 4;
          for (let x = 0; x < width; x++) volume[target + y * width + x] = pixels[source + x * 4];
        }
      }
    }
    state.volume = volume;
    state.dims = [width, height, depth];
    state.voxel = region.volume.voxel;
    state.id = region.id;
    return state;
  }

  /** How many slices an axis has, and how big each one is in pixels.
   *
   *  Axes are the scan's own: 0 steps through the acquired slices, 1 through
   *  the rows of each one, 2 through the columns. Which anatomical plane each
   *  of those is depends on how the part lay in the scanner, which the atlas
   *  records per region rather than assumes.
   *
   *  The two resliced planes are drawn with the acquisition axis across rather
   *  than down, so a long bone lies along the frame the way it does in the 3D
   *  view instead of standing on end.
   */
  function extent(axis) {
    const [width, height, depth] = state.dims;
    if (axis === 0) return { count: depth, width, height };
    if (axis === 1) return { count: height, width: depth, height: width };
    return { count: width, width: depth, height };
  }

  function draw(axis, index, { center, width: level }) {
    if (!state.volume) return null;
    const [width, height] = state.dims;
    const view = extent(axis);
    const slice = Math.max(0, Math.min(view.count - 1, Math.round(index)));
    const image = context.createImageData(view.width, view.height);
    const pixels = image.data;
    // The stored byte is a linear map of Hounsfield units, so the window can be
    // applied to the byte directly: find where the window's low and high edges
    // land in byte space and stretch between them.
    const span = HU_HIGH - HU_LOW;
    const low = ((center - level / 2 - HU_LOW) / span) * 255;
    const high = ((center + level / 2 - HU_LOW) / span) * 255;
    const scale = 255 / (high - low || 1);
    // Row index runs down the acquired image and the surfaces are built with it
    // running up, so the two planes that show it are flipped to agree.
    const flip = axis !== 1;
    for (let y = 0; y < view.height; y++)
      for (let x = 0; x < view.width; x++) {
        const row = flip ? view.height - 1 - y : y;
        let at;
        if (axis === 0) at = slice * width * height + row * width + x;
        else if (axis === 1) at = x * width * height + slice * width + row;
        else at = x * width * height + row * width + slice;
        const value = Math.max(0, Math.min(255, (state.volume[at] - low) * scale));
        const out = (y * view.width + x) * 4;
        pixels[out] = pixels[out + 1] = pixels[out + 2] = value;
        pixels[out + 3] = 255;
      }
    canvas.width = view.width;
    canvas.height = view.height;
    context.putImageData(image, 0, 0);
    return { slice, count: view.count, millimeters: slice * state.voxel[axis] };
  }

  return { load, draw, extent, state };
}

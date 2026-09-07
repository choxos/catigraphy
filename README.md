# Catigraphy

**An interactive CT atlas of the domestic cat, rebuilt from published scans of one specimen.**

**[Open the atlas at catigraphy.xera.ac](https://catigraphy.xera.ac)** · No account, no API
key, no backend.

Twelve computed tomography series of a single *Felis catus*, published on MorphoSource by 3D
Anatomy Studios, turned into bone surfaces you can rotate and section, and served alongside the
slice volumes they were built from.

## What it contains

- **The whole skeleton**, 749 mm from muzzle to tail tip. The cat is longer than the scanner's
  479 mm field, so it was scanned twice, head first and then turned end for end. The two fields
  overlap by about 150 mm along the lumbar spine and share five metal fiducials on the specimen
  holder, so they register: the bone surfaces agree to a median of 0.28 mm, inside one 0.444 mm
  voxel. The two volumes are fused and surfaced in one pass, so the join carries no seam.
- **Ten scanned regions**, each a bone surface at up to 320,000 triangles: the skull with its
  mandible and the atlas, the cervical, thoracic and lumbar vertebrae, the pelvis with the
  sacrum and the first caudal vertebrae, the shoulder, the forearm and manus, the femur and
  knee, the tibia and fibula, and the pes. With the skeleton that is 3.38 million triangles in
  all, decimated from 7.93 million off marching cubes.
- **The slices themselves.** Every region ships its volume as a sheet of transverse tiles that
  the browser reslices in three planes, with bone, soft tissue and full windows. The soft tissue
  in this specimen exists only here: no threshold separates the animal from the wrapping it was
  scanned in, so no soft tissue surface is offered.
- **Fifteen named landmarks on the skull**, placed against the midsagittal slice and checked on
  two orthographic views of the surface. The teeth among them were located from the enamel
  density rather than by eye.
- **A written note on every region** saying what the scan holds and what to look for in it, and
  a reference section on the cat skeleton: the vertebral and dental formulae, the skull, the
  vertebral column and the limbs.
- **A section plane** on any axis, surface opacity, seven view presets, and a scale bar. Each
  region carries its own scale; there is no shared one.

## What it is not

Four things about the source data shape the whole atlas, and they are stated in the interface
as well as here.

**Only the whole animal is assembled.** The twelve series were acquired separately, each with
its own frame of reference, each starting at its own origin, and for ten of them nothing in the
data relates one to another. The two whole-body scans are the exception, because they are two
views of the same intact cat with a field in common: the registration described above puts them
in one frame to well under a voxel, and the whole skeleton is that fusion. The ten regional scans
share no field with anything, so they cannot be placed into it, and this atlas does not guess at
where they would go.

**Bones are not separated from one another.** In a specimen with its joints intact the articular
surfaces touch, so a threshold that follows bone returns one connected mass per region rather
than one per bone. Measured on this data: the head comes back as a single component holding
skull, mandible and atlas together; the pes as a single component; the cervical column as three,
not seven. Splitting those is a segmentation problem, and guessing at it would produce a parts
list that reads like anatomy and is not. The anatomy is named by landmarks on the surface
instead, and only where the placement could be checked.

**A scan's field can hold more than the part it is named for.** The tibia and fibula series and
the left pes series were acquired with the same geometry over much the same piece of the hind
limb, and each field is about 245 mm long, which is longer than either named part. Where the
atlas cannot say which end of a field is which, it says so in the region's notes.

**Only the head is landmarked.** An ex vivo specimen has no anatomical frame, and the DICOM
orientation tags describe how a part lay in the scanner rather than how it sat on the animal.
For the head that pose could be recovered from the scan itself, by reading the midsagittal slice
and the enamel of the teeth, and it carries fifteen named points. Which way is up was recovered
for the whole skeleton too, off the thoracic cross sections, where the vertebral column sits at
the apex of the body outline with the ribs sweeping away from it, and confirmed on the midsagittal
of the skull, where the thin-walled braincase and the dense muzzle and mandible fall on opposite
sides. The animal was scanned belly down and is rolled upright, and it carries no named points.
For the nine remaining regions neither was possible, so they carry written notes alone.

## Run

Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3017. No account, no API key, no backend.

```sh
npm test          # the manifest against the buffers it describes
npm run build     # writes dist/
npm run preview
```

## Rebuilding the geometry

The atlas ships built, so this is only needed to change the pipeline. It needs the MorphoSource
archives in `documentation/data/`, about 5 GB, and Python with numpy, scipy, scikit-image,
pydicom and Pillow.

```sh
python3 scripts/extract-ct.py     # DICOM to surfaces and display volumes, into build/
python3 scripts/fuse-halves.py    # register the two whole-body scans, fuse, replace them
node scripts/pack-atlas.mjs       # decimate, orient, pack into public/
```

`scripts/extract-ct.py` reads each series in Hounsfield units, averages it down by a factor of
two, smooths it slightly, and thresholds at the region's bone level. Components too small to be
anatomy or dense enough to be metal are dropped: every one of these scans has a mount, a tag or
a wire in the field, and some are larger than a distal phalanx, so the floor is relative as well
as absolute. Marching cubes then runs on the smoothed values restricted to what survives, which
gives a sub-voxel surface rather than a blocked one. The same volume is written again as a JPEG
sheet of transverse tiles, because a browser has a JPEG decoder and no DICOM parser.

`scripts/fuse-halves.py` joins the two whole-body scans. It finds the five metal fiducials in each
volume as intensity-weighted centroids, fits them in closed form both in order and reversed, and
takes the better, which is the reversed one: the specimen went into the bore the other way round,
and the fit says so rather than being told. That transform is then refined by trimmed ICP on the
bone surfaces inside the overlap, which uses no fiducial at all. The two independent answers
differ by 0.57 degrees and 1.6 mm, and the bone agrees to a median of 0.28 mm afterward. Every one
of those residuals is recomputed on each run and written into the region record, so a rebuild that
stops agreeing says so instead of shipping a bad join quietly. The caudal volume is then resampled
into the rostral scan's grid and the two are combined by taking the denser reading, which needs no
mask: outside a scan's field the sample reads as air, so the other scan wins there by itself. One
marching cubes pass then runs over the fused volume, which is why the join has no seam in it.

`scripts/pack-atlas.mjs` collapses each surface to the triangle budget with meshoptimizer,
reverses the winding so the outward normal is the front face, computes area-weighted vertex
normals, centers the region on its own bounding box in millimeters, and writes one buffer per
region with the byte offsets in `public/models/atlas.json`. It also places the landmarks: each
one is read from `scripts/landmarks.json` in the scan's own coordinates, snapped onto the
nearest vertex of the decimated mesh, and lifted 1.6 mm along its normal so the marker sits on
the bone rather than fighting it for pixels. The distance a point moved when it snapped is
recorded, and `npm test` fails if any of them was placed more than 10 mm off the surface. That
check is what caught a landmark floating in the middle of the orbital cavity.

All three scripts are deterministic: the same archives give the same surfaces, and the same
registration residuals.

`scripts/preview.py` renders a mesh from six directions with a millimeter grid and any landmarks
placed so far drawn on it. It is how the landmarks were positioned and checked, and it is the
fastest way to see what a change to the extraction did.

## Sizes

| | |
| --- | --- |
| Surfaces | 11 buffers, 3.7 to 6.8 MB, 71 MB total |
| Slice volumes | 11 sheets, 0.7 to 3.7 MB, 28 MB total |
| Application | 520 kB, 135 kB gzipped |

Nothing loads until a region is selected, and a region's slices are decoded only when the slice
view is opened, so the first paint fetches one 6.8 MB buffer.

## Deploy

The production site is a static build served by nginx from `/var/www/catigraphy/dist` on the
xera.ac box. `deploy/` holds the vhost and the build script.

First install, on the server as `xeradb`:

```sh
cd /var/www && git clone https://github.com/choxos/catigraphy.git
cd catigraphy && ./deploy/deploy.sh
```

Then once, as root, using the copy `deploy.sh` leaves in the home directory:

```sh
sudo cp ~/catigraphy.xera.ac.nginx /etc/nginx/sites-available/catigraphy.xera.ac
sudo ln -sfn /etc/nginx/sites-available/catigraphy.xera.ac /etc/nginx/sites-enabled/catigraphy.xera.ac
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d catigraphy.xera.ac --agree-tos -m ahmad.pub@gmail.com --redirect
```

Every update after that is one command, and needs no nginx reload because nginx serves the
build directly:

```sh
cd /var/www/catigraphy && git pull && ./deploy/deploy.sh
```

`deploy.sh` runs `npm ci`, the tests and the build, then writes a `.gz` beside every `.bin` and
`.json` in `dist/models` for `gzip_static`. The surfaces halve under gzip and the slice sheets
are JPEG, which gains four percent, so only the surfaces are compressed.

The site loads nothing from any other origin: no analytics, no CDN, no web font service. Inter
is served from `public/fonts/`. That is why the vhost sets no Content-Security-Policy of its own
and inherits the box-wide one in `/etc/nginx/conf.d/security.conf`.

## Source and terms

Every surface and every slice comes from CT data published on MorphoSource by 3D Anatomy
Studios, scanned on an Animage Fidex CT with donated time at the Keck XROMM Core Facility at
Brown University. The records carry an
[In Copyright, Non-Commercial Use Permitted](http://rightsstatements.org/vocab/InC-NC/1.0/)
rights statement: commercial use is not permitted, 3D use is, and derivatives published from
these media are to be archived on MorphoSource. The per-series citation, ARK and terms are in
[public/ATTRIBUTION.md](public/ATTRIBUTION.md).

The code and the written anatomy in this repository are MIT licensed. The rebuilt surfaces and
the repacked volumes stay under the terms of the source media.

This is an educational reference. It is not a clinical or diagnostic tool, and one specimen is
one specimen: nothing here establishes what is normal for the species.

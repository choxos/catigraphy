// The shell: region list, stage, inspector, and the two reading views.
//
// The whole interface is written into #app at module scope, before the WebGL
// context is asked for. A reader on a machine with no WebGL, and a crawler
// that runs scripts but draws nothing, both still get the atlas's structure and
// all of its text.

import "./style.css";
import { GROUPS, LIMITS, REFERENCE, REGION_NOTES, WINDOWS } from "./content.js";
import { createViewer } from "./viewer.js";
import { createSlices } from "./slices.js";

const THEME_KEY = "catigraphy-theme";

const ICONS = {
  atlas:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 7v10l8 4 8-4V7Z"/><path d="m4 7 8 4 8-4M12 11v10"/></svg>',
  slices:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></svg>',
  reference:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2Z"/><path d="M8 7h7M8 11h7"/></svg>',
  about:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  cat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9 5 3l4 3h6l4-3 1 6v5a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7Z"/><path d="M9 12h.01M15 12h.01M12 15v1"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14a8 8 0 1 1-10-10 7 7 0 0 0 10 10Z"/></svg>',
};

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

const state = {
  mode: "atlas",
  atlas: null,
  noWebGL: false,
  region: null,
  landmark: null,
  opacity: 1,
  sectioning: false,
  sectionAxis: 2,
  sectionPosition: 0.5,
  markers: true,
  sliceAxis: 0,
  sliceIndex: {},
  window: WINDOWS[0],
  search: "",
};

document.querySelector("#app").innerHTML = `
  <div class="studio">
    <header>
      <a class="brand" href="/">
        <span class="brand-mark">${ICONS.cat}</span>
        <span><b>Catigraphy</b><small>CT anatomy of the domestic cat</small></span>
      </a>
      <nav id="modes">
        <button data-mode="atlas" class="active">${ICONS.atlas} Surfaces</button>
        <button data-mode="slices">${ICONS.slices} Slices</button>
        <button data-mode="reference">${ICONS.reference} Reference</button>
        <button data-mode="about">${ICONS.about} About the scans</button>
      </nav>
      <div class="header-tools">
        <button id="theme" aria-label="Switch between the light and dark theme"></button>
      </div>
    </header>
    <main id="main">
      <aside class="panel" id="regions">
        <h2>Regions</h2>
        <input type="search" id="search" placeholder="Search the regions" aria-label="Search the regions" />
        <div id="region-list"></div>
      </aside>
      <section class="stage" id="stage">
        <div id="viewport"></div>
        <div id="slice-view" hidden>
          <div id="slice-frame"><canvas id="slice-canvas"></canvas></div>
          <div class="stage-tools slice-tools" id="slice-tools"></div>
        </div>
        <div class="stage-tools" id="stage-tools"></div>
        <div class="scale-bar" id="scale-bar" hidden></div>
        <div class="progress" id="progress">Loading the surface</div>
      </section>
      <aside class="panel inspector" id="inspector"></aside>
      <div class="reading" id="reading" hidden></div>
    </main>
    <div class="hover-label" id="hover" hidden></div>
  </div>
`;

const element = (id) => document.querySelector(`#${id}`);

/* ---- Theme -------------------------------------------------------------- */

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
  element("theme").innerHTML = theme === "dark" ? ICONS.sun : ICONS.moon;
}
setTheme(document.documentElement.dataset.theme || "light");
element("theme").addEventListener("click", () =>
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"),
);

/* ---- Region list -------------------------------------------------------- */

function renderRegions() {
  const term = state.search.trim().toLowerCase();
  const matches = state.atlas.regions.filter(
    (region) =>
      !term ||
      region.name.toLowerCase().includes(term) ||
      region.series.toLowerCase().includes(term) ||
      (REGION_NOTES[region.id]?.summary ?? "").toLowerCase().includes(term),
  );
  const order = Object.entries(GROUPS).sort((a, b) => a[1].order - b[1].order);
  element("region-list").innerHTML =
    order
      .map(([id, group]) => {
        const inside = matches.filter((region) => region.group === id);
        if (!inside.length) return "";
        return `<div class="group"><h2>${escape(group.label)}</h2>${inside
          .map(
            (region) => `<button class="region${region.id === state.region?.id ? " selected" : ""}"
              data-region="${region.id}">${escape(region.name)}
              <span>${region.sourceVoxel[0].toFixed(3)} mm voxels &middot; ${Math.round(region.triangles / 1000)}k triangles</span>
            </button>`,
          )
          .join("")}</div>`;
      })
      .join("") || `<p class="note">No region matches that.</p>`;
}

element("search").addEventListener("input", (event) => {
  state.search = event.target.value;
  renderRegions();
});

element("region-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-region]");
  if (button) selectRegion(button.dataset.region);
});

/* ---- Inspector ---------------------------------------------------------- */

function renderInspector() {
  const region = state.region;
  if (!region) return;
  const notes = REGION_NOTES[region.id] ?? {};
  const landmarks = region.landmarks ?? [];
  element("inspector").innerHTML = `
    <h3>${escape(region.name)}</h3>
    <p class="summary">${escape(notes.summary ?? "")}</p>
    <h2>The scan</h2>
    <dl class="facts">
      <dt>MorphoSource media</dt><dd>${escape(region.media)}</dd>
      <dt>Series</dt><dd>${escape(region.series)}</dd>
      <dt>Acquired at</dt><dd>${region.sourceVoxel[0].toFixed(3)} mm isotropic</dd>
      <dt>Rebuilt at</dt><dd>${region.voxel[0].toFixed(3)} mm isotropic</dd>
      <dt>Bone level</dt><dd>${region.level} HU</dd>
      <dt>Surface</dt><dd>${region.triangles.toLocaleString()} of ${region.sourceTriangles.toLocaleString()} triangles</dd>
      <dt>Extent</dt><dd>${region.size.map((value) => value.toFixed(0)).join(" &times; ")} mm</dd>
      <dt>Slices</dt><dd>${region.volume.dims[2]} &times; ${region.volume.dims[1]} &times; ${region.volume.dims[0]}</dd>
    </dl>
    ${
      landmarks.length
        ? `<h2>Landmarks</h2><div class="landmarks">${landmarks
            .map(
              (landmark) => `<button class="landmark${landmark.short === state.landmark ? " selected" : ""}"
                data-landmark="${escape(landmark.short)}">${escape(landmark.name)}
                ${landmark.short === state.landmark ? `<p>${escape(landmark.note)}</p>` : ""}
              </button>`,
            )
            .join("")}</div>`
        : `<p class="note">This region has no landmarks. Only the head does: the specimen was
           scanned in pieces and the pose of the other eleven cannot be recovered from the
           headers, so naming a point on them would be a guess rather than a reading. What to
           look for is below.</p>`
    }
    ${
      notes.look
        ? `<h2>What to look for</h2><ul class="look">${notes.look
            .map((line) => `<li>${escape(line)}</li>`)
            .join("")}</ul>`
        : ""
    }
    <p class="note">This surface is everything in the scan denser than ${region.level} HU. It is a
    threshold, not a segmentation: the bones in it are not separated from one another, and
    anything else as dense as bone is inside it too.</p>
  `;
}

element("inspector").addEventListener("click", (event) => {
  const button = event.target.closest("[data-landmark]");
  if (!button) return;
  selectLandmark(button.dataset.landmark);
});

function selectLandmark(short) {
  state.landmark = state.landmark === short ? null : short;
  viewer?.highlight(state.landmark);
  renderInspector();
}

/* ---- Stage tools -------------------------------------------------------- */

const VIEWS = [
  ["left", "Left"],
  ["right", "Right"],
  ["rostral", "Front"],
  ["caudal", "Back"],
  ["dorsal", "Top"],
  ["ventral", "Bottom"],
  ["oblique", "Oblique"],
];

function renderStageTools() {
  element("stage-tools").innerHTML = `
    <span class="tool"><span class="tool-label">View</span>
      ${VIEWS.map(([id, label]) => `<button data-view="${id}">${label}</button>`).join("")}</span>
    <span class="tool"><span class="tool-label">Opacity</span>
      <input type="range" id="opacity" min="0.15" max="1" step="0.05" value="${state.opacity}"
        aria-label="Surface opacity" /></span>
    <span class="tool">
      <button id="section" class="${state.sectioning ? "active" : ""}">Section</button>
      <button data-axis="0" class="${state.sectionAxis === 0 ? "active" : ""}">X</button>
      <button data-axis="1" class="${state.sectionAxis === 1 ? "active" : ""}">Y</button>
      <button data-axis="2" class="${state.sectionAxis === 2 ? "active" : ""}">Z</button>
      <input type="range" id="section-at" min="0" max="1" step="0.005" value="${state.sectionPosition}"
        aria-label="Section plane position" /></span>
    <span class="tool"><button id="markers" class="${state.markers ? "active" : ""}">Landmarks</button></span>
  `;
}

element("stage-tools").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.view) return viewer.look(button.dataset.view);
  if (button.dataset.axis) {
    state.sectionAxis = Number(button.dataset.axis);
    state.sectioning = true;
    viewer.setSection(true, state.sectionAxis, state.sectionPosition);
    return renderStageTools();
  }
  if (button.id === "section") {
    state.sectioning = !state.sectioning;
    viewer.setSection(state.sectioning, state.sectionAxis, state.sectionPosition);
    return renderStageTools();
  }
  if (button.id === "markers") {
    state.markers = !state.markers;
    viewer.setMarkersVisible(state.markers);
    return renderStageTools();
  }
});

element("stage-tools").addEventListener("input", (event) => {
  if (event.target.id === "opacity") {
    state.opacity = Number(event.target.value);
    viewer.setOpacity(state.opacity);
  }
  if (event.target.id === "section-at") {
    state.sectionPosition = Number(event.target.value);
    state.sectioning = true;
    viewer.setSection(true, state.sectionAxis, state.sectionPosition);
  }
});

/* ---- Slices ------------------------------------------------------------- */

const slices = createSlices(element("slice-canvas"));

/** The scan's axes have no anatomical names of their own. What each one is
 *  named here is what it is in the displayed surface, which is the one frame
 *  a reader can see both in. */
const AXIS_LABELS = [
  ["Across the scan", "Steps along the long axis of the part, the direction the slices were acquired in"],
  ["Top to bottom", "Steps down through the part"],
  ["Side to side", "Steps across the part"],
];

function renderSliceTools() {
  const axis = state.sliceAxis;
  const view = slices.extent(axis);
  const index = state.sliceIndex[axis] ?? Math.floor(view.count / 2);
  element("slice-tools").innerHTML = `
    <span class="tool"><span class="tool-label">Plane</span>
    ${AXIS_LABELS.map(
      ([label, hint], value) =>
        `<button data-slice-axis="${value}" title="${escape(hint)}" class="${
          value === axis ? "active" : ""
        }">${label}</button>`,
    ).join("")}</span>
    <span class="tool"><input type="range" id="slice-at" min="0" max="${view.count - 1}" step="1" value="${index}"
      aria-label="Slice position" />
    <span class="readout" id="slice-readout"></span></span>
    <span class="tool"><span class="tool-label">Window</span>
    ${WINDOWS.map(
      (preset) =>
        `<button data-window="${preset.id}" class="${
          preset.id === state.window.id ? "active" : ""
        }">${preset.label}</button>`,
    ).join("")}</span>
  `;
  drawSlice(index);
}

function drawSlice(index) {
  const report = slices.draw(state.sliceAxis, index, state.window);
  if (!report) return;
  state.sliceIndex[state.sliceAxis] = report.slice;
  const readout = element("slice-readout");
  if (readout)
    readout.textContent = `${report.slice + 1} of ${report.count} · ${report.millimeters.toFixed(1)} mm`;
}

element("slice-tools").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.sliceAxis !== undefined) {
    state.sliceAxis = Number(button.dataset.sliceAxis);
    return renderSliceTools();
  }
  if (button.dataset.window) {
    state.window = WINDOWS.find((preset) => preset.id === button.dataset.window);
    return renderSliceTools();
  }
});

element("slice-tools").addEventListener("input", (event) => {
  if (event.target.id === "slice-at") drawSlice(Number(event.target.value));
});

// The wheel is what a reader reaches for on a stack of slices.
element("slice-frame").addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const at = state.sliceIndex[state.sliceAxis] ?? 0;
    const next = at + Math.sign(event.deltaY);
    drawSlice(next);
    const range = element("slice-at");
    if (range) range.value = state.sliceIndex[state.sliceAxis];
  },
  { passive: false },
);

/* ---- Reading views ------------------------------------------------------ */

function renderReading() {
  if (state.mode === "reference") {
    element("reading").innerHTML = `<div class="column">
      <h1>The cat skeleton, in numbers and in outline</h1>
      ${REFERENCE.map(
        (section) => `<section class="card"><h2>${escape(section.title)}</h2>
          ${
            section.rows
              ? `<table><tbody>${section.rows
                  .map(([term, value]) => `<tr><td>${escape(term)}</td><td>${escape(value)}</td></tr>`)
                  .join("")}</tbody></table>`
              : section.body.map((line) => `<p>${escape(line)}</p>`).join("")
          }</section>`,
      ).join("")}
    </div>`;
    return;
  }
  const specimen = state.atlas.specimen;
  element("reading").innerHTML = `<div class="column">
    <h1>About the scans</h1>
    <section class="card">
      <h2>The specimen</h2>
      <p>One domestic cat, <em>${escape(specimen.taxon)}</em>, specimen ${escape(specimen.specimenId)}
      of ${escape(specimen.organization)}, scanned on an ${escape(specimen.device)} at the
      ${escape(specimen.facility)} and published on MorphoSource in the collection
      ${escape(state.atlas.collection)}.</p>
      <p>Twelve series were acquired: two halves of the whole body at 0.444 mm voxels, and ten
      closer scans of single regions at 0.157 to 0.286 mm. This atlas rebuilds a bone surface from
      each of them and ships the volumes themselves for slice viewing.</p>
    </section>
    <section class="card">
      <h2>What this atlas is not</h2>
      <ul class="limits">${LIMITS.map((line) => `<li>${escape(line)}</li>`).join("")}</ul>
    </section>
    <section class="card">
      <h2>How the surfaces were made</h2>
      <p>Each series is read from its DICOM slices in Hounsfield units, averaged down by a factor
      of two, and smoothed slightly. Everything above the region's bone level is kept, components
      too small to be anatomy or dense enough to be metal are dropped, and marching cubes is run on
      the smoothed values inside what is left. The result is collapsed to
      ${state.atlas.budget.toLocaleString()} triangles a region.</p>
      <p>The whole pipeline is two scripts, <code>scripts/extract-ct.py</code> and
      <code>scripts/pack-atlas.mjs</code>, and it is deterministic: the same archive gives the same
      surfaces.</p>
    </section>
    <section class="card">
      <h2>Credit and terms</h2>
      <p>The scans are the work of 3D Anatomy Studios and were made with donated scanning time at
      the Keck XROMM Core Facility. The MorphoSource records carry a
      <a href="http://rightsstatements.org/vocab/InC-NC/1.0/">In Copyright, Non-Commercial Use
      Permitted</a> statement: commercial use is not permitted, and derivatives published from
      these media are to be archived on MorphoSource. The per-region citation and the ARK for
      every series are in <a href="/ATTRIBUTION.md">ATTRIBUTION.md</a>.</p>
    </section>
  </div>`;
}

/* ---- Modes -------------------------------------------------------------- */

function setMode(mode) {
  state.mode = mode;
  for (const button of element("modes").children)
    button.classList.toggle("active", button.dataset.mode === mode);
  const reading = mode === "reference" || mode === "about";
  element("reading").hidden = !reading;
  for (const id of ["regions", "stage", "inspector"]) element(id).hidden = reading;
  element("viewport").hidden = mode !== "atlas";
  element("stage-tools").hidden = mode !== "atlas" || state.noWebGL;
  element("scale-bar").hidden = mode !== "atlas" || state.noWebGL;
  element("slice-view").hidden = mode !== "slices";
  element("progress").hidden = !(state.noWebGL && mode === "atlas");
  if (reading) return renderReading();
  if (mode === "atlas") viewer?.resize();
  if (mode === "slices") openSlices();
}

element("modes").addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (button) setMode(button.dataset.mode);
});

async function openSlices() {
  element("progress").hidden = false;
  element("progress").textContent = "Decoding the slices";
  try {
    await slices.load(state.region);
    state.sliceIndex = {};
    renderSliceTools();
  } catch (error) {
    element("progress").textContent = error.message;
    return;
  }
  element("progress").hidden = true;
}

/* ---- Selection ---------------------------------------------------------- */

let viewer = null;

function updateScaleBar() {
  const region = state.region;
  if (!region) return;
  // A bar a fifth of the region wide, rounded to something a reader can hold
  // in mind. There is no shared scale across regions, so every one says its
  // own size.
  const rough = Math.max(...region.size) / 5;
  const step = [1, 2, 5, 10, 20, 50, 100].reduce((best, value) =>
    Math.abs(value - rough) < Math.abs(best - rough) ? value : best,
  );
  element("scale-bar").innerHTML = `<div style="width:${(step / Math.max(...region.size)) * 260}px"></div>${step} mm`;
}

async function selectRegion(id) {
  const region = state.atlas.regions.find((one) => one.id === id);
  if (!region || region === state.region) return;
  state.region = region;
  state.landmark = null;
  renderRegions();
  renderInspector();
  updateScaleBar();
  if (state.noWebGL) {
    element("progress").hidden = state.mode !== "atlas";
    element("progress").textContent =
      "This browser has no WebGL, so the 3D surfaces cannot be drawn. The slices and the reference still work.";
    if (state.mode === "slices") openSlices();
    return;
  }
  element("progress").hidden = false;
  element("progress").textContent = "Loading the surface";
  try {
    await viewer.show(region, region.landmarks ?? []);
    viewer.setOpacity(state.opacity);
    viewer.setMarkersVisible(state.markers);
    renderStageTools();
  } catch (error) {
    element("progress").textContent = error.message;
    return;
  }
  element("progress").hidden = true;
  if (state.mode === "slices") openSlices();
}

/* ---- Start -------------------------------------------------------------- */

const hover = element("hover");

async function start() {
  const response = await fetch("/models/atlas.json");
  if (!response.ok) {
    element("progress").textContent =
      "The atlas manifest could not be loaded. Run npm run pack to build it.";
    return;
  }
  state.atlas = await response.json();
  renderRegions();
  try {
    viewer = await createViewer(element("viewport"), {
      onSelectLandmark: (landmark) => selectLandmark(landmark.short),
      onProgress: (percent) => {
        element("progress").textContent = `Loading the surface ${percent}%`;
      },
      onHover: (landmark, event) => {
        hover.hidden = !landmark;
        if (!landmark) return;
        hover.textContent = landmark.name;
        hover.style.left = `${event.clientX + 14}px`;
        hover.style.top = `${event.clientY + 14}px`;
      },
    });
  } catch {
    // No WebGL. The surfaces are gone but the slices are 2D canvas and the
    // text is text, so the atlas keeps working with one of its two views.
    state.noWebGL = true;
    element("stage-tools").hidden = true;
    element("scale-bar").hidden = true;
  }
  await selectRegion("head");
}

start();

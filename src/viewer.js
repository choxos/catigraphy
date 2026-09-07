// The 3D stage.
//
// One region is in the scene at a time. Each region is a single surface, so
// there is nothing to pick apart and nothing to isolate; what the viewer offers
// instead is the two things that make an unsegmented surface readable, which
// are a section plane you can drive through it and named markers on it.
//
// Positions are millimeters. Each region is centered on its own bounding box
// because the twelve scans share no coordinate system.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GROUPS } from "./content.js";

const BONE_SURFACE = { roughness: 0.62, metalness: 0.02 };

export async function createViewer(host, handlers = {}) {
  const { onSelectLandmark = () => {}, onProgress = () => {}, onHover = () => {} } = handlers;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 6000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  host.append(renderer.domElement);
  renderer.domElement.setAttribute(
    "aria-label",
    "Interactive 3D bone surface. Drag to rotate, scroll to zoom. The landmark list beside it is the keyboard route to the same structures.",
  );

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.zoomToCursor = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x6f7c88, 1.7));
  const key = new THREE.DirectionalLight(0xfff6e8, 2.0);
  key.position.set(-1, 2, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc9e6ff, 1.0);
  fill.position.set(2, -0.5, -1.5);
  scene.add(fill);

  // The section plane. Clipping shows the inside of a threshold surface, which
  // is where the sinuses, the bulla and the marrow cavities are.
  const clip = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  const state = {
    region: null,
    mesh: null,
    markers: new THREE.Group(),
    landmarks: [],
    sectioning: false,
    axis: 0,
    radius: 100,
  };
  scene.add(state.markers);

  const buffers = new Map();
  async function loadBuffer(url) {
    if (buffers.has(url)) return buffers.get(url);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`The surface for this region could not be loaded: ${url} (HTTP ${response.status}).`);
    const total = Number(response.headers.get("content-length")) || 0;
    // Without a length or a readable stream there is nothing honest to report,
    // so take the whole body rather than draw a progress bar that guesses.
    if (!total || !response.body) {
      const whole = await response.arrayBuffer();
      buffers.set(url, whole);
      return whole;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress(Math.min(99, Math.round((received / total) * 100)));
    }
    const bytes = new Uint8Array(received);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    onProgress(100);
    buffers.set(url, bytes.buffer);
    return bytes.buffer;
  }

  function geometryFor(region, buffer) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(buffer, region.positions, region.vertexCount * 3), 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(new Int16Array(buffer, region.normals, region.vertexCount * 3), 3, true),
    );
    geometry.setIndex(
      new THREE.BufferAttribute(new Uint32Array(buffer, region.indices, region.indexCount), 1),
    );
    geometry.computeBoundingSphere();
    return geometry;
  }

  function markerTexture(text) {
    const scale = 3;
    const pad = 9 * scale;
    const measure = document.createElement("canvas").getContext("2d");
    const font = `${12 * scale}px Inter, system-ui, sans-serif`;
    measure.font = font;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(measure.measureText(text).width) + pad * 2;
    canvas.height = 24 * scale + pad;
    const draw = canvas.getContext("2d");
    draw.font = font;
    draw.fillStyle = "rgba(255,255,255,0.95)";
    draw.strokeStyle = "rgba(23,36,47,0.25)";
    draw.lineWidth = scale;
    draw.beginPath();
    draw.roundRect(scale / 2, scale / 2, canvas.width - scale, canvas.height - scale, 7 * scale);
    draw.fill();
    draw.stroke();
    draw.fillStyle = "#17242f";
    draw.textBaseline = "middle";
    draw.fillText(text, pad, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    return { texture, ratio: canvas.width / canvas.height };
  }

  function buildMarkers(landmarks) {
    state.markers.clear();
    state.landmarks = landmarks;
    const size = state.radius * 0.018;
    for (const landmark of landmarks) {
      const group = new THREE.Group();
      group.position.set(...landmark.position);
      // The marker sits just off the surface along its own normal, so depth
      // testing hides the ones on the far side rather than showing all fifteen
      // at once through the bone. The selected one is exempt.
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(size, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xd9534f }),
      );
      dot.renderOrder = 3;
      dot.userData.landmark = landmark;
      group.add(dot);
      const { texture, ratio } = markerTexture(landmark.name);
      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
      );
      const height = state.radius * 0.045;
      label.scale.set(height * ratio, height, 1);
      label.position.set(0, size * 2.6, 0);
      label.center.set(0.5, 0);
      label.renderOrder = 4;
      label.visible = false;
      group.add(label);
      group.userData.landmark = landmark;
      group.userData.label = label;
      group.userData.dot = dot;
      state.markers.add(group);
    }
  }

  function frame(direction = [0, 0, 1], up = [0, 1, 0]) {
    const radius = state.radius || 100;
    // Far enough back that the region's longest axis fits, with a margin. The
    // field of view is set vertically, so a stage taller than it is wide
    // subtends less horizontally and needs the camera further out; take
    // whichever of the two is tighter.
    const vertical = Math.tan((camera.fov * Math.PI) / 360);
    const distance = (radius / Math.min(vertical, vertical * camera.aspect)) * 1.25;
    camera.up.set(...up);
    camera.position.set(...direction.map((value) => value * distance));
    controls.target.set(0, 0, 0);
    controls.minDistance = radius * 0.08;
    controls.maxDistance = radius * 12;
    controls.update();
  }

  async function show(region, landmarks) {
    const buffer = await loadBuffer(region.buffer);
    if (state.mesh) {
      state.mesh.geometry.dispose();
      state.mesh.material.dispose();
      scene.remove(state.mesh);
    }
    const material = new THREE.MeshStandardMaterial({
      color: GROUPS[region.group]?.color ?? 0xded6c6,
      ...BONE_SURFACE,
      side: THREE.DoubleSide,
      clippingPlanes: state.sectioning ? [clip] : [],
      clipShadows: false,
    });
    state.mesh = new THREE.Mesh(geometryFor(region, buffer), material);
    scene.add(state.mesh);
    state.region = region;
    state.radius = Math.max(...region.size) / 2;
    buildMarkers(landmarks);
    setSection(state.sectioning, state.axis, 0.5);
    resize();
    frame([0, 0.25, 1]);
    return state.mesh;
  }

  /** Move the section plane. `position` runs 0 to 1 across the region on the
   *  chosen axis, so the control means the same thing whatever the scale. */
  function setSection(on, axis = state.axis, position = 0.5) {
    state.sectioning = on;
    state.axis = axis;
    if (state.mesh) state.mesh.material.clippingPlanes = on ? [clip] : [];
    if (!state.region) return;
    const normal = [0, 0, 0];
    normal[axis] = -1;
    clip.normal.set(...normal);
    // three.js keeps the fragments where normal . position + constant is
    // positive. With the normal pointing down the axis that is everything
    // below the cut, so the constant is the cut's own coordinate.
    const low = state.region.bounds[0][axis];
    const high = state.region.bounds[1][axis];
    clip.constant = low + (high - low) * position;
  }

  function setOpacity(value) {
    if (!state.mesh) return;
    state.mesh.material.transparent = value < 1;
    state.mesh.material.opacity = value;
    state.mesh.material.depthWrite = value >= 1;
    state.mesh.material.needsUpdate = true;
  }

  function setMarkersVisible(on) {
    state.markers.visible = on;
  }

  function highlight(short) {
    for (const group of state.markers.children) {
      const active = group.userData.landmark.short === short;
      group.userData.label.visible = active;
      const material = group.userData.dot.material;
      material.color.set(active ? 0x1f8fa8 : 0xd9534f);
      material.depthTest = !active;
      material.needsUpdate = true;
      group.userData.dot.renderOrder = active ? 5 : 3;
      group.scale.setScalar(active ? 1.6 : 1);
    }
  }

  function look(preset) {
    const views = {
      left: [[0, 0, 1], [0, 1, 0]],
      right: [[0, 0, -1], [0, 1, 0]],
      dorsal: [[0, 1, 0], [0, 0, -1]],
      ventral: [[0, -1, 0], [0, 0, 1]],
      rostral: [[-1, 0, 0], [0, 1, 0]],
      caudal: [[1, 0, 0], [0, 1, 0]],
      oblique: [[-0.7, 0.45, 0.7], [0, 1, 0]],
    };
    frame(...(views[preset] ?? views.oblique));
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const dots = state.markers.children.map((group) => group.userData.dot);
    const hit = raycaster.intersectObjects(dots, false)[0];
    return hit?.object.userData.landmark ?? null;
  }
  renderer.domElement.addEventListener("click", (event) => {
    const landmark = pick(event);
    if (landmark) onSelectLandmark(landmark);
  });
  renderer.domElement.addEventListener("pointermove", (event) => {
    const landmark = pick(event);
    renderer.domElement.style.cursor = landmark ? "pointer" : "grab";
    onHover(landmark, event);
  });

  function resize() {
    const { clientWidth, clientHeight } = host;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  return { show, look, setSection, setOpacity, setMarkersVisible, highlight, resize, state };
}

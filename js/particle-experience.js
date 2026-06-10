import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const PARTICLE_COUNT = 4000;
const TUNNEL_DEPTH = 240;
const TUNNEL_RADIUS = 42;
const NEAR_PLANE = 2;
const MAX_VELOCITY = 0.028;
const FRICTION = 0.9;
const BASE_SPEED = 28;
const MODEL_DEPTH = -42;
const MODEL_SCALE = 28;

const SENSITIVITY_IN_CHAPTER = 0.0001;
const SENSITIVITY_IN_TRANSITION = 0.00115;
const TRANSITION_HALF = 0.045;
const CHAPTER_BOUNDARIES = [0.25, 0.5, 0.75];

const MODEL_CHAPTERS = [
  { start: 0.25, end: 0.5, modelIndex: 0 },
  { start: 0.5, end: 0.75, modelIndex: 1 },
  { start: 0.75, end: 1, modelIndex: 0 },
];

const MODEL_SOURCES = [
  { path: "models/Duck.glb", name: "Duck" },
  { path: "models/Fox.glb", name: "Fox" },
];

const PALETTE = [
  new THREE.Color(0xc8d8f8),
  new THREE.Color(0xd4c8f0),
  new THREE.Color(0xb8e4f0),
  new THREE.Color(0xdce4f4),
  new THREE.Color(0xc0d4ff),
  new THREE.Color(0xe0d8f8),
];

const canvas = document.getElementById("particle-canvas");
const progressFill = document.getElementById("progress-fill");
const hint = document.querySelector(".hint");
const chapters = Array.from(document.querySelectorAll(".chapter"));

function createCircleTexture() {
  const size = 64;
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = size;
  textureCanvas.height = size;
  const ctx = textureCanvas.getContext("2d");
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.35, "rgba(255, 255, 255, 0.55)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.needsUpdate = true;
  return texture;
}

function getScrollSensitivity(value) {
  for (const boundary of CHAPTER_BOUNDARIES) {
    if (Math.abs(value - boundary) < TRANSITION_HALF) {
      return SENSITIVITY_IN_TRANSITION;
    }
  }
  return SENSITIVITY_IN_CHAPTER;
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function chapterOpacity(value, start, end) {
  const fade = 0.07;
  const fadeIn = smoothstep(start, start + fade, value);
  const fadeOut = 1 - smoothstep(end - fade, end, value);
  return fadeIn * fadeOut;
}

function getMorphState(value) {
  for (const chapter of MODEL_CHAPTERS) {
    if (value < chapter.start || value >= chapter.end) {
      continue;
    }

    const local = (value - chapter.start) / (chapter.end - chapter.start);
    const morph = Math.sin(local * Math.PI);
    return { morph, modelIndex: chapter.modelIndex };
  }

  return { morph: 0, modelIndex: 0 };
}

function extractVertices(root) {
  const vertices = [];
  const point = new THREE.Vector3();

  root.updateWorldMatrix(true, true);
  root.traverse((child) => {
    if (!child.isMesh) {
      return;
    }

    const position = child.geometry.attributes.position;
    if (!position) {
      return;
    }

    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i);
      point.applyMatrix4(child.matrixWorld);
      vertices.push(point.clone());
    }
  });

  return vertices;
}

function buildModelTargets(vertices, count) {
  if (vertices.length === 0) {
    return null;
  }

  const targets = new Float32Array(count * 3);
  const box = new THREE.Box3();
  const sample = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const source = vertices[Math.floor(Math.random() * vertices.length)];
    const i3 = i * 3;
    targets[i3] = source.x;
    targets[i3 + 1] = source.y;
    targets[i3 + 2] = source.z;
    sample.set(targets[i3], targets[i3 + 1], targets[i3 + 2]);
    box.expandByPoint(sample);
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const scale = MODEL_SCALE / maxDim;

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    targets[i3] = (targets[i3] - center.x) * scale;
    targets[i3 + 1] = (targets[i3 + 1] - center.y) * scale;
    targets[i3 + 2] = (targets[i3 + 2] - center.z) * scale + MODEL_DEPTH;
  }

  return targets;
}

function rotateTarget(targets, index, angle) {
  const i3 = index * 3;
  const x = targets[i3];
  const y = targets[i3 + 1];
  const z = targets[i3 + 2] - MODEL_DEPTH;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    x: x * cos - z * sin,
    y,
    z: x * sin + z * cos + MODEL_DEPTH,
  };
}

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000008, 0.012);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.1,
  300
);
camera.position.set(0, 0, 0);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000008, 1);

const positions = new Float32Array(PARTICLE_COUNT * 3);
const freePositions = new Float32Array(PARTICLE_COUNT * 3);
const colors = new Float32Array(PARTICLE_COUNT * 3);
const speeds = new Float32Array(PARTICLE_COUNT);
const modelTargets = [];

function assignParticleColor(index) {
  const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
  const i3 = index * 3;
  colors[i3] = color.r;
  colors[i3 + 1] = color.g;
  colors[i3 + 2] = color.b;
}

function randomParticlePosition(index) {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * TUNNEL_RADIUS;
  const i3 = index * 3;

  freePositions[i3] = Math.cos(angle) * radius;
  freePositions[i3 + 1] = Math.sin(angle) * radius;
  freePositions[i3 + 2] = -NEAR_PLANE - Math.random() * TUNNEL_DEPTH;
  speeds[index] = 0.75 + Math.random() * 0.5;
}

for (let i = 0; i < PARTICLE_COUNT; i++) {
  randomParticlePosition(i);
  assignParticleColor(i);
  positions[i * 3] = freePositions[i * 3];
  positions[i * 3 + 1] = freePositions[i * 3 + 1];
  positions[i * 3 + 2] = freePositions[i * 3 + 2];
}

const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

const circleTexture = createCircleTexture();

const material = new THREE.PointsMaterial({
  size: 0.42,
  map: circleTexture,
  alphaMap: circleTexture,
  vertexColors: true,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.52,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

const particles = new THREE.Points(geometry, material);
scene.add(particles);

let progress = 0;
let velocity = 0;
let hintHidden = false;
let modelsReady = false;
let modelRotation = 0;
const loader = new GLTFLoader();

async function loadModels() {
  hint.textContent = "Loading 3D models…";

  for (const source of MODEL_SOURCES) {
    const gltf = await loader.loadAsync(source.path);
    const vertices = extractVertices(gltf.scene);
    const targets = buildModelTargets(vertices, PARTICLE_COUNT);

    if (!targets) {
      throw new Error(`No vertices found in ${source.path}`);
    }

    modelTargets.push(targets);
  }

  modelsReady = true;
  hint.textContent = "Scroll down to advance · up to retreat";
}

function updateChapters() {
  chapters.forEach((chapter) => {
    const start = Number(chapter.dataset.start);
    const end = Number(chapter.dataset.end);
    const opacity = chapterOpacity(progress, start, end);
    const offset = (1 - opacity) * 24;

    chapter.style.opacity = String(opacity);
    chapter.style.transform = `translateY(${offset}px) scale(${0.98 + opacity * 0.02})`;
    chapter.classList.toggle("is-active", opacity > 0.02);
  });

  progressFill.style.width = `${progress * 100}%`;
}

function applyScrollDelta(delta) {
  const sensitivity = getScrollSensitivity(progress);
  velocity += delta * sensitivity;
  velocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, velocity));

  if (!hintHidden && Math.abs(velocity) > 0.001) {
    hintHidden = true;
    hint.classList.add("is-hidden");
  }
}

function onWheel(event) {
  event.preventDefault();
  applyScrollDelta(event.deltaY);
}

let touchLastY = 0;

function onTouchStart(event) {
  touchLastY = event.touches[0].clientY;
}

function onTouchMove(event) {
  event.preventDefault();
  const currentY = event.touches[0].clientY;
  applyScrollDelta((touchLastY - currentY) * 2.5);
  touchLastY = currentY;
}

function recycleParticleToBack(index) {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * TUNNEL_RADIUS;
  const i3 = index * 3;

  freePositions[i3] = Math.cos(angle) * radius;
  freePositions[i3 + 1] = Math.sin(angle) * radius;
  freePositions[i3 + 2] = -TUNNEL_DEPTH - Math.random() * 40;
}

function recycleParticleToFront(index) {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * TUNNEL_RADIUS;
  const i3 = index * 3;

  freePositions[i3] = Math.cos(angle) * radius;
  freePositions[i3 + 1] = Math.sin(angle) * radius;
  freePositions[i3 + 2] = -NEAR_PLANE - Math.random() * 30;
}

function updateTunnelParticles(direction, move) {
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;
    freePositions[i3 + 2] += move * speeds[i];

    if (direction > 0 && freePositions[i3 + 2] > NEAR_PLANE) {
      recycleParticleToBack(i);
    } else if (direction < 0 && freePositions[i3 + 2] < -TUNNEL_DEPTH - 40) {
      recycleParticleToFront(i);
    }
  }
}

function blendParticlePositions(morph, modelIndex) {
  const blend = morph * morph * (3 - 2 * morph);
  const targets = modelTargets[modelIndex];

  if (!targets) {
    return;
  }

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;
    const rotated = rotateTarget(targets, i, modelRotation);
    const inverse = 1 - blend;

    positions[i3] = freePositions[i3] * inverse + rotated.x * blend;
    positions[i3 + 1] = freePositions[i3 + 1] * inverse + rotated.y * blend;
    positions[i3 + 2] = freePositions[i3 + 2] * inverse + rotated.z * blend;
  }

  geometry.attributes.position.needsUpdate = true;
}

function animate() {
  requestAnimationFrame(animate);

  progress = Math.min(1, Math.max(0, progress + velocity));

  if (progress <= 0 || progress >= 1) {
    velocity *= 0.55;
  } else {
    velocity *= FRICTION;
  }

  const { morph, modelIndex } = modelsReady
    ? getMorphState(progress)
    : { morph: 0, modelIndex: 0 };
  const direction = velocity === 0 ? 0 : Math.sign(velocity);
  const move = direction * (Math.abs(velocity) * 20 + 0.002) * BASE_SPEED * 0.016;

  if (morph < 0.98 && direction !== 0) {
    updateTunnelParticles(direction, move);
  }

  if (modelsReady && morph > 0.001) {
    modelRotation += 0.004 + Math.abs(velocity) * 0.35;
    blendParticlePositions(morph, modelIndex);
  } else if (direction !== 0 || morph <= 0.001) {
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      positions[i3] = freePositions[i3];
      positions[i3 + 1] = freePositions[i3 + 1];
      positions[i3 + 2] = freePositions[i3 + 2];
    }
    geometry.attributes.position.needsUpdate = true;
  }

  camera.rotation.z = Math.sin(progress * Math.PI * 2) * 0.02 * (1 - morph);

  updateChapters();
  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener("wheel", onWheel, { passive: false });
window.addEventListener("touchstart", onTouchStart, { passive: true });
window.addEventListener("touchmove", onTouchMove, { passive: false });
window.addEventListener("resize", onResize);

updateChapters();
loadModels().catch((error) => {
  console.error(error);
  hint.textContent = "Failed to load 3D models";
});
animate();

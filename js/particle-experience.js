import * as THREE from "three";

const PARTICLE_COUNT = 4000;
const TUNNEL_DEPTH = 240;
const TUNNEL_RADIUS = 42;
const NEAR_PLANE = 2;
const WHEEL_SENSITIVITY = 0.00035;
const MAX_VELOCITY = 0.018;
const FRICTION = 0.9;
const AUTO_DRIFT = 0.00006;
const BASE_SPEED = 28;

const canvas = document.getElementById("particle-canvas");
const progressFill = document.getElementById("progress-fill");
const hint = document.querySelector(".hint");
const chapters = Array.from(document.querySelectorAll(".chapter"));

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
const speeds = new Float32Array(PARTICLE_COUNT);

function randomParticlePosition(index) {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * TUNNEL_RADIUS;
  const i3 = index * 3;

  positions[i3] = Math.cos(angle) * radius;
  positions[i3 + 1] = Math.sin(angle) * radius;
  positions[i3 + 2] = -NEAR_PLANE - Math.random() * TUNNEL_DEPTH;
  speeds[index] = 0.75 + Math.random() * 0.5;
}

for (let i = 0; i < PARTICLE_COUNT; i++) {
  randomParticlePosition(i);
}

const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

const material = new THREE.PointsMaterial({
  color: 0xb8d4ff,
  size: 0.35,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

const particles = new THREE.Points(geometry, material);
scene.add(particles);

let progress = 0;
let velocity = 0;
let hintHidden = false;

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
  velocity += delta * WHEEL_SENSITIVITY;
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

function recycleParticle(index) {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * TUNNEL_RADIUS;
  const i3 = index * 3;

  positions[i3] = Math.cos(angle) * radius;
  positions[i3 + 1] = Math.sin(angle) * radius;
  positions[i3 + 2] = -TUNNEL_DEPTH - Math.random() * 40;
}

function animate() {
  requestAnimationFrame(animate);

  const travel = AUTO_DRIFT + velocity;
  progress = Math.min(1, Math.max(0, progress + travel));

  if (progress <= 0 || progress >= 1) {
    velocity *= 0.55;
  } else {
    velocity *= FRICTION;
  }

  const move = (AUTO_DRIFT + Math.abs(velocity) * 18 + 0.004) * BASE_SPEED;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;
    positions[i3 + 2] += move * speeds[i] * 0.016;

    if (positions[i3 + 2] > NEAR_PLANE) {
      recycleParticle(i);
    }
  }

  geometry.attributes.position.needsUpdate = true;
  camera.rotation.z = Math.sin(progress * Math.PI * 2) * 0.02;

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
animate();

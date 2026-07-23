/**
 * Soft ambient greenhouse atmosphere: fog, particle motes, gentle sway.
 * Not a realistic scene — mood only.
 */
import * as THREE from 'https://unpkg.com/three@0.170.0/build/three.module.js';

const BG = 0xf3f7f1;
const FOG = 0xe8f0e4;
const MOTE_COUNT = 32;

const MOTE_COLORS = [
  new THREE.Color(0x7cb87a),
  new THREE.Color(0xa8c97a),
  new THREE.Color(0xc5d98a),
  new THREE.Color(0x9bc48a),
  new THREE.Color(0xb8d4a0),
  new THREE.Color(0xd4e4a8),
];

/**
 * Build ambient scene graph into the given scene.
 * @param {THREE.Scene} scene
 * @returns {{ points: THREE.Points, light: THREE.DirectionalLight, update: (t: number, dt: number) => void, dispose: () => void }}
 */
export function setupAmbient(scene) {
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.FogExp2(FOG, 0.045);

  const ambientLight = new THREE.AmbientLight(0xe8f5e0, 0.85);
  scene.add(ambientLight);

  const sun = new THREE.DirectionalLight(0xfff5d6, 0.55);
  sun.position.set(2.5, 4, 1.5);
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xc8e0b8, 0.25);
  fill.position.set(-2, 1, -1);
  scene.add(fill);

  const positions = new Float32Array(MOTE_COUNT * 3);
  const colors = new Float32Array(MOTE_COUNT * 3);
  const sizes = new Float32Array(MOTE_COUNT);
  const velocities = new Float32Array(MOTE_COUNT);
  const phases = new Float32Array(MOTE_COUNT);

  for (let i = 0; i < MOTE_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 10;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 8;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 6 - 1;

    const c = MOTE_COLORS[i % MOTE_COLORS.length];
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;

    sizes[i] = 0.04 + Math.random() * 0.1;
    velocities[i] = 0.08 + Math.random() * 0.14;
    phases[i] = Math.random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    size: 0.12,
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  function update(t, _dt) {
    const pos = geometry.attributes.position.array;
    for (let i = 0; i < MOTE_COUNT; i++) {
      const ix = i * 3;
      pos[ix + 1] += velocities[i] * 0.016;
      pos[ix] += Math.sin(t * 0.35 + phases[i]) * 0.0025;

      if (pos[ix + 1] > 4.5) {
        pos[ix + 1] = -4.5;
        pos[ix] = (Math.random() - 0.5) * 10;
        pos[ix + 2] = (Math.random() - 0.5) * 6 - 1;
      }
    }
    geometry.attributes.position.needsUpdate = true;

    // Soft light sway
    sun.position.x = 2.5 + Math.sin(t * 0.18) * 0.6;
    sun.position.z = 1.5 + Math.cos(t * 0.14) * 0.4;
  }

  function dispose() {
    scene.remove(points);
    scene.remove(ambientLight);
    scene.remove(sun);
    scene.remove(fill);
    geometry.dispose();
    material.dispose();
  }

  return { points, light: sun, update, dispose };
}

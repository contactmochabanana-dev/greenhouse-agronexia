/**
 * Agronexia ambient Three.js experience.
 * Soft greenhouse atmosphere with selection pulse and success bloom.
 */
import * as THREE from 'https://unpkg.com/three@0.170.0/build/three.module.js';
import { setupAmbient } from './ambient.js';

/**
 * @param {object} [options]
 * @param {HTMLElement} [options.container] — parent for canvas
 * @param {number} [options.intensity] — initial ambient strength 0–1
 * @returns {{
 *   setIntensity: (n: number) => void,
 *   setModalOpen: (open: boolean) => void,
 *   pulseSelect: () => void,
 *   bloomSuccess: () => void,
 *   destroy: () => void,
 *   pause: () => void,
 *   resume: () => void,
 * }}
 */
export function createExperience(options = {}) {
  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let intensity = clamp01(options.intensity ?? 0.85);
  let modalOpen = false;
  let destroyed = false;
  let paused = false;
  let running = false;
  let rafId = 0;
  let lastTime = 0;
  let clock = 0;

  // No-op API used when WebGL fails or reduced motion
  const noopApi = {
    setIntensity(n) {
      intensity = clamp01(n);
    },
    setModalOpen(open) {
      modalOpen = !!open;
    },
    pulseSelect() {},
    bloomSuccess() {},
    destroy() {
      destroyed = true;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
  };

  if (prefersReduced) {
    return noopApi;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
  } catch {
    return noopApi;
  }

  if (!renderer.getContext()) {
    renderer.dispose();
    return noopApi;
  }

  const container =
    options.container ||
    document.getElementById('ambient-root') ||
    document.body;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0xf3f7f1, 1);

  const canvas = renderer.domElement;
  canvas.id = canvas.id || 'ambient-canvas';
  canvas.classList.add('ambient');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    zIndex: '0',
    pointerEvents: 'none',
    display: 'block',
  });
  container.appendChild(canvas);
  document.body.classList.add('has-ambient');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / Math.max(window.innerHeight, 1),
    0.1,
    50
  );
  camera.position.set(0, 0.2, 5.5);

  const ambient = setupAmbient(scene);

  // --- Effect systems ---
  const pulseGroup = new THREE.Group();
  scene.add(pulseGroup);
  /** @type {{ mesh: THREE.Mesh, born: number, life: number }[]} */
  const activePulses = [];

  const bloomGroup = new THREE.Group();
  scene.add(bloomGroup);
  /** @type {{ points: THREE.Points, born: number, life: number, velocities: Float32Array }[]} */
  const activeBlooms = [];

  function makePulseRing() {
    const geo = new THREE.RingGeometry(0.08, 0.22, 48);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4caf50,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2.4;
    mesh.position.set(0, -0.6, 0);
    return mesh;
  }

  function pulseSelect() {
    if (destroyed || prefersReduced) return;
    const mesh = makePulseRing();
    pulseGroup.add(mesh);
    activePulses.push({ mesh, born: clock, life: 0.4 });
  }

  function bloomSuccess() {
    if (destroyed || prefersReduced) return;
    const count = 48;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const greens = [0x66bb6a, 0x81c784, 0xaed581, 0xc5e1a5, 0xfff59d];

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 0.2;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 0.15 - 0.3;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.2;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.55;
      const speed = 0.8 + Math.random() * 1.4;
      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      velocities[i * 3 + 1] = Math.cos(phi) * speed * 0.85 + 0.3;
      velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;

      const c = new THREE.Color(greens[i % greens.length]);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.14,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geo, mat);
    bloomGroup.add(points);
    activeBlooms.push({
      points,
      born: clock,
      life: 1.25,
      velocities,
    });
  }

  function updateEffects(dt) {
    // Pulses
    for (let i = activePulses.length - 1; i >= 0; i--) {
      const p = activePulses[i];
      const age = clock - p.born;
      const t = age / p.life;
      if (t >= 1) {
        pulseGroup.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        activePulses.splice(i, 1);
        continue;
      }
      const scale = 1 + t * 6;
      p.mesh.scale.set(scale, scale, scale);
      p.mesh.material.opacity = 0.55 * (1 - t) * (1 - t);
    }

    // Blooms
    for (let i = activeBlooms.length - 1; i >= 0; i--) {
      const b = activeBlooms[i];
      const age = clock - b.born;
      const t = age / b.life;
      if (t >= 1) {
        bloomGroup.remove(b.points);
        b.points.geometry.dispose();
        b.points.material.dispose();
        activeBlooms.splice(i, 1);
        continue;
      }
      const pos = b.points.geometry.attributes.position.array;
      const n = pos.length / 3;
      const damp = 1 - t * 0.7;
      for (let j = 0; j < n; j++) {
        const jx = j * 3;
        pos[jx] += b.velocities[jx] * dt * damp;
        pos[jx + 1] += b.velocities[jx + 1] * dt * damp - 0.15 * dt;
        pos[jx + 2] += b.velocities[jx + 2] * dt * damp;
        // Settle: slow velocities over time
        b.velocities[jx] *= 1 - dt * 0.8;
        b.velocities[jx + 1] *= 1 - dt * 0.6;
        b.velocities[jx + 2] *= 1 - dt * 0.8;
      }
      b.points.geometry.attributes.position.needsUpdate = true;
      b.points.material.opacity = 0.9 * (1 - t * t);
      b.points.material.size = 0.14 * (1 - t * 0.4);
    }
  }

  function effectiveIntensity() {
    const base = intensity;
    return modalOpen ? base * 0.35 : base;
  }

  function applyIntensity() {
    const i = effectiveIntensity();
    if (ambient.points && ambient.points.material) {
      ambient.points.material.opacity = 0.25 + i * 0.4;
    }
    if (scene.fog) {
      scene.fog.density = 0.02 + (1 - i) * 0.05;
    }
    // Slight dim when modal open
    canvas.style.opacity = String(0.55 + i * 0.45);
  }

  applyIntensity();

  function onResize() {
    if (destroyed) return;
    const w = window.innerWidth;
    const h = Math.max(window.innerHeight, 1);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
  }

  function onVisibility() {
    if (document.hidden) {
      stopLoop();
    } else if (!paused && !destroyed) {
      startLoop();
    }
  }

  function frame(now) {
    if (!running || destroyed) return;
    rafId = requestAnimationFrame(frame);

    if (paused || document.hidden) return;

    const t = now * 0.001;
    const dt = lastTime ? Math.min(0.05, t - lastTime) : 0.016;
    lastTime = t;
    clock += dt;

    // Slow camera sway
    camera.position.x = Math.sin(clock * 0.12) * 0.25;
    camera.position.y = 0.2 + Math.sin(clock * 0.09) * 0.08;
    camera.lookAt(0, 0, 0);

    ambient.update(clock, dt);
    updateEffects(dt);
    renderer.render(scene, camera);
  }

  function startLoop() {
    if (running || destroyed) return;
    running = true;
    lastTime = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);

  if (!document.hidden) {
    startLoop();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stopLoop();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);

    for (const p of activePulses) {
      pulseGroup.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    activePulses.length = 0;

    for (const b of activeBlooms) {
      bloomGroup.remove(b.points);
      b.points.geometry.dispose();
      b.points.material.dispose();
    }
    activeBlooms.length = 0;

    ambient.dispose();
    scene.remove(pulseGroup);
    scene.remove(bloomGroup);

    if (canvas.parentNode) {
      canvas.parentNode.removeChild(canvas);
    }
    document.body.classList.remove('has-ambient', 'experience-ready');
    renderer.dispose();
  }

  return {
    setIntensity(n) {
      intensity = clamp01(n);
      applyIntensity();
    },
    setModalOpen(open) {
      modalOpen = !!open;
      applyIntensity();
    },
    pulseSelect,
    bloomSuccess,
    destroy,
    pause() {
      paused = true;
      stopLoop();
    },
    resume() {
      if (destroyed) return;
      paused = false;
      if (!document.hidden) startLoop();
    },
  };
}

function clamp01(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export default createExperience;

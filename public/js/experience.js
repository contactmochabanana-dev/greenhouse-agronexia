/**
 * Agronexia experience bootstrap (ES module).
 * Exposes window.AgronexiaExperience for non-module app.js.
 */
import { createExperience } from './three/renderer.js';

/** @type {ReturnType<typeof createExperience> | null} */
let experience = null;

function anyModalOpen() {
  return !!document.querySelector('.modal-overlay.open');
}

function syncModalState() {
  if (!experience) return;
  experience.setModalOpen(anyModalOpen());
}

function watchModals() {
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        syncModalState();
        return;
      }
    }
  });

  document.querySelectorAll('.modal-overlay').forEach((el) => {
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  });

  // Late-added overlays
  const bodyObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (
          node.nodeType === 1 &&
          node.classList &&
          node.classList.contains('modal-overlay')
        ) {
          observer.observe(node, {
            attributes: true,
            attributeFilter: ['class'],
          });
          syncModalState();
        }
      });
    }
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });

  // Custom event escape hatch
  window.addEventListener('agronexia:modal', (e) => {
    if (!experience) return;
    const open = e && e.detail && typeof e.detail.open === 'boolean'
      ? e.detail.open
      : anyModalOpen();
    experience.setModalOpen(open);
  });

  syncModalState();
  return { observer, bodyObserver };
}

function init() {
  if (experience) return experience;

  experience = createExperience({ intensity: 0.85 });
  document.body.classList.add('experience-ready');

  window.AgronexiaExperience = {
    setIntensity(n) {
      experience?.setIntensity(n);
    },
    setModalOpen(open) {
      experience?.setModalOpen(open);
    },
    pulseSelect() {
      experience?.pulseSelect();
    },
    bloomSuccess() {
      experience?.bloomSuccess();
    },
    destroy() {
      experience?.destroy();
      experience = null;
    },
    pause() {
      experience?.pause();
    },
    resume() {
      experience?.resume();
    },
  };

  watchModals();
  return experience;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { init, createExperience };
export default init;

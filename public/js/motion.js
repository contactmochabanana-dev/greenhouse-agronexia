/**
 * Agronexia motion + plant-like UI sounds (non-module).
 * Load as classic script: <script src="/js/motion.js"></script>
 *
 * localStorage key: agronexia-sound
 *   - missing or '1' = on (default)
 *   - '0' = off
 */
(function () {
  'use strict';

  var SOUND_KEY = 'agronexia-sound';
  var audioCtx = null;
  var unlockPromise = null;

  function soundEnabled() {
    try {
      var v = localStorage.getItem(SOUND_KEY);
      // Default ON so first visit has audio (user can mute in header)
      return v !== '0';
    } catch (e) {
      return true;
    }
  }

  function setSoundEnabled(on) {
    try {
      localStorage.setItem(SOUND_KEY, on ? '1' : '0');
    } catch (e) {
      /* ignore */
    }
  }

  function getCtx() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    return audioCtx;
  }

  /**
   * Browsers block audio until a user gesture. Always resume before playing.
   * @returns {Promise<AudioContext|null>}
   */
  function unlockAudio() {
    var ctx = getCtx();
    if (!ctx) return Promise.resolve(null);
    if (ctx.state === 'running') return Promise.resolve(ctx);
    if (!unlockPromise) {
      unlockPromise = ctx
        .resume()
        .then(function () {
          unlockPromise = null;
          return ctx;
        })
        .catch(function () {
          unlockPromise = null;
          return ctx;
        });
    }
    return unlockPromise;
  }

  // Unlock on first pointer/key so later programmatic plays work
  function installUnlockGesture() {
    var once = function () {
      unlockAudio();
      document.removeEventListener('pointerdown', once, true);
      document.removeEventListener('keydown', once, true);
    };
    document.addEventListener('pointerdown', once, true);
    document.addEventListener('keydown', once, true);
  }

  /**
   * Audible plant-like tone (sine + light triangle).
   * @param {number} freq
   * @param {number} duration sec
   * @param {number} [gain] peak 0–1
   * @param {number} [delay] sec
   * @param {AudioContext} ctx
   */
  function softTone(freq, duration, gain, delay, ctx) {
    if (!ctx) return;

    var t0 = ctx.currentTime + (delay || 0);
    var vol = typeof gain === 'number' ? gain : 0.18;
    var attack = 0.018;
    var release = Math.max(0.06, duration * 0.55);

    var osc = ctx.createOscillator();
    var osc2 = ctx.createOscillator();
    var g = ctx.createGain();
    var filter = ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t0);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(freq * 2.01, t0);
    osc2.detune.setValueAtTime(6, t0);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2800, t0);
    filter.Q.setValueAtTime(0.7, t0);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.001), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration + release);

    var mix = ctx.createGain();
    mix.gain.value = 1;
    var mix2 = ctx.createGain();
    mix2.gain.value = 0.22;

    osc.connect(mix);
    osc2.connect(mix2);
    mix.connect(filter);
    mix2.connect(filter);
    filter.connect(g);
    g.connect(ctx.destination);

    osc.start(t0);
    osc2.start(t0);
    osc.stop(t0 + duration + release + 0.05);
    osc2.stop(t0 + duration + release + 0.05);
  }

  function playWhenReady(fn) {
    if (!soundEnabled()) return;
    unlockAudio().then(function (ctx) {
      if (!ctx || !soundEnabled()) return;
      // If still suspended (rare), skip rather than silent schedule
      if (ctx.state === 'suspended') {
        ctx.resume().then(function () {
          if (ctx.state === 'running') fn(ctx);
        });
        return;
      }
      fn(ctx);
    });
  }

  function playClick() {
    playWhenReady(function (ctx) {
      softTone(523.25, 0.1, 0.2, 0, ctx); // C5
      softTone(659.25, 0.14, 0.16, 0.05, ctx); // E5
    });
  }

  function playCelebrate() {
    playWhenReady(function (ctx) {
      // Growth chime — clearly audible arpeggio
      softTone(392.0, 0.14, 0.18, 0, ctx); // G4
      softTone(493.88, 0.14, 0.2, 0.09, ctx); // B4
      softTone(587.33, 0.16, 0.22, 0.18, ctx); // D5
      softTone(783.99, 0.28, 0.2, 0.28, ctx); // G5
    });
  }

  function playSelect() {
    playWhenReady(function (ctx) {
      softTone(440, 0.09, 0.16, 0, ctx);
      softTone(554.37, 0.12, 0.14, 0.04, ctx);
    });
  }

  function celebrateSave() {
    if (window.AgronexiaExperience && typeof window.AgronexiaExperience.bloomSuccess === 'function') {
      window.AgronexiaExperience.bloomSuccess();
    }
    playCelebrate();
  }

  function markEntering(el) {
    if (window.AgronexiaExperience && typeof window.AgronexiaExperience.pulseSelect === 'function') {
      window.AgronexiaExperience.pulseSelect();
    }
    playSelect();

    if (!el || !el.classList) return;
    el.classList.remove('is-entering');
    void el.offsetWidth;
    el.classList.add('is-entering');

    window.setTimeout(function () {
      el.classList.remove('is-entering');
    }, 500);
  }

  function applyToggleUi(toggle, on) {
    if (!toggle) return;
    if (toggle.type === 'checkbox') {
      toggle.checked = on;
    } else {
      toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      toggle.dataset.sound = on ? '1' : '0';
      toggle.textContent = on ? 'Sound on' : 'Sound off';
      toggle.title = on ? 'Mute plant sounds' : 'Enable plant sounds';
    }
  }

  function wireSoundToggle() {
    var toggle = document.getElementById('soundToggle');
    if (!toggle) return;

    applyToggleUi(toggle, soundEnabled());

    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      var next = !soundEnabled();
      setSoundEnabled(next);
      applyToggleUi(toggle, next);
      if (next) {
        // Unlock under this click gesture, then play test chime
        unlockAudio().then(function (ctx) {
          if (ctx && soundEnabled()) {
            softTone(523.25, 0.12, 0.22, 0, ctx);
            softTone(783.99, 0.2, 0.18, 0.08, ctx);
          }
        });
      }
    });
  }

  window.AgronexiaMotion = {
    celebrateSave: celebrateSave,
    markEntering: markEntering,
    playClick: playClick,
    playSelect: playSelect,
    playCelebrate: playCelebrate,
    isSoundEnabled: soundEnabled,
    setSoundEnabled: setSoundEnabled,
    unlockAudio: unlockAudio,
  };

  installUnlockGesture();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireSoundToggle);
  } else {
    wireSoundToggle();
  }
})();

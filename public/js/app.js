const PAGE_SIZE = 100;

const state = {
  greenhouses: [],
  activeGreenhouseId: null,
  plants: [],
  total: 0,
  page: 1,
};

const el = {
  greenhouseList: document.getElementById('greenhouseList'),
  detailPanel: document.getElementById('detailPanel'),
  addGreenhouseBtn: document.getElementById('addGreenhouseBtn'),
  downloadAllBtn: document.getElementById('downloadAllBtn'),
  saveToast: document.getElementById('saveToast'),
  soundToggle: document.getElementById('soundToggle'),

  greenhouseModal: document.getElementById('greenhouseModal'),
  greenhouseModalTitle: document.getElementById('greenhouseModalTitle'),
  greenhouseForm: document.getElementById('greenhouseForm'),
  ghName: document.getElementById('ghName'),
  ghPlantType: document.getElementById('ghPlantType'),
  ghLocation: document.getElementById('ghLocation'),

  plantModal: document.getElementById('plantModal'),
  plantForm: document.getElementById('plantForm'),
  plQuantity: document.getElementById('plQuantity'),

  greenhouseDetailModal: document.getElementById('greenhouseDetailModal'),
  greenhouseDetailTitle: document.getElementById('greenhouseDetailTitle'),
  greenhouseDetailMeta: document.getElementById('greenhouseDetailMeta'),
  greenhouseDetailQrBtn: document.getElementById('greenhouseDetailQrBtn'),
  greenhouseDetailTabs: document.getElementById('greenhouseDetailTabs'),
  greenhouseDetailContent: document.getElementById('greenhouseDetailContent'),

  plantDetailModal: document.getElementById('plantDetailModal'),
  plantDetailTitle: document.getElementById('plantDetailTitle'),
  plantDetailMeta: document.getElementById('plantDetailMeta'),
  plantDetailQrBtn: document.getElementById('plantDetailQrBtn'),
  plantDetailTabs: document.getElementById('plantDetailTabs'),
  plantDetailContent: document.getElementById('plantDetailContent'),

  qrModal: document.getElementById('qrModal'),
  qrModalTitle: document.getElementById('qrModalTitle'),
  qrImage: document.getElementById('qrImage'),
  qrCodeLabel: document.getElementById('qrCodeLabel'),
  qrDownloadLink: document.getElementById('qrDownloadLink'),
  qrDeleteBtn: document.getElementById('qrDeleteBtn'),

  conditionsModal: document.getElementById('conditionsModal'),
  plantConditionsTitle: document.getElementById('plantConditionsTitle'),
  ghConditionsRows: document.getElementById('ghConditionsRows'),
  plantConditionsRows: document.getElementById('plantConditionsRows'),
  addGhConditionBtn: document.getElementById('addGhConditionBtn'),
  addPlantConditionBtn: document.getElementById('addPlantConditionBtn'),
  saveConditionsBtn: document.getElementById('saveConditionsBtn'),
};

let editingGreenhouseId = null;
let currentQrPlant = null;
let saveToastTimer = null;

// ---------- Experience / motion helpers ----------

function celebrateSave() {
  if (window.AgronexiaMotion?.celebrateSave) {
    window.AgronexiaMotion.celebrateSave();
  } else {
    window.AgronexiaExperience?.bloomSuccess?.();
  }
  showSaveToast();
}

function showSaveToast() {
  if (!el.saveToast) return;
  el.saveToast.textContent = 'Saved';
  el.saveToast.classList.add('show', 'success');
  if (saveToastTimer) clearTimeout(saveToastTimer);
  saveToastTimer = setTimeout(() => {
    el.saveToast.classList.remove('show', 'success');
  }, 1800);
}

function pulseSelect() {
  // markEntering already calls pulseSelect + soft click; prefer it when available
  if (window.AgronexiaMotion?.markEntering) {
    window.AgronexiaMotion.markEntering(el.detailPanel);
  } else {
    window.AgronexiaExperience?.pulseSelect?.();
  }
}

function syncSoundToggleLabel() {
  if (!el.soundToggle || el.soundToggle.type === 'checkbox') return;
  const on =
    window.AgronexiaMotion?.isSoundEnabled?.() ??
    el.soundToggle.getAttribute('aria-pressed') === 'true';
  el.soundToggle.textContent = on ? 'Sound on' : 'Sound off';
  el.soundToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
}

// ---------- API helpers ----------

async function api(path, opts) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------- Rendering ----------

function renderGreenhouseList() {
  el.greenhouseList.innerHTML = '';
  if (state.greenhouses.length === 0) {
    el.greenhouseList.innerHTML = `
      <li class="empty-state">
        <p>No greenhouses yet.</p>
        <p>Create one to start tracking plants and QR codes.</p>
      </li>`;
    return;
  }
  state.greenhouses.forEach((gh, i) => {
    const li = document.createElement('li');
    li.className = 'item-card' + (gh.id === state.activeGreenhouseId ? ' active' : '');
    li.style.animationDelay = `${i * 40}ms`;
    li.style.animation = 'fade-rise 420ms var(--ease, cubic-bezier(0.22, 1, 0.36, 1)) both';
    const countLabel = `${gh.plantCount} plant${gh.plantCount === 1 ? '' : 's'}`;
    li.innerHTML = `
      <div class="item-title">${escapeHtml(gh.name)}</div>
      <div class="item-sub">${escapeHtml(gh.plantType)} · <span class="count-pill">${escapeHtml(countLabel)}</span></div>
    `;
    li.addEventListener('click', () => selectGreenhouse(gh.id));
    el.greenhouseList.appendChild(li);
  });
}

function renderDetail() {
  const gh = state.greenhouses.find((g) => g.id === state.activeGreenhouseId);
  if (!gh) {
    el.detailPanel.innerHTML = `
      <div class="empty-state">
        <p>Select a greenhouse to view its plants, or create a new one.</p>
        <p>Each plant gets its own QR code for field logging.</p>
      </div>`;
    return;
  }

  const totalPages = Math.max(Math.ceil(state.total / PAGE_SIZE), 1);

  el.detailPanel.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>${escapeHtml(gh.name)}</h2>
        <div class="meta">${escapeHtml(gh.plantType)}${gh.location ? ' · ' + escapeHtml(gh.location) : ''} · ${gh.code} · <span class="count-pill">${state.total} plant${state.total === 1 ? '' : 's'}</span></div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-ghost btn-sm" id="editGhBtn">Edit Greenhouse Info</button>
        <button class="btn btn-secondary btn-sm" id="conditionsBtn">Edit Ideal Conditions</button>
        <button class="btn btn-secondary btn-sm" id="greenhouseDataBtn">View Greenhouse Data</button>
        <button class="btn btn-danger btn-sm" id="deleteGhBtn">Delete Greenhouse</button>
        <button class="btn btn-secondary btn-sm" id="downloadGhQrBtn">Download All QRs</button>
        <button class="btn btn-primary btn-sm" id="addPlantBtn">+ Add Plants</button>
      </div>
    </div>
    <div class="conditions-summary">
      <div class="conditions-summary-group">
        <h4>Ideal greenhouse conditions <span class="conditions-summary-hint">(target)</span></h4>
        <div class="conditions-summary-list">${renderConditionsSummary(gh.greenhouseConditions)}</div>
      </div>
      <div class="conditions-summary-group">
        <h4>Ideal ${escapeHtml(gh.plantType)} conditions <span class="conditions-summary-hint">(target)</span></h4>
        <div class="conditions-summary-list">${renderConditionsSummary(gh.plantConditions)}</div>
      </div>
    </div>
    <div class="find-bar">
      <input type="text" id="findInput" placeholder="Find plant by number or code (e.g. 452 or PL-XXXXXX)" />
      <button class="btn btn-secondary btn-sm" id="findBtn">Find</button>
    </div>
    <div id="plantListBody"></div>
  `;

  document.getElementById('editGhBtn').addEventListener('click', () => openGreenhouseModal(gh));
  document.getElementById('conditionsBtn').addEventListener('click', () => openConditionsModal(gh));
  document.getElementById('greenhouseDataBtn').addEventListener('click', () => openGreenhouseDetailModal(gh));
  document.getElementById('deleteGhBtn').addEventListener('click', () => deleteGreenhouse(gh.id));
  document.getElementById('downloadGhQrBtn').addEventListener('click', () => {
    window.location.href = `/api/greenhouses/${gh.id}/qr-all.zip`;
  });
  document.getElementById('addPlantBtn').addEventListener('click', () => openPlantModal());

  const findInput = document.getElementById('findInput');
  const runFind = () => findPlant(findInput.value.trim());
  document.getElementById('findBtn').addEventListener('click', runFind);
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runFind();
    }
  });

  const body = document.getElementById('plantListBody');
  if (state.plants.length === 0) {
    body.innerHTML = `
      <div class="empty-state">
        <p>No plants in this greenhouse yet.</p>
        <p>Use + Add Plants to batch-create numbered plants with QR codes.</p>
      </div>`;
    return;
  }

  const chips = state.plants
    .map((plant) => {
      const health = plant.health || 'unknown';
      return `<button type="button" class="plant-chip health-${escapeHtml(health)}" data-id="${plant.id}" title="${escapeHtml(healthTitle(plant))}">#${plant.number}</button>`;
    })
    .join('');

  body.innerHTML = `
    <div class="health-legend" aria-label="Plant health legend">
      <span class="health-legend-item"><i class="swatch health-ok"></i> Fine</span>
      <span class="health-legend-item"><i class="swatch health-warn"></i> Worrisome</span>
      <span class="health-legend-item"><i class="swatch health-critical"></i> Alert</span>
      <span class="health-legend-item"><i class="swatch health-unknown"></i> No readings yet</span>
    </div>
    <div class="plant-grid">${chips}</div>
    <div class="pagination">
      <button class="btn btn-ghost btn-sm" id="prevPageBtn" ${state.page <= 1 ? 'disabled' : ''}>Prev</button>
      <span class="page-info">Page ${state.page} of ${totalPages} (${PAGE_SIZE} per page)</span>
      <button class="btn btn-ghost btn-sm" id="nextPageBtn" ${state.page >= totalPages ? 'disabled' : ''}>Next</button>
    </div>
  `;

  body.querySelectorAll('.plant-chip').forEach((chip) => {
    const plant = state.plants.find((p) => p.id === chip.dataset.id);
    chip.addEventListener('click', () => openPlantDetailModal(plant, gh));
  });

  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  if (prevBtn) prevBtn.addEventListener('click', () => loadPlantPage(state.page - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => loadPlantPage(state.page + 1));
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function pickRange(c, keys) {
  for (const k of keys) {
    if (c[k] !== undefined && c[k] !== null && String(c[k]).trim() !== '') return String(c[k]).trim();
  }
  return '';
}

function formatRanges(c) {
  if (c.rangeMode === 'bands' && Array.isArray(c.bands) && c.bands.length) {
    const group = { ok: [], warn: [], critical: [] };
    for (const b of c.bands) {
      const lv = b.level === 'ok' || b.level === 'warn' || b.level === 'critical' ? b.level : 'ok';
      group[lv].push(`${b.min}–${b.max}`);
    }
    const parts = [];
    if (group.ok.length) parts.push(`Good ${group.ok.map(escapeHtml).join(', ')}`);
    if (group.warn.length) parts.push(`Worrisome ${group.warn.map(escapeHtml).join(', ')}`);
    if (group.critical.length) parts.push(`Alert ${group.critical.map(escapeHtml).join(', ')}`);
    return parts.length ? `<span class="range-meta">${parts.join(' · ')}</span>` : '';
  }
  const fineMin = pickRange(c, ['fineMin', 'okMin', 'warnMin']);
  const fineMax = pickRange(c, ['fineMax', 'okMax', 'warnMax']);
  const alertBelow = pickRange(c, ['alertBelow', 'acceptableMin', 'critMin']);
  const alertAbove = pickRange(c, ['alertAbove', 'acceptableMax', 'critMax']);
  if (!fineMin && !fineMax && !alertBelow && !alertAbove) return '';
  const parts = [];
  if (fineMin && fineMax) parts.push(`Fine ${escapeHtml(fineMin)}–${escapeHtml(fineMax)}`);
  if (alertBelow && alertAbove) {
    parts.push(`Alert below ${escapeHtml(alertBelow)} or above ${escapeHtml(alertAbove)}`);
  }
  return `<span class="range-meta">${parts.join(' · ')}</span>`;
}

function renderConditionsSummary(list) {
  if (!list || list.length === 0) return '<span class="none">Not set</span>';
  return list
    .map(
      (c) =>
        `<div>
          ${escapeHtml(c.parameter)}:
          <strong>${escapeHtml(c.value)}</strong>${c.unit ? ' ' + escapeHtml(c.unit) : ''}
          ${formatRanges(c)}
        </div>`
    )
    .join('');
}

function healthTitle(plant) {
  const h = plant.health || 'unknown';
  if (h === 'ok') return `${plant.code} · on target`;
  if (h === 'warn') return `${plant.code} · worrisome${plant.worstParameter ? ' (' + plant.worstParameter + ')' : ''}`;
  if (h === 'critical') return `${plant.code} · needs attention${plant.worstParameter ? ' (' + plant.worstParameter + ')' : ''}`;
  return `${plant.code} · no readings yet`;
}

// ---------- Data loading ----------

async function loadGreenhouses() {
  state.greenhouses = await api('/greenhouses');
  renderGreenhouseList();
}

async function selectGreenhouse(id) {
  state.activeGreenhouseId = id;
  renderGreenhouseList();
  pulseSelect();
  try {
    await loadPlantPage(1);
  } catch (err) {
    // The greenhouse may have been deleted elsewhere since the list was loaded.
    state.activeGreenhouseId = null;
    await loadGreenhouses();
    renderDetail();
    alert(err.message);
  }
}

async function loadPlantPage(page) {
  const res = await api(`/greenhouses/${state.activeGreenhouseId}/plants?page=${page}&pageSize=${PAGE_SIZE}`);
  state.plants = res.plants;
  state.total = res.total;
  state.page = res.page;
  renderDetail();
}

async function refreshActive() {
  await loadGreenhouses();
  if (state.activeGreenhouseId) {
    await loadPlantPage(state.page);
  } else {
    renderDetail();
  }
}

async function findPlant(query) {
  if (!query) return;
  const gh = state.greenhouses.find((g) => g.id === state.activeGreenhouseId);
  try {
    const res = await api(
      `/greenhouses/${state.activeGreenhouseId}/plants/find?q=${encodeURIComponent(query)}&pageSize=${PAGE_SIZE}`
    );
    if (res.page !== state.page) {
      await loadPlantPage(res.page);
    }
    openPlantDetailModal(res.plant, gh);
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Greenhouse modal ----------

function openGreenhouseModal(gh) {
  editingGreenhouseId = gh ? gh.id : null;
  el.greenhouseModalTitle.textContent = gh ? 'Edit Greenhouse' : 'Add Greenhouse';
  el.ghName.value = gh ? gh.name : '';
  el.ghPlantType.value = gh ? gh.plantType : '';
  el.ghLocation.value = gh ? gh.location : '';
  el.greenhouseModal.classList.add('open');
  el.ghName.focus();
}

function closeGreenhouseModal() {
  el.greenhouseModal.classList.remove('open');
  el.greenhouseForm.reset();
  editingGreenhouseId = null;
}

el.addGreenhouseBtn.addEventListener('click', () => openGreenhouseModal());

el.greenhouseForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = { name: el.ghName.value, plantType: el.ghPlantType.value, location: el.ghLocation.value };
  try {
    if (editingGreenhouseId) {
      await api(`/greenhouses/${editingGreenhouseId}`, { method: 'PUT', body: JSON.stringify(payload) });
      closeGreenhouseModal();
      await refreshActive();
      celebrateSave();
    } else {
      const created = await api('/greenhouses', { method: 'POST', body: JSON.stringify(payload) });
      closeGreenhouseModal();
      await loadGreenhouses();
      await selectGreenhouse(created.id);
      celebrateSave();
    }
  } catch (err) {
    alert(err.message);
  }
});

async function deleteGreenhouse(id) {
  if (!confirm('Delete this greenhouse and all its plants? This cannot be undone.')) return;
  await api(`/greenhouses/${id}`, { method: 'DELETE' });
  state.activeGreenhouseId = null;
  state.plants = [];
  state.total = 0;
  state.page = 1;
  await loadGreenhouses();
  renderDetail();
}

// ---------- Plant modal ----------

function openPlantModal() {
  el.plantModal.classList.add('open');
  el.plQuantity.focus();
}

function closePlantModal() {
  el.plantModal.classList.remove('open');
  el.plantForm.reset();
}

el.plantForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/greenhouses/${state.activeGreenhouseId}/plants`, {
      method: 'POST',
      body: JSON.stringify({ quantity: el.plQuantity.value }),
    });
    closePlantModal();
    await refreshActive();
    celebrateSave();
  } catch (err) {
    alert(err.message);
  }
});

async function deletePlant(id) {
  await api(`/plants/${id}`, { method: 'DELETE' });
  await refreshActive();
}

// ---------- Ideal Conditions modal ----------

let conditionsGreenhouseId = null;

function fieldVal(condition, keys) {
  if (!condition) return '';
  for (const k of keys) {
    if (condition[k] !== undefined && condition[k] !== null && String(condition[k]).trim() !== '') {
      return String(condition[k]).trim();
    }
  }
  return '';
}

function detectRangeMode(condition) {
  if (!condition) return 'bands';
  if (condition.rangeMode === 'simple') return 'simple';
  if (condition.rangeMode === 'bands') return 'bands';
  if (Array.isArray(condition.bands) && condition.bands.length > 0) return 'bands';
  // Legacy simple fields only → simple; otherwise prefer custom (what you described)
  const hasSimple =
    fieldVal(condition, ['fineMin', 'okMin', 'warnMin']) &&
    fieldVal(condition, ['fineMax', 'okMax', 'warnMax']);
  return hasSimple ? 'simple' : 'bands';
}

function bandsForLevel(condition, level) {
  const list = Array.isArray(condition?.bands) ? condition.bands : [];
  const aliases = {
    ok: ['ok', 'good', 'fine'],
    warn: ['warn', 'bad', 'worrisome', 'warning'],
    critical: ['critical', 'worse', 'alert', 'danger'],
  };
  const names = aliases[level] || [level];
  const found = list.filter((b) => names.includes(String(b.level || '').toLowerCase()));
  if (found.length) return found.map((b) => ({ min: b.min ?? '', max: b.max ?? '' }));
  return [{ min: '', max: '' }];
}

/** Turn simple fine/alert fields into Good / Bad / Worse rows. */
function convertSimpleFieldsToBands(fineMin, fineMax, alertBelow, alertAbove) {
  const fMin = parseFloat(fineMin);
  const fMax = parseFloat(fineMax);
  const aBelow = parseFloat(alertBelow);
  const aAbove = parseFloat(alertAbove);
  const good = [];
  const bad = [];
  const worse = [];

  if (Number.isFinite(fMin) && Number.isFinite(fMax) && fMin < fMax) {
    good.push({ min: String(fineMin), max: String(fineMax) });
  } else {
    good.push({ min: '', max: '' });
  }

  if (Number.isFinite(aBelow) && Number.isFinite(fMin) && aBelow < fMin) {
    bad.push({ min: String(alertBelow), max: String(fineMin) });
  }
  if (Number.isFinite(fMax) && Number.isFinite(aAbove) && fMax < aAbove) {
    bad.push({ min: String(fineMax), max: String(alertAbove) });
  }
  if (!bad.length) bad.push({ min: '', max: '' });

  // Leave worse empty for the user to type e.g. 2–4 and 7–9
  worse.push({ min: '', max: '' });

  return { good, bad, worse };
}

function makeBandRowHtml(min, max) {
  return `
    <div class="band-interval-row">
      <input type="number" step="any" class="band-min" placeholder="min" value="${escapeHtml(min ?? '')}" />
      <span class="range-sep">–</span>
      <input type="number" step="any" class="band-max" placeholder="max" value="${escapeHtml(max ?? '')}" />
      <button type="button" class="band-remove" title="Remove" aria-label="Remove">×</button>
    </div>`;
}

function fillBandLevel(host, intervals) {
  const list = intervals && intervals.length ? intervals : [{ min: '', max: '' }];
  host.innerHTML = list.map((b) => makeBandRowHtml(b.min, b.max)).join('');
  wireBandRemove(host);
}

function setConditionRowMode(row, mode, { convert = false } = {}) {
  row.dataset.rangeMode = mode;
  row.querySelectorAll('.range-mode-btn').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const simple = row.querySelector('.cond-simple-panel');
  const bands = row.querySelector('.cond-bands-panel');
  if (simple) simple.classList.toggle('is-hidden', mode !== 'simple');
  if (bands) bands.classList.toggle('is-hidden', mode !== 'bands');

  if (mode === 'bands' && convert) {
    const fineMin = row.querySelector('.cond-fine-min')?.value.trim() || '';
    const fineMax = row.querySelector('.cond-fine-max')?.value.trim() || '';
    const alertBelow = row.querySelector('.cond-alert-below')?.value.trim() || '';
    const alertAbove = row.querySelector('.cond-alert-above')?.value.trim() || '';
    const converted = convertSimpleFieldsToBands(fineMin, fineMax, alertBelow, alertAbove);
    fillBandLevel(row.querySelector('.band-level[data-level="ok"] .band-intervals'), converted.good);
    fillBandLevel(row.querySelector('.band-level[data-level="warn"] .band-intervals'), converted.bad);
    fillBandLevel(row.querySelector('.band-level[data-level="critical"] .band-intervals'), converted.worse);
  }
}

function makeConditionRow(condition) {
  const mode = detectRangeMode(condition);
  const fineMin = fieldVal(condition, ['fineMin', 'okMin', 'warnMin']);
  const fineMax = fieldVal(condition, ['fineMax', 'okMax', 'warnMax']);
  const alertBelow = fieldVal(condition, ['alertBelow', 'acceptableMin', 'critMin']);
  const alertAbove = fieldVal(condition, ['alertAbove', 'acceptableMax', 'critMax']);

  let goodBands = bandsForLevel(condition, 'ok');
  let warnBands = bandsForLevel(condition, 'warn');
  let critBands = bandsForLevel(condition, 'critical');

  // If opening in bands mode but only simple fields exist, prefill from simple
  if (
    mode === 'bands' &&
    !(Array.isArray(condition?.bands) && condition.bands.length) &&
    fineMin &&
    fineMax
  ) {
    const c = convertSimpleFieldsToBands(fineMin, fineMax, alertBelow, alertAbove);
    goodBands = c.good;
    warnBands = c.bad;
    critBands = c.worse;
  }

  const row = document.createElement('div');
  row.className = 'condition-row';
  row.dataset.rangeMode = mode;
  row.innerHTML = `
    <div class="condition-row-top">
      <div class="condition-row-main">
        <input type="text" class="cond-parameter" placeholder="Parameter" value="${escapeHtml(condition?.parameter || '')}" />
        <input type="text" class="cond-value" placeholder="Ideal" value="${escapeHtml(condition?.value || '')}" title="Ideal target" />
        <input type="text" class="cond-unit" placeholder="Unit" value="${escapeHtml(condition?.unit || '')}" />
      </div>
      <div class="condition-row-tools">
        <div class="range-mode-toggle" role="group" aria-label="Range style">
          <button type="button" class="range-mode-btn ${mode === 'bands' ? 'active' : ''}" data-mode="bands" aria-pressed="${mode === 'bands'}">Custom</button>
          <button type="button" class="range-mode-btn ${mode === 'simple' ? 'active' : ''}" data-mode="simple" aria-pressed="${mode === 'simple'}">Simple</button>
        </div>
        <button type="button" class="remove-row-btn" title="Remove parameter">×</button>
      </div>
    </div>

    <div class="cond-bands-panel ${mode === 'bands' ? '' : 'is-hidden'}">
      <div class="band-grid">
        <div class="band-level" data-level="ok">
          <div class="band-level-head">
            <span class="dot dot-ok"></span>
            <span class="band-level-name">Good</span>
            <button type="button" class="band-add" title="Add good span">+</button>
          </div>
          <div class="band-intervals">${goodBands.map((b) => makeBandRowHtml(b.min, b.max)).join('')}</div>
        </div>
        <div class="band-level" data-level="warn">
          <div class="band-level-head">
            <span class="dot dot-warn"></span>
            <span class="band-level-name">Bad</span>
            <button type="button" class="band-add" title="Add bad span">+</button>
          </div>
          <div class="band-intervals">${warnBands.map((b) => makeBandRowHtml(b.min, b.max)).join('')}</div>
        </div>
        <div class="band-level" data-level="critical">
          <div class="band-level-head">
            <span class="dot dot-crit"></span>
            <span class="band-level-name">Worse</span>
            <button type="button" class="band-add" title="Add worse span">+</button>
          </div>
          <div class="band-intervals">${critBands.map((b) => makeBandRowHtml(b.min, b.max)).join('')}</div>
        </div>
      </div>
    </div>

    <div class="cond-simple-panel ${mode === 'simple' ? '' : 'is-hidden'}">
      <div class="simple-grid">
        <label class="simple-field">
          <span><span class="dot dot-ok"></span> Fine</span>
          <span class="range-inputs">
            <input type="number" step="any" class="cond-fine-min" placeholder="min" value="${escapeHtml(fineMin)}" />
            <span class="range-sep">–</span>
            <input type="number" step="any" class="cond-fine-max" placeholder="max" value="${escapeHtml(fineMax)}" />
          </span>
        </label>
        <label class="simple-field">
          <span><span class="dot dot-crit"></span> Alert outside</span>
          <span class="range-inputs">
            <input type="number" step="any" class="cond-alert-below" placeholder="below" value="${escapeHtml(alertBelow)}" />
            <span class="range-sep">/</span>
            <input type="number" step="any" class="cond-alert-above" placeholder="above" value="${escapeHtml(alertAbove)}" />
          </span>
        </label>
      </div>
    </div>
  `;

  row.querySelector('.remove-row-btn').addEventListener('click', () => row.remove());

  row.querySelectorAll('.range-mode-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const m = btn.dataset.mode;
      const prev = row.dataset.rangeMode;
      setConditionRowMode(row, m, { convert: m === 'bands' && prev === 'simple' });
    });
  });

  row.querySelectorAll('.band-add').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const host = btn.closest('.band-level').querySelector('.band-intervals');
      host.insertAdjacentHTML('beforeend', makeBandRowHtml('', ''));
      wireBandRemove(host);
    });
  });

  row.querySelectorAll('.band-intervals').forEach((host) => wireBandRemove(host));

  return row;
}

function wireBandRemove(host) {
  host.querySelectorAll('.band-remove').forEach((btn) => {
    btn.onclick = () => {
      const rows = host.querySelectorAll('.band-interval-row');
      if (rows.length <= 1) {
        rows[0].querySelector('.band-min').value = '';
        rows[0].querySelector('.band-max').value = '';
        return;
      }
      btn.closest('.band-interval-row').remove();
    };
  });
}

function collectBandsFromPanel(panel, level) {
  const block = panel.querySelector(`.band-level[data-level="${level}"]`);
  if (!block) return [];
  const bands = [];
  block.querySelectorAll('.band-interval-row').forEach((r) => {
    const min = r.querySelector('.band-min').value.trim();
    const max = r.querySelector('.band-max').value.trim();
    if (min === '' && max === '') return;
    bands.push({ level, min, max });
  });
  return bands;
}

function renderConditionRows(container, list) {
  container.innerHTML = '';
  if (!list || list.length === 0) {
    container.appendChild(makeConditionRow());
    return;
  }
  for (const condition of list) {
    container.appendChild(makeConditionRow(condition));
  }
}

function collectConditionRows(container) {
  const rows = [...container.querySelectorAll('.condition-row')];
  return rows
    .map((row) => {
      const mode = row.dataset.rangeMode || 'simple';
      const base = {
        parameter: row.querySelector('.cond-parameter').value.trim(),
        value: row.querySelector('.cond-value').value.trim(),
        unit: row.querySelector('.cond-unit').value.trim(),
        rangeMode: mode,
      };
      if (mode === 'bands') {
        const panel = row.querySelector('.cond-bands-panel');
        base.bands = [
          ...collectBandsFromPanel(panel, 'ok'),
          ...collectBandsFromPanel(panel, 'warn'),
          ...collectBandsFromPanel(panel, 'critical'),
        ];
        base.fineMin = '';
        base.fineMax = '';
        base.alertBelow = '';
        base.alertAbove = '';
      } else {
        base.fineMin = row.querySelector('.cond-fine-min').value.trim();
        base.fineMax = row.querySelector('.cond-fine-max').value.trim();
        base.alertBelow = row.querySelector('.cond-alert-below').value.trim();
        base.alertAbove = row.querySelector('.cond-alert-above').value.trim();
        base.bands = [];
      }
      return base;
    })
    .filter((c) => c.parameter);
}

/** Client-side validation for simple + custom band modes. */
function validateConditionRanges(list) {
  const levelName = { ok: 'Good', warn: 'Bad', critical: 'Worse' };
  for (const c of list) {
    const name = c.parameter || 'Parameter';
    if (c.rangeMode === 'bands') {
      const bands = Array.isArray(c.bands) ? c.bands : [];
      const parsed = [];
      for (const b of bands) {
        const min = b.min === '' ? NaN : parseFloat(b.min);
        const max = b.max === '' ? NaN : parseFloat(b.max);
        if (!Number.isFinite(min) && !Number.isFinite(max)) continue;
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
          return `${name}: Each range needs both “from” and “to”.`;
        }
        if (!(min < max)) {
          return `${name}: Range “from” must be less than “to” (${b.min}–${b.max}).`;
        }
        parsed.push({
          level: b.level,
          min,
          max,
          label: `${levelName[b.level] || b.level} ${b.min}–${b.max}`,
        });
      }
      if (!parsed.some((b) => b.level === 'ok')) {
        return `${name}: Add at least one Good range.`;
      }
      // No overlap and no nesting (one range inside another) across good/bad/worse
      for (let i = 0; i < parsed.length; i++) {
        for (let j = i + 1; j < parsed.length; j++) {
          const a = parsed[i];
          const b = parsed[j];
          const overlap = Math.min(a.max, b.max) - Math.max(a.min, b.min);
          if (overlap > 1e-12) {
            return (
              `${name}: ${a.label} overlaps ${b.label}. ` +
              'Good, bad, and worse must not cover or include each other’s values.'
            );
          }
        }
      }
      continue;
    }

    const fMin = c.fineMin === '' ? NaN : parseFloat(c.fineMin);
    const fMax = c.fineMax === '' ? NaN : parseFloat(c.fineMax);
    const aBelow = c.alertBelow === '' ? NaN : parseFloat(c.alertBelow);
    const aAbove = c.alertAbove === '' ? NaN : parseFloat(c.alertAbove);
    const hasFMin = Number.isFinite(fMin);
    const hasFMax = Number.isFinite(fMax);
    const hasABelow = Number.isFinite(aBelow);
    const hasAAbove = Number.isFinite(aAbove);

    if (hasFMin !== hasFMax) return `${name}: Fine zone needs both “from” and “to”.`;
    if (hasABelow !== hasAAbove) return `${name}: Alert needs both “below” and “above”.`;
    if (hasFMin && hasFMax && !(fMin < fMax)) return `${name}: Fine “from” must be less than “to”.`;
    if (hasABelow && hasAAbove && !(aBelow < aAbove)) {
      return `${name}: Alert “below” must be less than alert “above”.`;
    }
    if (hasFMin && hasFMax && hasABelow && hasAAbove) {
      if (!(aBelow < fMin)) {
        return `${name}: Alert “below” must be less than fine “from” (no overlap).`;
      }
      if (!(aAbove > fMax)) {
        return `${name}: Alert “above” must be greater than fine “to” (no overlap).`;
      }
    }
  }
  return null;
}

function openConditionsModal(gh) {
  conditionsGreenhouseId = gh.id;
  el.plantConditionsTitle.textContent = `Ideal ${gh.plantType} conditions`;
  renderConditionRows(el.ghConditionsRows, gh.greenhouseConditions);
  renderConditionRows(el.plantConditionsRows, gh.plantConditions);
  el.conditionsModal.classList.add('open');
}

function closeConditionsModal() {
  el.conditionsModal.classList.remove('open');
  conditionsGreenhouseId = null;
}

el.addGhConditionBtn.addEventListener('click', () => {
  el.ghConditionsRows.appendChild(makeConditionRow());
});
el.addPlantConditionBtn.addEventListener('click', () => {
  el.plantConditionsRows.appendChild(makeConditionRow());
});

el.saveConditionsBtn.addEventListener('click', async () => {
  if (!conditionsGreenhouseId) return;
  const payload = {
    greenhouseConditions: collectConditionRows(el.ghConditionsRows),
    plantConditions: collectConditionRows(el.plantConditionsRows),
  };
  const rangeError =
    validateConditionRanges(payload.greenhouseConditions) ||
    validateConditionRanges(payload.plantConditions);
  if (rangeError) {
    alert(rangeError);
    return;
  }
  try {
    await api(`/greenhouses/${conditionsGreenhouseId}/conditions`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    closeConditionsModal();
    await refreshActive();
    celebrateSave();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Detail modals (line chart + day-to-day list) ----------
// Greenhouse-level and plant-level detail are separate instances and never
// mix readings across scopes.

function renderDetailTabs(tabsEl, state, onSelect) {
  const { parameters, activeParameter } = state;
  if (parameters.length === 0) {
    tabsEl.innerHTML = '';
    return;
  }
  tabsEl.innerHTML = parameters
    .map(
      (p) =>
        `<button class="tab-btn${p.parameter === activeParameter ? ' active' : ''}" data-param="${escapeHtml(p.parameter)}">${escapeHtml(p.parameter)}</button>`
    )
    .join('');
  tabsEl.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeParameter = btn.dataset.param;
      onSelect();
    });
  });
}

function formatChartDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatChartDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Day-to-day line chart (SVG). Chronological left → right.
 * @param {Array<{ value: string, enteredAt: string }>} chronologicalReadings oldest first
 * @param {string|number|null} idealTarget
 */
function buildLineChartHtml(chronologicalReadings, idealTarget) {
  const points = chronologicalReadings
    .map((r) => ({
      t: new Date(r.enteredAt).getTime(),
      v: parseFloat(r.value),
      raw: r.value,
      enteredAt: r.enteredAt,
    }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));

  if (points.length === 0) {
    return `<p class="chart-empty">Readings for this parameter are not numeric, so a line chart is not shown.</p>`;
  }

  const W = 560;
  const H = 200;
  const padL = 40;
  const padR = 16;
  const padT = 16;
  const padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const ideal = parseFloat(idealTarget);
  const hasIdeal = Number.isFinite(ideal);

  let yMin = Math.min(...points.map((p) => p.v));
  let yMax = Math.max(...points.map((p) => p.v));
  if (hasIdeal) {
    yMin = Math.min(yMin, ideal);
    yMax = Math.max(yMax, ideal);
  }
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  // small padding so line is not on the edge
  const yPad = (yMax - yMin) * 0.12 || 0.5;
  yMin -= yPad;
  yMax += yPad;

  const tMin = points[0].t;
  const tMax = points[points.length - 1].t;
  const tSpan = Math.max(tMax - tMin, 1);

  const xAt = (t) => padL + ((t - tMin) / tSpan) * plotW;
  const yAt = (v) => padT + ((yMax - v) / (yMax - yMin)) * plotH;

  const coords = points.map((p) => ({
    x: xAt(p.t),
    y: yAt(p.v),
    ...p,
  }));

  const lineD = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(' ');

  // Area under line for a soft fill
  const areaD =
    lineD +
    ` L${coords[coords.length - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)}` +
    ` L${coords[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  // Y ticks (3–4)
  const yTicks = 4;
  let yGrid = '';
  let yLabels = '';
  for (let i = 0; i <= yTicks; i++) {
    const v = yMin + ((yMax - yMin) * i) / yTicks;
    const y = yAt(v);
    yGrid += `<line class="chart-grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" />`;
    yLabels += `<text class="chart-axis-label" x="${padL - 6}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle">${v.toFixed(1)}</text>`;
  }

  // X labels: first, middle, last (avoid clutter)
  const xLabelIdx = new Set([0, coords.length - 1]);
  if (coords.length > 2) xLabelIdx.add(Math.floor((coords.length - 1) / 2));
  let xLabels = '';
  for (const i of xLabelIdx) {
    const c = coords[i];
    xLabels += `<text class="chart-axis-label" x="${c.x.toFixed(1)}" y="${H - 10}" text-anchor="middle">${escapeHtml(formatChartDate(c.enteredAt))}</text>`;
  }

  let idealLine = '';
  if (hasIdeal) {
    const y = yAt(ideal);
    idealLine = `
      <line class="chart-ideal" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" />
      <text class="chart-ideal-label" x="${W - padR}" y="${(y - 4).toFixed(1)}" text-anchor="end">Ideal ${ideal}</text>
    `;
  }

  const dots = coords
    .map(
      (c) =>
        `<circle class="chart-dot" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.5">
          <title>${escapeHtml(String(c.raw))} · ${escapeHtml(formatChartDateTime(c.enteredAt))}</title>
        </circle>`
    )
    .join('');

  return `
    <div class="readings-chart" role="img" aria-label="Line chart of readings over time">
      <svg class="line-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        ${yGrid}
        ${idealLine}
        <path class="chart-area" d="${areaD}" />
        <path class="chart-line" d="${lineD}" fill="none" />
        ${dots}
        ${yLabels}
        ${xLabels}
      </svg>
      <div class="chart-caption">Day-to-day readings (oldest → newest)</div>
    </div>
  `;
}

function renderDetailContent(contentEl, state, emptyMessage) {
  const { readings, parameters, activeParameter } = state;
  if (!activeParameter) {
    contentEl.innerHTML = `<div class="empty-state"><p>${emptyMessage}</p></div>`;
    return;
  }
  const param = parameters.find((p) => p.parameter === activeParameter);
  // Newest first for the list
  const paramReadingsNewest = readings
    .filter((r) => r.parameter === activeParameter)
    .sort((a, b) => new Date(b.enteredAt) - new Date(a.enteredAt));
  // Oldest first for the line chart
  const paramReadingsChrono = [...paramReadingsNewest].reverse();

  const targetHint =
    param && param.value
      ? `<p class="tab-target">Ideal: ${escapeHtml(param.value)}${param.unit ? ' ' + escapeHtml(param.unit) : ''}</p>`
      : '';

  if (paramReadingsNewest.length === 0) {
    contentEl.innerHTML = `${targetHint}<div class="empty-state"><p>No readings entered yet for this parameter.</p></div>`;
    return;
  }

  const chartHtml = buildLineChartHtml(paramReadingsChrono, param?.value);

  const listHtml = `
    <h4 class="readings-heading">Log</h4>
    <ul class="readings-list">
      ${paramReadingsNewest
        .map(
          (r) => `
        <li>
          <span class="reading-value">${escapeHtml(r.value)}${r.unit ? ' ' + escapeHtml(r.unit) : ''}</span>
          <span class="reading-time">${new Date(r.enteredAt).toLocaleString()}</span>
        </li>`
        )
        .join('')}
    </ul>
  `;

  contentEl.innerHTML = targetHint + chartHtml + listHtml;
}

// ---- Plant Detail modal instance: plant-specific parameters only ----

let plantDetailState = null; // { plant, gh, readings, parameters, activeParameter }

async function openPlantDetailModal(plant, gh) {
  el.plantDetailTitle.textContent = `${gh.plantType} #${plant.number}`;
  el.plantDetailMeta.textContent = `${gh.name} · ${gh.code} / ${plant.code}`;
  el.plantDetailTabs.innerHTML = '';
  el.plantDetailContent.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  el.plantDetailModal.classList.add('open');

  const parameters = (gh.plantConditions || []).map((c) => ({ ...c, source: 'plant' }));

  let readings = [];
  try {
    readings = await api(`/plants/${plant.id}/readings`);
  } catch (err) {
    el.plantDetailContent.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
    return;
  }

  // Include any parameter that has readings but is no longer an ideal-condition
  // entry (e.g. removed later), so past data is never hidden.
  const names = new Map(parameters.map((p) => [p.parameter, p]));
  for (const r of readings) {
    if (!names.has(r.parameter)) names.set(r.parameter, { parameter: r.parameter, value: '', unit: r.unit, source: 'plant' });
  }

  plantDetailState = { plant, gh, readings, parameters: [...names.values()], activeParameter: null };
  plantDetailState.activeParameter = plantDetailState.parameters[0]?.parameter || null;
  renderPlantDetailAll();
}

function renderPlantDetailAll() {
  renderDetailTabs(el.plantDetailTabs, plantDetailState, renderPlantDetailAll);
  renderDetailContent(el.plantDetailContent, plantDetailState, 'No plant-specific parameters configured for this greenhouse yet.');
}

el.plantDetailQrBtn.addEventListener('click', () => {
  if (!plantDetailState) return;
  openQrModal(plantDetailState.plant, plantDetailState.gh);
});

// ---- Greenhouse Detail modal instance: greenhouse-wide parameters only ----

let greenhouseDetailState = null; // { gh, readings, parameters, activeParameter }

async function openGreenhouseDetailModal(gh) {
  el.greenhouseDetailTitle.textContent = gh.name;
  el.greenhouseDetailMeta.textContent = `${gh.plantType}${gh.location ? ' · ' + gh.location : ''} · ${gh.code}`;
  el.greenhouseDetailTabs.innerHTML = '';
  el.greenhouseDetailContent.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  el.greenhouseDetailModal.classList.add('open');

  const parameters = (gh.greenhouseConditions || []).map((c) => ({ ...c, source: 'greenhouse' }));

  let readings = [];
  try {
    readings = await api(`/greenhouses/${gh.id}/readings`);
  } catch (err) {
    el.greenhouseDetailContent.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
    return;
  }

  const names = new Map(parameters.map((p) => [p.parameter, p]));
  for (const r of readings) {
    if (!names.has(r.parameter)) names.set(r.parameter, { parameter: r.parameter, value: '', unit: r.unit, source: 'greenhouse' });
  }

  greenhouseDetailState = { gh, readings, parameters: [...names.values()], activeParameter: null };
  greenhouseDetailState.activeParameter = greenhouseDetailState.parameters[0]?.parameter || null;
  renderGreenhouseDetailAll();
}

function renderGreenhouseDetailAll() {
  renderDetailTabs(el.greenhouseDetailTabs, greenhouseDetailState, renderGreenhouseDetailAll);
  renderDetailContent(el.greenhouseDetailContent, greenhouseDetailState, 'No greenhouse-wide parameters configured yet.');
}

el.greenhouseDetailQrBtn.addEventListener('click', () => {
  if (!greenhouseDetailState) return;
  openGreenhouseQrModal(greenhouseDetailState.gh);
});

// ---------- QR modal ----------

function openQrModal(plant, gh) {
  currentQrPlant = plant;
  el.qrModalTitle.textContent = `${gh.plantType} #${plant.number} — ${gh.name}`;
  const url = `/api/plants/${plant.id}/qr.png?t=${Date.now()}`;
  el.qrImage.src = url;
  el.qrCodeLabel.textContent = `${gh.code} / ${plant.code}`;
  el.qrDownloadLink.href = url;
  el.qrDownloadLink.setAttribute('download', `${gh.plantType}_${plant.number}_${plant.code}.png`);
  el.qrDeleteBtn.style.display = '';
  el.qrModal.classList.add('open');
}

function openGreenhouseQrModal(gh) {
  currentQrPlant = null;
  el.qrModalTitle.textContent = `${gh.name} — Greenhouse QR`;
  const url = `/api/greenhouses/${gh.id}/qr.png?t=${Date.now()}`;
  el.qrImage.src = url;
  el.qrCodeLabel.textContent = gh.code;
  el.qrDownloadLink.href = url;
  el.qrDownloadLink.setAttribute('download', `${gh.name}_${gh.code}.png`);
  el.qrDeleteBtn.style.display = 'none';
  el.qrModal.classList.add('open');
}

el.qrDeleteBtn.addEventListener('click', async () => {
  if (!currentQrPlant) return;
  if (!confirm(`Delete plant #${currentQrPlant.number}?`)) return;
  const id = currentQrPlant.id;
  el.qrModal.classList.remove('open');
  currentQrPlant = null;
  await deletePlant(id);
});

// ---------- Global actions ----------

el.downloadAllBtn.addEventListener('click', () => {
  window.location.href = '/api/qr-all.zip';
});

// Sound toggle is fully owned by motion.js (unlock + play + label).
// Only sync label once if motion already applied default-on.
if (el.soundToggle) {
  queueMicrotask(syncSoundToggleLabel);
}

document.querySelectorAll('[data-close-modal]').forEach((btn) => {
  btn.addEventListener('click', () => {
    el.greenhouseModal.classList.remove('open');
    el.plantModal.classList.remove('open');
    el.qrModal.classList.remove('open');
    el.conditionsModal.classList.remove('open');
    el.plantDetailModal.classList.remove('open');
    el.greenhouseDetailModal.classList.remove('open');
    closeGreenhouseModal();
    closePlantModal();
    currentQrPlant = null;
    conditionsGreenhouseId = null;
    plantDetailState = null;
    greenhouseDetailState = null;
  });
});

document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('open');
      if (overlay === el.qrModal) currentQrPlant = null;
      if (overlay === el.conditionsModal) conditionsGreenhouseId = null;
      if (overlay === el.plantDetailModal) plantDetailState = null;
      if (overlay === el.greenhouseDetailModal) greenhouseDetailState = null;
    }
  });
});

// ---------- Init ----------

async function init() {
  try {
    await loadGreenhouses();
    renderDetail();
  } catch (err) {
    console.error(err);
    if (el.detailPanel) {
      el.detailPanel.innerHTML = `
        <div class="empty-state">
          <p>Could not load greenhouses.</p>
          <p>${escapeHtml(err.message)}</p>
        </div>`;
    }
  } finally {
    document.body.classList.add('experience-ready');
  }
}

init();

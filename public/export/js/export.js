/* Agronexia Export Traceability — dashboard (standalone working model) */

const FLOW_KEY = 'agronexia_export_flow';

function loadFlow() {
  try {
    return JSON.parse(sessionStorage.getItem(FLOW_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function saveFlow(partial) {
  const next = { ...loadFlow(), ...partial };
  sessionStorage.setItem(FLOW_KEY, JSON.stringify(next));
  return next;
}

const state = {
  view: 'board',
  board: null,
  selectedTlcId: null,
  selectedShipmentId: null,
  /** Guided path: place → selected harvest batches → packing */
  activePlaceId: loadFlow().activePlaceId || null,
  selectedHarvestIds: Array.isArray(loadFlow().selectedHarvestIds)
    ? loadFlow().selectedHarvestIds
    : [],
};

const el = {
  detail: document.getElementById('detailPanel'),
  nav: document.getElementById('navList'),
  toast: document.getElementById('toast'),
  scopeBanner: document.getElementById('scopeBanner'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modalTitle'),
  modalBody: document.getElementById('modalBody'),
  modalCancel: document.getElementById('modalCancel'),
  modalSubmit: document.getElementById('modalSubmit'),
};

let modalHandler = null;
let toastTimer = null;

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function toast(msg, type = 'success') {
  el.toast.textContent = msg;
  el.toast.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.className = 'toast';
  }, 2800);
}

async function api(path, opts = {}) {
  const res = await fetch('/api/traceability' + path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || res.statusText);
    err.evaluation = body.evaluation;
    throw err;
  }
  return body;
}

function openModal(title, bodyHtml, onSubmit) {
  el.modalTitle.textContent = title;
  el.modalBody.innerHTML = bodyHtml;
  modalHandler = onSubmit;
  el.modal.classList.add('open');
}

function closeModal() {
  el.modal.classList.remove('open');
  modalHandler = null;
}

el.modalCancel.addEventListener('click', closeModal);
el.modalSubmit.addEventListener('click', async () => {
  if (!modalHandler) return closeModal();
  try {
    await modalHandler();
    closeModal();
    await refresh();
  } catch (e) {
    toast(e.message, 'error');
  }
});

el.nav.addEventListener('click', (e) => {
  const item = e.target.closest('.nav-item');
  if (!item) return;
  state.view = item.dataset.view;
  el.nav.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n === item));
  render();
});

document.getElementById('btnRefresh').addEventListener('click', () => refresh());

async function refresh() {
  state.board = await api('/board');
  // Drop selections that no longer exist
  const harvestIds = new Set((state.board.harvests || []).map((h) => h.id));
  state.selectedHarvestIds = state.selectedHarvestIds.filter((id) => harvestIds.has(id));
  if (state.activePlaceId && !(state.board.sites || []).some((s) => s.id === state.activePlaceId)) {
    state.activePlaceId = null;
  }
  saveFlow({
    activePlaceId: state.activePlaceId,
    selectedHarvestIds: state.selectedHarvestIds,
  });
  renderScope(state.board.scope);
  render();
}

function setActivePlace(siteId) {
  state.activePlaceId = siteId || null;
  // Clear harvest picks when place changes
  state.selectedHarvestIds = [];
  saveFlow({ activePlaceId: state.activePlaceId, selectedHarvestIds: [] });
}

function toggleHarvestSelection(harvestId, on) {
  const set = new Set(state.selectedHarvestIds);
  if (on) set.add(harvestId);
  else set.delete(harvestId);
  state.selectedHarvestIds = [...set];
  saveFlow({ selectedHarvestIds: state.selectedHarvestIds });
}

function activePlace() {
  return (state.board?.sites || []).find((s) => s.id === state.activePlaceId) || null;
}

function selectedHarvests() {
  const ids = new Set(state.selectedHarvestIds);
  return (state.board?.harvests || []).filter((h) => ids.has(h.id));
}

function harvestsForActivePlace() {
  const all = state.board?.harvests || [];
  if (!state.activePlaceId) return all;
  return all.filter((h) => h.siteId === state.activePlaceId);
}

function balancePanelHtml() {
  const b = state.board?.balance || {};
  const harvested = Number(b.harvestedKg || 0);
  const inLots = Number(b.inPackingLotsKg || 0);
  const unacc = Number(b.unaccountedKg || 0);
  const place = activePlace();
  const sel = selectedHarvests();
  const selUnacc = sel.reduce((s, h) => s + Number(h.unaccountedKg || 0), 0);
  return `
    <div class="balance-bar">
      <div class="balance-item">
        <span class="balance-label">Dug (confirmed)</span>
        <strong>${esc(harvested)} kg</strong>
      </div>
      <div class="balance-item">
        <span class="balance-label">In packing lots</span>
        <strong>${esc(inLots)} kg</strong>
      </div>
      <div class="balance-item balance-warn">
        <span class="balance-label">Not yet in any packing lot</span>
        <strong>${esc(unacc)} kg</strong>
      </div>
      <div class="balance-item">
        <span class="balance-label">Place</span>
        <strong>${place ? esc(place.displayName || place.name) : 'No place selected'}</strong>
      </div>
      <div class="balance-item">
        <span class="balance-label">Batches selected for packing</span>
        <strong>${esc(sel.length)} · ${esc(selUnacc)} kg free</strong>
      </div>
    </div>
  `;
}

function flowBannerHtml(step) {
  const place = activePlace();
  const sel = selectedHarvests();
  const lines = [];
  if (step >= 1) {
    lines.push(
      place
        ? `Place: <strong>${esc(place.displayName || place.name)}</strong>`
        : '<span class="balance-warn">Select a place in step 1 first</span>'
    );
  }
  if (step >= 2) {
    lines.push(
      sel.length
        ? `Harvest batches: <strong>${esc(sel.map((h) => h.code).join(', '))}</strong> (${esc(
            sel.reduce((s, h) => s + Number(h.unaccountedKg || 0), 0)
          )} kg not packed yet)`
        : step === 2
          ? 'Tick dig batches below, then send to packing'
          : '<span class="balance-warn">Select dig batches in step 2</span>'
    );
  }
  return `<div class="flow-banner">${lines.join(' · ')}</div>`;
}

const MARKET_LABELS = {
  EU_STRICT: 'European Union (retail)',
  EU_BASIC: 'European Union',
  US_STANDARD: 'United States',
  GCC_PREMIUM: 'GCC retail',
  DEFAULT_EXPORT: 'General export',
};

function marketLabel(id) {
  if (!id) return '—';
  return MARKET_LABELS[id] || id;
}

function marketOptionsHtml(selected) {
  return Object.entries(MARKET_LABELS)
    .map(
      ([id, label]) =>
        `<option value="${esc(id)}"${selected === id ? ' selected' : ''}>${esc(label)}</option>`
    )
    .join('');
}

function pathwayLabel(id) {
  const map = {
    registered_site: 'Registered production site',
    pest_free_area: 'Pest-free area',
    country_free: 'Country recognized free',
  };
  return map[id] || id || '—';
}

function friendlyGateReason(reason) {
  if (!reason || reason === 'ok') return '';
  const map = {
    missing_primary_site: 'Production site not set on lot',
    site_not_found: 'Production site missing',
    missing_site_registration: 'Site registration not filled in',
    no_harvest_allocations: 'No harvest linked to this lot',
    harvest_missing: 'Linked harvest not found',
    site_mismatch: 'Harvest and lot sites do not match',
    not_pack_locked: 'Lot is not pack-locked yet',
    no_labeled_cases: 'No labeled cases on this lot',
    missing_accepted_case_photos: 'Case photos not accepted',
    missing_accepted_load_photos: 'Load photos not accepted',
    missing_mrl_pass: 'Residue lab pass not on file',
    missing_ralstonia_pass: 'Plant health test pass not on file',
    missing_phyto: 'Phytosanitary certificate not on file',
    missing_phyto_additional_declaration: 'Phytosanitary additional declaration missing',
    missing_pest_pathway: 'Plant health origin not set',
    missing_valid_globalgap: 'Valid GLOBALG.A.P. certificate not on file',
    missing_valid_organic: 'Valid organic certificate not on file',
    missing_invoice: 'Invoice not on file',
    missing_packing_list: 'Packing list not on file',
    missing_transport_doc: 'Transport document number missing',
    missing_conveyance_id: 'Container / conveyance id missing',
    missing_coo: 'Certificate of origin not on file',
    tlc_on_hold: 'Lot is on hold',
    shipment_on_hold: 'Shipment is on hold',
    unknown_profile: 'Destination market not recognized',
    unknown_gate: 'Unknown check',
  };
  if (map[reason]) return map[reason];
  if (String(reason).startsWith('mass_balance_variance_kg:')) {
    return 'Packed quantity does not match harvest allocation';
  }
  return 'Requirement not met';
}

function renderScope(scope) {
  if (!scope || !el.scopeBanner) return;
  const product =
    scope.productLabel ||
    (scope.productNames && scope.productNames.length ? scope.productNames.join(' · ') : null) ||
    '—';
  el.scopeBanner.innerHTML = `
    <strong>Crop:</strong>
    <span class="scope-pill">${esc(product)}</span>
  `;
}

function statusBadge(s) {
  const labels = {
    PLANNED: 'Planned',
    OPEN_PACKING: 'Packing',
    PACKED: 'Packed',
    DOCS_INCOMPLETE: 'Documents incomplete',
    CLEARED: 'Cleared',
    SHIP_LOCKED: 'Ready to ship',
    SHIPPED: 'Shipped',
    ON_HOLD: 'On hold',
    OPEN: 'Open',
    CONFIRMED: 'Confirmed',
    pass: 'Pass',
    fail: 'Needs attention',
  };
  const text = labels[s] || s;
  return `<span class="status ${esc(s)}">${esc(text)}</span>`;
}

function render() {
  if (!state.board) {
    el.detail.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
    return;
  }
  const v = state.view;
  if (v === 'howto') return renderHowTo();
  if (v === 'board') return renderBoard();
  if (v === 'sites') return renderSites();
  if (v === 'harvests') return renderHarvests();
  if (v === 'tlcs') return renderTlcs();
  if (v === 'shipments') return renderShipments();
  if (v === 'recall') return renderRecall();
  if (v === 'docs') return renderDocs();
}

function renderHowTo() {
  el.detail.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>How export tracking works</h2>
        <div class="meta">One path from the field to the truck — do the steps in order</div>
      </div>
    </div>
    <div class="section" style="margin-top:0">
      <ol class="howto-steps">
        <li><strong>Where it grew</strong> — One list of places. Set up a greenhouse from ops for export (same place, not a second field), or add a place only for export. Then plant season and harvest from there.</li>
        <li><strong>How much you dug</strong> — Crop is already fixed. Pick which plants (one or many), date, and kilos. Tick dig batches for packing.</li>
        <li><strong>Packing lot</strong> — Create a packing lot from the selected harvest batches, fill boxes, put labels, then lock. Free kilos still not packed show as unaccounted.</li>
        <li><strong>Papers</strong> — Tick the countries you will export to. The list shows only the papers those places need. Upload each one.</li>
        <li><strong>Load the truck</strong> — Say who the buyer is and where it goes. When everything is ready, lock the load and ship.</li>
        <li><strong>Find a box later</strong> — If someone asks where a box came from, type the code on the box or packing lot. No fancy words — just find the story.</li>
      </ol>
      <p class="meta" style="margin-top:16px">
        The left menu is the same path. <strong>Overview</strong> shows everything you already made.
        Papers and packing are both needed before a careful buyer/export path can clear.
      </p>
      <p class="meta">
        There is no separate “certificate app.” Certificates live under <strong>4. Papers</strong> on this same Export screen.
        The phone Export app (if you use it) only talks to this same list — it does not keep its own certificates.
      </p>
    </div>
  `;
}

function renderBoard() {
  const b = state.board;
  const tlcRows = b.tlcs
    .map(
      (t) => `
    <tr class="clickable" data-tlc="${esc(t.id)}">
      <td><strong>${esc(t.code)}</strong></td>
      <td>${statusBadge(t.status)}</td>
      <td>${esc(t.grade)} · ${esc(t.program)}</td>
      <td>${esc(t.packedQtyKg)} kg · ${esc(t.caseCount)} boxes</td>
      <td>${esc(t.allocatedKg)} kg from harvest</td>
    </tr>`
    )
    .join('');
  const shipRows = b.shipments
    .map(
      (s) => `
    <tr class="clickable" data-ship="${esc(s.id)}">
      <td><strong>${esc(s.code)}</strong></td>
      <td>${statusBadge(s.status)}</td>
      <td><span class="scope-pill">${esc(marketLabel(s.destinationProfile))}</span></td>
      <td>${esc(s.consigneeName)}</td>
      <td>${esc((s.tlcCodes || []).join(', '))}</td>
    </tr>`
    )
    .join('');

  el.detail.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>Overview</h2>
        <div class="meta">All packing lots and truck loads in one place</div>
      </div>
    </div>
    ${balancePanelHtml()}
    <div class="section">
      <h3>Not yet packed (unaccounted kilos)</h3>
      <p class="meta">Confirmed harvest kilos that are not in any packing lot yet. Select them in step 2, then pack in step 3.</p>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Harvest</th><th>Place</th><th>Dug</th><th>In lots</th><th>Still free</th></tr></thead>
          <tbody>${
            (state.board.harvests || [])
              .filter((h) => Number(h.unaccountedKg) > 0)
              .map(
                (h) =>
                  `<tr>
                    <td><strong>${esc(h.code)}</strong></td>
                    <td>${esc(h.placeLabel)}</td>
                    <td>${esc(h.totalKg)} kg</td>
                    <td>${esc(h.inPackingLotsKg)} kg</td>
                    <td class="balance-warn"><strong>${esc(h.unaccountedKg)} kg</strong></td>
                  </tr>`
              )
              .join('') ||
            '<tr><td colspan="5">Nothing left unaccounted — all confirmed kilos are in packing lots (or no harvests yet).</td></tr>'
          }</tbody>
        </table>
      </div>
    </div>
    <div class="section">
      <h3>Packing lots</h3>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Lot</th><th>Status</th><th>Grade</th><th>Packed</th><th>From harvest</th></tr></thead>
          <tbody>${tlcRows || '<tr><td colspan="5">No packing lots yet. Start with step 1 — Where it grew.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="section">
      <h3>Truck loads</h3>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Load</th><th>Status</th><th>Where going</th><th>Buyer</th><th>Lots</th></tr></thead>
          <tbody>${shipRows || '<tr><td colspan="5">No loads yet. Make a packing lot first, then step 5 — Load the truck.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;

  el.detail.querySelectorAll('[data-tlc]').forEach((row) => {
    row.addEventListener('click', () => {
      state.selectedTlcId = row.dataset.tlc;
      state.view = 'tlcs';
      syncNav();
      renderTlcDetail(row.dataset.tlc);
    });
  });
  el.detail.querySelectorAll('[data-ship]').forEach((row) => {
    row.addEventListener('click', () => {
      state.selectedShipmentId = row.dataset.ship;
      state.view = 'shipments';
      syncNav();
      renderShipmentDetail(row.dataset.ship);
    });
  });
}

function syncNav() {
  el.nav.querySelectorAll('.nav-item').forEach((n) => {
    n.classList.toggle('active', n.dataset.view === state.view);
  });
}

function renderSites() {
  const sites = state.board.sites || [];
  const opsGhs = state.board.opsGreenhouses || [];

  // One list: each greenhouse once + export-only places
  const rows = [];

  for (const g of opsGhs) {
    const linked = sites.find((s) => s.greenhouseId === g.id);
    if (linked) {
      const active = linked.id === state.activePlaceId;
      rows.push(`
        <tr class="${active ? 'row-active' : ''}">
          <td><strong>${esc(g.name)}</strong></td>
          <td>${esc(g.code)}</td>
          <td>${esc(g.plantType || linked.cropName || '—')}</td>
          <td>${esc(g.location || linked.address || '—')}</td>
          <td>Greenhouse ops</td>
          <td><span class="status CLEARED">Ready</span>${
            active ? ' · <strong>Digging here</strong>' : ''
          }</td>
          <td>
            <button type="button" class="btn btn-primary btn-sm" data-work-site="${esc(linked.id)}">${
              active ? 'Digging here' : 'Dig from here'
            }</button>
            <button type="button" class="btn btn-ghost btn-sm" data-edit-site="${esc(linked.id)}">Export details</button>
          </td>
        </tr>`);
    } else {
      rows.push(`
        <tr>
          <td><strong>${esc(g.name)}</strong></td>
          <td>${esc(g.code)}</td>
          <td>${esc(g.plantType || '—')}</td>
          <td>${esc(g.location || '—')}</td>
          <td>Greenhouse ops</td>
          <td><span class="status OPEN">Not set up for export yet</span></td>
          <td>
            <button type="button" class="btn btn-primary btn-sm" data-use-gh="${esc(g.id)}">Set up for export</button>
          </td>
        </tr>`);
    }
  }

  for (const s of sites.filter((x) => !x.greenhouseId)) {
    const active = s.id === state.activePlaceId;
    rows.push(`
      <tr class="${active ? 'row-active' : ''}">
        <td><strong>${esc(s.name)}</strong></td>
        <td>${esc(s.code)}</td>
        <td>${esc(s.cropName || '—')}</td>
        <td>${esc(s.address || '—')}</td>
        <td>Export only</td>
        <td><span class="status CLEARED">Ready</span>${
          active ? ' · <strong>Digging here</strong>' : ''
        }</td>
        <td>
          <button type="button" class="btn btn-primary btn-sm" data-work-site="${esc(s.id)}">${
            active ? 'Digging here' : 'Dig from here'
          }</button>
          <button type="button" class="btn btn-ghost btn-sm" data-edit-site="${esc(s.id)}">Export details</button>
        </td>
      </tr>`);
  }

  el.detail.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>1. Where it grew</h2>
        <div class="meta">One list of places. Greenhouses from ops appear here — set up once, then harvest from the same place.</div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-secondary btn-sm" id="addSiteOnly">+ Place not in ops</button>
        <button class="btn btn-secondary btn-sm" id="addCycle">+ Planting season</button>
      </div>
    </div>
    ${balancePanelHtml()}
    ${flowBannerHtml(1)}
    <div class="section" style="margin-top:0">
      <h3>Your places</h3>
      <p class="meta">
        Same greenhouse as in Greenhouse ops — not a second place.
        <strong>Set up for export</strong> once, then <strong>Dig from here</strong>.
      </p>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Place</th>
              <th>Code</th>
              <th>Crop</th>
              <th>Location</th>
              <th>From</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.join('') ||
              `<tr><td colspan="7">No places yet. Create a greenhouse under <a href="/">Greenhouse ops</a>, or add a place not in ops.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  el.detail.querySelectorAll('[data-work-site]').forEach((btn) => {
    btn.onclick = () => {
      setActivePlace(btn.dataset.workSite);
      toast('Place selected — record how much you dug');
      state.view = 'harvests';
      syncNav();
      render();
    };
  });

  el.detail.querySelectorAll('[data-use-gh]').forEach((btn) => {
    btn.onclick = () => {
      const gh = opsGhs.find((g) => g.id === btn.dataset.useGh);
      if (!gh) return;
      openModal(
        'Use greenhouse for export',
        `
        <p class="meta" style="margin:0 0 12px">Greenhouse: <strong>${esc(gh.name)}</strong> · Crop: <strong>${esc(gh.plantType || '—')}</strong></p>
        <p class="meta" style="margin:0 0 12px">Name and code come from Greenhouse ops. Add export details below if you have them.</p>
        <div class="form-grid">
          <label class="field">Country<input id="f_country" value="IN" /></label>
          <label class="field">Registration #<input id="f_reg" placeholder="If you have one" /></label>
          <label class="field">Plant health origin
            <select id="f_path">
              <option value="registered_site">Registered production site</option>
              <option value="pest_free_area">Pest-free area</option>
              <option value="country_free">Country recognized free</option>
            </select>
          </label>
        </div>`,
        async () => {
          const created = await api('/sites', {
            method: 'POST',
            body: JSON.stringify({
              greenhouseId: gh.id,
              country: val('f_country'),
              registrationNumber: val('f_reg'),
              pestPathway: val('f_path'),
            }),
          });
          setActivePlace(created.id);
          toast('Greenhouse linked — continue to harvest');
        }
      );
    };
  });

  document.getElementById('addSiteOnly').onclick = () => {
    openModal(
      'Add export-only place',
      `
      <p class="meta" style="margin:0 0 12px">Use this when the place is not in Greenhouse ops.</p>
      <div class="form-grid">
        <label class="field">Code<input id="f_code" value="SITE-" /></label>
        <label class="field">Name<input id="f_name" placeholder="Field or block name" /></label>
        <label class="field">Country<input id="f_country" value="IN" /></label>
        <label class="field">Registration #<input id="f_reg" /></label>
        <label class="field">Plant health origin
          <select id="f_path">
            <option value="registered_site">Registered production site</option>
            <option value="pest_free_area">Pest-free area</option>
            <option value="country_free">Country recognized free</option>
          </select>
        </label>
        <label class="field">Facility / farm name<input id="f_fac" /></label>
      </div>`,
      async () => {
        const created = await api('/sites', {
          method: 'POST',
          body: JSON.stringify({
            code: val('f_code'),
            name: val('f_name'),
            country: val('f_country'),
            registrationNumber: val('f_reg'),
            pestPathway: val('f_path'),
            facilityName: val('f_fac'),
          }),
        });
        setActivePlace(created.id);
        toast('Place saved — continue to harvest for this place');
      }
    );
  };

  el.detail.querySelectorAll('[data-edit-site]').forEach((btn) => {
    btn.onclick = () => {
      const site = sites.find((s) => s.id === btn.dataset.editSite);
      if (!site) return;
      openModal(
        'Export details — ' + (site.displayName || site.name),
        `
        <div class="form-grid">
          <label class="field">Country<input id="f_country" value="${esc(site.country || '')}" /></label>
          <label class="field">Registration #<input id="f_reg" value="${esc(site.registrationNumber || '')}" /></label>
          <label class="field">Plant health origin
            <select id="f_path">
              <option value="registered_site"${site.pestPathway === 'registered_site' ? ' selected' : ''}>Registered production site</option>
              <option value="pest_free_area"${site.pestPathway === 'pest_free_area' ? ' selected' : ''}>Pest-free area</option>
              <option value="country_free"${site.pestPathway === 'country_free' ? ' selected' : ''}>Country recognized free</option>
            </select>
          </label>
          <label class="field">Address / note<input id="f_addr" value="${esc(site.address || '')}" /></label>
        </div>`,
        async () => {
          await api('/sites/' + site.id, {
            method: 'PATCH',
            body: JSON.stringify({
              country: val('f_country'),
              registrationNumber: val('f_reg'),
              pestPathway: val('f_path'),
              address: val('f_addr'),
            }),
          });
          toast('Saved');
        }
      );
    };
  });

  document.getElementById('addCycle').onclick = () => {
    const opts = sites
      .map((s) => `<option value="${esc(s.id)}">${esc(s.displayName || s.name)} — ${esc(s.cropName || '')}</option>`)
      .join('');
    const defaultCrop = sites[0]?.cropName || state.board.scope?.productLabel || '';
    openModal(
      'Add planting season',
      `
      <div class="form-grid">
        <label class="field">Place<select id="f_site">${opts || '<option value="">No places yet</option>'}</select></label>
        <label class="field">Crop name<input id="f_var" value="${esc(defaultCrop)}" /></label>
        <label class="field">Plant date<input id="f_date" type="date" /></label>
        <label class="field">Seed lot (optional)<input id="f_seed" /></label>
      </div>`,
      async () => {
        await api('/cycles', {
          method: 'POST',
          body: JSON.stringify({
            siteId: val('f_site'),
            variety: val('f_var'),
            plantDate: val('f_date'),
            seedLotCode: val('f_seed'),
          }),
        });
        toast('Planting season saved');
      }
    );
  };
}

function val(id) {
  return document.getElementById(id)?.value?.trim() ?? '';
}

function renderHarvests() {
  const sites = state.board.sites || [];
  if (!state.activePlaceId && sites.length === 1) {
    setActivePlace(sites[0].id);
  }
  const place = activePlace();
  const list = harvestsForActivePlace();
  const rows = list
    .map((h) => {
      const when = h.harvestedAt ? new Date(h.harvestedAt).toLocaleString() : '—';
      const canSelect = h.selectableForPacking;
      const checked = state.selectedHarvestIds.includes(h.id);
      return `
    <tr class="${checked ? 'row-active' : ''}">
      <td>
        ${
          canSelect
            ? `<input type="checkbox" data-pick-harvest="${esc(h.id)}" ${checked ? 'checked' : ''} title="Select for packing" />`
            : '—'
        }
      </td>
      <td><strong>${esc(h.code)}</strong></td>
      <td>${esc(h.placeLabel || '—')}</td>
      <td>${esc(h.cropName || '—')}</td>
      <td>${esc(h.plantCount || 0)}</td>
      <td>${esc(when)}</td>
      <td>${statusBadge(h.status)}</td>
      <td>${esc(h.totalKg ?? '—')} kg</td>
      <td>${esc(h.inPackingLotsKg ?? '—')} kg</td>
      <td class="balance-warn"><strong>${esc(h.unaccountedKg ?? '—')}</strong> kg</td>
      <td>${
        h.status === 'OPEN'
          ? `<button type="button" class="btn btn-primary btn-sm" data-confirm="${esc(h.id)}">Confirm kilos</button>`
          : canSelect
            ? `<button type="button" class="btn btn-secondary btn-sm" data-pick-one="${esc(h.id)}">Select</button>`
            : '—'
      }</td>
    </tr>`;
    })
    .join('');

  el.detail.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>2. How much you dug</h2>
        <div class="meta">Crop is fixed for this place. Pick which plants went into this dig, then kilos. Tick dig batches for packing.</div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-primary btn-sm" id="addHarvest">+ Dig batch</button>
        <button class="btn btn-secondary btn-sm" id="toPacking" ${
          selectedHarvests().length ? '' : 'disabled'
        }>Send to packing (${esc(selectedHarvests().length)})</button>
      </div>
    </div>
    ${balancePanelHtml()}
    ${flowBannerHtml(2)}
    ${
      !place
        ? `<p class="meta balance-warn">Choose <strong>Dig from here</strong> on a place in step 1 first.</p>`
        : ''
    }
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Pack?</th><th>Dig batch</th><th>Place</th><th>Crop</th><th>Plants</th><th>When</th><th>Status</th><th>Kilos</th><th>In lots</th><th>Not packed yet</th><th></th></tr></thead>
        <tbody>${
          rows ||
          '<tr><td colspan="11">No dig batches for this place yet. Add a dig batch, pick plants, confirm kilos, then tick for packing.</td></tr>'
        }</tbody>
      </table>
    </div>
  `;

  document.getElementById('toPacking').onclick = () => {
    if (!selectedHarvests().length) {
      toast('Select at least one harvest batch with free kilos', 'error');
      return;
    }
    state.view = 'tlcs';
    syncNav();
    render();
  };

  el.detail.querySelectorAll('[data-pick-harvest]').forEach((box) => {
    box.onchange = () => {
      toggleHarvestSelection(box.dataset.pickHarvest, box.checked);
      renderHarvests();
    };
  });
  el.detail.querySelectorAll('[data-pick-one]').forEach((btn) => {
    btn.onclick = () => {
      toggleHarvestSelection(btn.dataset.pickOne, true);
      const h = (state.board.harvests || []).find((x) => x.id === btn.dataset.pickOne);
      if (h) setActivePlace(h.siteId);
      toast('Batch selected for packing');
      renderHarvests();
    };
  });

  document.getElementById('addHarvest').onclick = async () => {
    let cycles = await api('/cycles');
    if (!sites.length) {
      toast('Add a place in step 1 first', 'error');
      return;
    }
    if (!state.activePlaceId) {
      toast('Choose Dig from here on a place in step 1 first', 'error');
      return;
    }
    const placeSites = sites.filter((s) => s.id === state.activePlaceId);
    const activeSite = placeSites[0];
    const siteOpts = placeSites
      .map((s) => `<option value="${esc(s.id)}">${esc(s.displayName || s.name)}</option>`)
      .join('');
    let placeCycles = cycles.filter((c) => c.siteId === state.activePlaceId);
    // Auto-create a planting season if none exists for this place
    if (!placeCycles.length && activeSite) {
      try {
        const created = await api('/cycles', {
          method: 'POST',
          body: JSON.stringify({
            siteId: activeSite.id,
            variety: activeSite.cropName || state.board.scope?.productLabel || 'Crop',
            plantDate: new Date().toISOString().slice(0, 10),
          }),
        });
        cycles = await api('/cycles');
        placeCycles = cycles.filter((c) => c.siteId === state.activePlaceId);
        if (!placeCycles.length && created?.id) placeCycles = [created];
      } catch {
        /* show empty select below */
      }
    }
    const cycleOpts = placeCycles
      .map((c) => {
        const site = sites.find((x) => x.id === c.siteId);
        return `<option value="${esc(c.id)}">${esc(c.code)} · ${esc(c.variety)} · ${esc(site?.displayName || '')}</option>`;
      })
      .join('');
    const today = new Date().toISOString().slice(0, 10);

    let plantBlock = `
      <p class="meta">No plant numbers from Greenhouse ops for this place. Enter total <strong>kilos (kg)</strong> below.</p>`;
    let freePlants = [];
    try {
      const plantInfo = await api('/sites/' + encodeURIComponent(state.activePlaceId) + '/plants');
      if (plantInfo.linkedToOps) {
        freePlants = (plantInfo.plants || []).filter((p) => !p.alreadyInBatch);
        const taken = plantInfo.alreadyInBatch || 0;
        const chips = freePlants
          .slice(0, 200)
          .map(
            (p) =>
              `<label class="plant-chip"><input type="checkbox" name="plantPick" value="${esc(
                p.id
              )}" data-num="${esc(p.number)}" /> #${esc(p.number)}</label>`
          )
          .join('');
        plantBlock = `
          <p class="meta">Crop is fixed. Choose plants for <strong>this dig batch</strong> (one or many).
            Free: <strong>${esc(plantInfo.free)}</strong> · Already in another dig: <strong>${esc(taken)}</strong></p>
          <div class="form-grid">
            <label class="field">From plant #<input id="f_from" type="number" min="1" placeholder="e.g. 1" /></label>
            <label class="field">To plant #<input id="f_to" type="number" min="1" placeholder="e.g. 50" /></label>
          </div>
          <div class="plant-actions">
            <button type="button" class="btn btn-ghost btn-sm" id="btnRange">Select range</button>
            <button type="button" class="btn btn-ghost btn-sm" id="btnAllFree">Select all free</button>
            <button type="button" class="btn btn-ghost btn-sm" id="btnClearPlants">Clear</button>
            <span class="meta" id="plantPickCount">0 selected</span>
          </div>
          <div class="plant-grid" id="plantGrid">${chips || '<span class="meta">No free plants left</span>'}</div>
          ${
            freePlants.length > 200
              ? `<p class="meta">Showing first 200 free plants — use the number range for larger batches.</p>`
              : ''
          }`;
      }
    } catch {
      /* keep export-only message */
    }

    openModal(
      'New dig batch — how much (kg)',
      `
      <div class="form-grid">
        <label class="field">Place<select id="f_site">${siteOpts}</select></label>
        <label class="field">Planting season<select id="f_cycle">${
          cycleOpts || '<option value="">No season — will try to create one</option>'
        }</select></label>
        <label class="field">Dig date<input id="f_date" type="date" value="${esc(today)}" /></label>
        <label class="field">Total weight dug (kg) <span style="color:#b71c1c">*</span>
          <input id="f_kg" type="number" min="0.1" step="0.1" required placeholder="e.g. 120" />
        </label>
        <label class="field">Who recorded it<input id="f_sup" /></label>
      </div>
      <div class="section" style="margin-top:12px">
        <h3 style="margin:0 0 8px;font-size:0.95rem">Which plants?</h3>
        ${plantBlock}
      </div>
      <p class="meta"><strong>Kilos (kg)</strong> is required. After save the dig batch is ready — tick it to send to packing.</p>
`,
      async () => {
        const kg = Number(val('f_kg'));
        if (!(kg > 0)) {
          toast('Enter total weight dug in kilograms (kg)', 'error');
          throw new Error('Enter total weight dug in kilograms (kg)');
        }
        const dateVal = val('f_date');
        const harvestedAt = dateVal ? new Date(dateVal + 'T12:00:00').toISOString() : undefined;
        const picked = [...document.querySelectorAll('input[name="plantPick"]:checked')].map(
          (el) => el.value
        );
        const fromN = val('f_from');
        const toN = val('f_to');
        let cycleId = val('f_cycle');
        if (!cycleId) {
          const created = await api('/cycles', {
            method: 'POST',
            body: JSON.stringify({
              siteId: val('f_site'),
              variety: activeSite?.cropName || state.board.scope?.productLabel || 'Crop',
              plantDate: dateVal || today,
            }),
          });
          cycleId = created.id;
        }
        const body = {
          siteId: val('f_site'),
          cycleId,
          supervisor: val('f_sup'),
          harvestedAt,
          quantityKg: kg,
          plantIds: picked,
          requirePlants: freePlants.length > 0 && !fromN,
        };
        if (!picked.length && fromN && toN) {
          body.fromNumber = Number(fromN);
          body.toNumber = Number(toN);
          delete body.plantIds;
          body.requirePlants = freePlants.length > 0;
        }
        if (freePlants.length > 0 && !picked.length && !(fromN && toN)) {
          toast('Select plants (tick, range, or all free) or enter a plant number range', 'error');
          throw new Error('Select plants for this dig batch');
        }
        const h = await api('/harvests', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (h?.id && Number(h.unaccountedKg) > 0) {
          toggleHarvestSelection(h.id, true);
        }
        toast('Dig batch saved: ' + kg + ' kg');
      }
    );

    // Wire plant pick helpers after modal opens
    setTimeout(() => {
      const countEl = document.getElementById('plantPickCount');
      const updateCount = () => {
        if (!countEl) return;
        const n = document.querySelectorAll('input[name="plantPick"]:checked').length;
        countEl.textContent = n + ' selected';
      };
      document.querySelectorAll('input[name="plantPick"]').forEach((el) => {
        el.addEventListener('change', updateCount);
      });
      const btnAll = document.getElementById('btnAllFree');
      if (btnAll) {
        btnAll.onclick = () => {
          document.querySelectorAll('input[name="plantPick"]').forEach((el) => {
            el.checked = true;
          });
          updateCount();
        };
      }
      const btnClear = document.getElementById('btnClearPlants');
      if (btnClear) {
        btnClear.onclick = () => {
          document.querySelectorAll('input[name="plantPick"]').forEach((el) => {
            el.checked = false;
          });
          updateCount();
        };
      }
      const btnRange = document.getElementById('btnRange');
      if (btnRange) {
        btnRange.onclick = () => {
          const fromN = Number(val('f_from'));
          const toN = Number(val('f_to'));
          if (!(fromN > 0) || !(toN >= fromN)) {
            toast('Enter a valid plant number range', 'error');
            return;
          }
          document.querySelectorAll('input[name="plantPick"]').forEach((el) => {
            const num = Number(el.dataset.num);
            el.checked = num >= fromN && num <= toN;
          });
          updateCount();
        };
      }
    }, 0);
  };

  el.detail.querySelectorAll('[data-confirm]').forEach((btn) => {
    btn.onclick = () => {
      openModal(
        'Confirm kilos dug',
        `<label class="field">Kilos<input id="f_qty" type="number" min="1" step="0.1" /></label>`,
        async () => {
          await api('/harvests/' + btn.dataset.confirm + '/confirm', {
            method: 'POST',
            body: JSON.stringify({ quantityKg: Number(val('f_qty')) }),
          });
          toggleHarvestSelection(btn.dataset.confirm, true);
          toast('Harvest kilos saved — batch ready to select for packing');
        }
      );
    };
  });
}

function renderTlcs() {
  if (state.selectedTlcId) {
    return renderTlcDetail(state.selectedTlcId);
  }
  const sel = selectedHarvests();
  const freeKg = sel.reduce((s, h) => s + Number(h.unaccountedKg || 0), 0);
  const placeLots = (state.board.tlcs || []).filter(
    (t) => !state.activePlaceId || t.primarySiteId === state.activePlaceId
  );
  const rows = placeLots
    .map(
      (t) => `
    <tr class="clickable" data-id="${esc(t.id)}">
      <td><strong>${esc(t.code)}</strong></td>
      <td>${esc(t.placeLabel || '—')}</td>
      <td>${statusBadge(t.status)}</td>
      <td>${esc(t.grade)}</td>
      <td>${esc(t.allocatedKg)} kg from harvest</td>
      <td>${esc(t.packedQtyKg)} kg in boxes</td>
    </tr>`
    )
    .join('');

  const batchList = sel
    .map(
      (h) =>
        `<li><strong>${esc(h.code)}</strong> — ${esc(h.unaccountedKg)} kg free · ${esc(h.placeLabel)}</li>`
    )
    .join('');

  el.detail.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>3. Packing lot</h2>
        <div class="meta">Pack from the harvest batches you selected in step 2 (same place only).</div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-primary btn-sm" id="packFromBatches" ${
          sel.length ? '' : 'disabled'
        }>Create packing lot from selected batches</button>
      </div>
    </div>
    ${balancePanelHtml()}
    ${flowBannerHtml(3)}
    <div class="section" style="margin-top:0">
      <h3>Selected harvest batches → packing</h3>
      ${
        sel.length
          ? `<ul class="howto-steps">${batchList}</ul>
             <p class="meta">Total free kilos to put in this lot: <strong>${esc(freeKg)} kg</strong></p>`
          : `<p class="meta balance-warn">No batches selected. Go to <strong>2. What you dug</strong>, tick harvests with free kilos, then continue here.</p>
             <button type="button" class="btn btn-secondary btn-sm" id="goHarvests">Go to harvests</button>`
      }
    </div>
    <div class="section">
      <h3>Packing lots${state.activePlaceId ? ' for this place' : ''}</h3>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Lot</th><th>Place</th><th>Status</th><th>Grade</th><th>From harvest</th><th>In boxes</th></tr></thead>
          <tbody>${
            rows ||
            '<tr><td colspan="6">No packing lots yet. Select harvest batches and create a packing lot.</td></tr>'
          }</tbody>
        </table>
      </div>
    </div>
  `;

  const goH = document.getElementById('goHarvests');
  if (goH) {
    goH.onclick = () => {
      state.view = 'harvests';
      syncNav();
      render();
    };
  }

  document.getElementById('packFromBatches').onclick = () => {
    if (!sel.length) {
      toast('Select harvest batches in step 2 first', 'error');
      return;
    }
    openModal(
      'Create packing lot from batches',
      `
      <p class="meta">Will use ${esc(sel.length)} harvest batch(es), ${esc(freeKg)} kg free, place: <strong>${esc(
        sel[0].placeLabel || ''
      )}</strong></p>
      <div class="form-grid">
        <label class="field">Grade<input id="f_grade" value="large" /></label>
        <label class="field">Type
          <select id="f_prog"><option value="conventional">Normal</option><option value="organic">Organic</option></select>
        </label>
      </div>
      <p class="meta">All free kilos from the selected batches will go into this packing lot. Then add boxes and lock.</p>`,
      async () => {
        const result = await api('/tlcs/from-harvests', {
          method: 'POST',
          body: JSON.stringify({
            harvestIds: state.selectedHarvestIds,
            grade: val('f_grade'),
            program: val('f_prog'),
            allocateAllRemaining: true,
          }),
        });
        state.selectedHarvestIds = [];
        saveFlow({ selectedHarvestIds: [] });
        state.selectedTlcId = result.tlc.id;
        toast('Packing lot ' + result.tlc.code + ' created from batches');
        await refresh();
        state.selectedTlcId = result.tlc.id;
        renderTlcDetail(result.tlc.id);
      }
    );
  };

  el.detail.querySelectorAll('[data-id]').forEach((row) => {
    row.onclick = () => {
      state.selectedTlcId = row.dataset.id;
      renderTlcDetail(row.dataset.id);
    };
  });
}

async function renderTlcDetail(id) {
  const detail = await api('/tlcs/' + encodeURIComponent(id));
  const t = detail.tlc;
  state.selectedTlcId = t.id;
  const caseRows = detail.cases
    .map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.netKg)} kg</td><td>${c.labelIssued ? 'labeled' : 'no label'}</td></tr>`)
    .join('');
  const allocRows = detail.harvests
    .map(
      (a) =>
        `<tr><td>${esc(a.harvest?.code)}</td><td>${esc(a.quantityKg)} kg</td><td>rem ${esc(a.harvest?.remainingKg)}</td></tr>`
    )
    .join('');
  const docRows = (detail.documents || [])
    .map(
      (d) =>
        `<tr>
          <td>${esc(d.type)}</td>
          <td>${esc(d.number)}</td>
          <td>${esc(d.result || '—')}</td>
          <td><a class="btn btn-secondary btn-sm" href="/api/traceability/documents/${esc(d.id)}/download" download>Download</a></td>
        </tr>`
    )
    .join('');

  el.detail.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>${esc(t.code)}</h2>
        <div class="meta">${statusBadge(t.status)} · ${esc(t.productDescription)} · ${esc(t.grade)} · site ${esc(detail.site?.code)}</div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-ghost btn-sm" id="backTlcs">All packing lots</button>
        <a class="btn btn-secondary btn-sm" href="/export/passport.html?code=${encodeURIComponent(t.code)}" target="_blank">Public passport</a>
        <button class="btn btn-secondary btn-sm" id="btnQr">QR passport URL</button>
        <button class="btn btn-secondary btn-sm" id="btnAlloc">Add dig kilos</button>
        <button class="btn btn-secondary btn-sm" id="btnCase">+ Box</button>
        <button class="btn btn-secondary btn-sm" id="btnLabels">Mark labels done</button>
        <button class="btn btn-primary btn-sm" id="btnPackLock">Lock packing</button>
        <button class="btn btn-secondary btn-sm" id="btnMrl">Add residue lab (passed)</button>
      </div>
    </div>
    <div class="two-col">
      <div class="section" style="margin-top:0">
        <h3>Allocations</h3>
        <div class="table-wrap"><table class="data"><thead><tr><th>Harvest</th><th>Kg</th><th>Remaining</th></tr></thead><tbody>${allocRows || '<tr><td colspan="3">None</td></tr>'}</tbody></table></div>
      </div>
      <div class="section" style="margin-top:0">
        <h3>Cases</h3>
        <div class="table-wrap"><table class="data"><thead><tr><th>Case</th><th>Net</th><th>Label</th></tr></thead><tbody>${caseRows || '<tr><td colspan="3">None</td></tr>'}</tbody></table></div>
      </div>
    </div>
    <div class="section">
      <h3>Documents (downloadable)</h3>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Type</th><th>Number</th><th>Result</th><th></th></tr></thead>
        <tbody>${docRows || '<tr><td colspan="4">No documents on this packing lot</td></tr>'}</tbody>
      </table></div>
    </div>
  `;

  document.getElementById('backTlcs').onclick = () => {
    state.selectedTlcId = null;
    renderTlcs();
  };

  document.getElementById('btnQr').onclick = async () => {
    try {
      const q = await api('/tlcs/' + encodeURIComponent(t.id) + '/qr-target');
      toast(q.passportUrl);
      window.open(q.passportUrl || ('/export/passport.html?code=' + encodeURIComponent(t.code)), '_blank');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  document.getElementById('btnAlloc').onclick = () => {
    const hs = state.board.harvests.filter((h) => h.status === 'CONFIRMED' || Number(h.remainingKg) > 0);
    const opts = hs.map((h) => `<option value="${esc(h.id)}">${esc(h.code)} rem ${esc(h.remainingKg)}</option>`).join('');
    openModal(
      'Add harvest kilos to this packing lot (same place only)',
      `<div class="form-grid">
        <label class="field">Dig batch<select id="f_h">${opts}</select></label>
        <label class="field">Kg<input id="f_qty" type="number" min="0.1" step="0.1" /></label>
      </div>`,
      async () => {
        await api('/tlcs/' + t.id + '/allocate', {
          method: 'POST',
          body: JSON.stringify({ harvestId: val('f_h'), quantityKg: Number(val('f_qty')) }),
        });
        toast('Kilos added to packing lot');
        state.selectedTlcId = t.id;
      }
    );
  };

  document.getElementById('btnCase').onclick = () => {
    openModal(
      'Add case',
      `<label class="field">Net kg<input id="f_qty" type="number" value="10" min="0.1" step="0.1" /></label>`,
      async () => {
        await api('/tlcs/' + t.id + '/cases', {
          method: 'POST',
          body: JSON.stringify({ netKg: Number(val('f_qty')) }),
        });
        toast('Case added');
        state.selectedTlcId = t.id;
      }
    );
  };

  document.getElementById('btnLabels').onclick = async () => {
    try {
      await api('/tlcs/' + t.id + '/labels', { method: 'POST', body: '{}' });
      toast('Labels marked done');
      await refresh();
      state.selectedTlcId = t.id;
      renderTlcDetail(t.id);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  document.getElementById('btnPackLock').onclick = async () => {
    try {
      await api('/tlcs/' + t.id + '/pack-lock', { method: 'POST', body: '{}' });
      toast('Packing locked');
      await refresh();
      state.selectedTlcId = t.id;
      renderTlcDetail(t.id);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  document.getElementById('btnMrl').onclick = () => {
    openModal(
      'Add residue lab report (passed)',
      `<div class="form-grid">
        <label class="field">Lab report number<input id="f_n" value="LAB-" /></label>
        <label class="field">For market<input id="f_m" value="EU" /></label>
        <label class="field">Lab name<input id="f_lab" value="Residue Lab" /></label>
      </div>`,
      async () => {
        await api('/documents', {
          method: 'POST',
          body: JSON.stringify({
            type: 'MRL_LAB',
            number: val('f_n'),
            result: 'pass',
            market: val('f_m'),
            labName: val('f_lab'),
            sampleDate: new Date().toISOString().slice(0, 10),
            tlcId: t.id,
            fileName: 'mrl.txt',
          }),
        });
        toast('Residue lab report saved');
        state.selectedTlcId = t.id;
      }
    );
  };
}

function renderShipments() {
  if (state.selectedShipmentId) {
    return renderShipmentDetail(state.selectedShipmentId);
  }
  const rows = state.board.shipments
    .map(
      (s) => `
    <tr class="clickable" data-id="${esc(s.id)}">
      <td><strong>${esc(s.code)}</strong></td>
      <td>${statusBadge(s.status)}</td>
      <td>${esc(marketLabel(s.destinationProfile))}</td>
      <td>${esc(s.consigneeName)}</td>
    </tr>`
    )
    .join('');

  el.detail.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>5. Load the truck</h2>
        <div class="meta">Pick buyer and country. Add packing lot. When checks pass, lock and ship.</div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-primary btn-sm" id="addShip">+ Shipment</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Code</th><th>Status</th><th>Destination</th><th>Consignee</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">None</td></tr>'}</tbody>
      </table>
    </div>
  `;

  document.getElementById('addShip').onclick = () => {
    openModal(
      'Create shipment',
      `
      <div class="form-grid">
        <label class="field">Destination market
          <select id="f_prof">${marketOptionsHtml('EU_STRICT')}</select>
        </label>
        <label class="field">Consignee<input id="f_cons" /></label>
        <label class="field">Country<input id="f_cc" value="NL" /></label>
        <label class="field">Plant health origin
          <select id="f_path">
            <option value="registered_site">Registered production site</option>
            <option value="pest_free_area">Pest-free area</option>
            <option value="country_free">Country recognized free</option>
          </select>
        </label>
      </div>`,
      async () => {
        const s = await api('/shipments', {
          method: 'POST',
          body: JSON.stringify({
            destinationProfile: val('f_prof'),
            consigneeName: val('f_cons'),
            destinationCountry: val('f_cc'),
            pestPathway: val('f_path'),
          }),
        });
        toast('Shipment ' + s.code);
        state.selectedShipmentId = s.id;
      }
    );
  };

  el.detail.querySelectorAll('[data-id]').forEach((row) => {
    row.onclick = () => {
      state.selectedShipmentId = row.dataset.id;
      renderShipmentDetail(row.dataset.id);
    };
  });
}

async function renderShipmentDetail(id) {
  const detail = await api('/shipments/' + encodeURIComponent(id));
  const s = detail.shipment;
  state.selectedShipmentId = s.id;
  const ev = detail.evaluation;

  const shipGates = (ev.shipmentResults || [])
    .map(
      (g) => `
    <div class="gate-row ${g.pass ? 'pass' : 'fail'}">
      <div>${g.pass ? '✓' : '✕'}</div>
      <div><strong>${esc(g.description || g.id)}</strong>${g.pass ? '' : `<br><span class="meta">${esc(friendlyGateReason(g.reason))}</span>`}${g.overridden ? '<br><span class="meta">Manually cleared</span>' : ''}</div>
    </div>`
    )
    .join('');

  const tlcGateBlocks = (ev.tlcResults || [])
    .map((tr) => {
      const rows = (tr.results || [])
        .map(
          (g) => `
        <div class="gate-row ${g.pass ? 'pass' : 'fail'}">
          <div>${g.pass ? '✓' : '✕'}</div>
          <div><strong>${esc(g.description || g.id)}</strong>${g.pass ? '' : `<br><span class="meta">${esc(friendlyGateReason(g.reason))}</span>`}</div>
        </div>`
        )
        .join('');
      return `<h3 style="margin-top:14px">Lot ${esc(tr.tlcCode)} ${tr.ok ? '✓' : '✕'}</h3><div class="gate-list">${rows}</div>`;
    })
    .join('');

  const members = detail.members
    .map((m) => `<tr><td>${esc(m.tlc?.code)}</td><td>${esc(m.quantityKg)} kg</td><td>${statusBadge(m.tlc?.status)}</td></tr>`)
    .join('');

  const pack = detail.packs[detail.packs.length - 1];

  el.detail.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>${esc(s.code)}</h2>
        <div class="meta">${statusBadge(s.status)} · ${esc(marketLabel(s.destinationProfile))} · ${esc(s.consigneeName)} · ${esc(s.destinationCountry)}</div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-ghost btn-sm" id="backShip">All shipments</button>
        <button class="btn btn-secondary btn-sm" id="btnAddTlc">Add packing lot</button>
        <button class="btn btn-secondary btn-sm" id="btnTransport">Truck / container numbers</button>
        <button class="btn btn-secondary btn-sm" id="btnPhyto">Add plant-health + invoice papers</button>
        <button class="btn btn-primary btn-sm" id="btnShipLock">Lock for export</button>
        <button class="btn btn-secondary btn-sm" id="btnShipped">Mark truck left</button>
      </div>
    </div>
    <div class="section" style="margin-top:0">
      <h3>Packing lots on this load</h3>
      <div class="table-wrap"><table class="data"><thead><tr><th>Packing lot</th><th>Kg</th><th>Status</th></tr></thead><tbody>${members || '<tr><td colspan="3">None</td></tr>'}</tbody></table></div>
    </div>
    <div class="section">
      <h3>Clearance — ${esc(ev.profileLabel || marketLabel(s.destinationProfile))} ${ev.ok ? statusBadge('pass') : statusBadge('fail')}</h3>
      <h3>Shipment checks</h3>
      <div class="gate-list">${shipGates || '<p class="meta">No checks listed</p>'}</div>
      ${tlcGateBlocks}
    </div>
    <div class="section">
      <h3>Export pack</h3>
      ${
        pack
          ? `<p class="meta">Pack ready (version ${esc(pack.version)})</p>
             <a class="btn btn-secondary btn-sm" href="/api/traceability/shipments/${esc(s.id)}/pack/file?path=00_MANIFEST.json" target="_blank">Download index</a>
             <a class="btn btn-secondary btn-sm" href="/api/traceability/shipments/${esc(s.id)}/pack/file?path=02_KDE_${encodeURIComponent(String(s.code).replace(/[^a-zA-Z0-9._-]+/g, '_'))}.csv" target="_blank">Download tracking sheet</a>`
          : '<p class="meta">Pack is created when the shipment is locked for export.</p>'
      }
    </div>
  `;

  document.getElementById('backShip').onclick = () => {
    state.selectedShipmentId = null;
    renderShipments();
  };

  document.getElementById('btnAddTlc').onclick = () => {
    const opts = state.board.tlcs
      .filter((t) => ['PACKED', 'DOCS_INCOMPLETE', 'CLEARED'].includes(t.status))
      .map((t) => `<option value="${esc(t.id)}">${esc(t.code)} (${esc(t.status)})</option>`)
      .join('');
    openModal(
      'Add packing lot to this truck load',
      `<label class="field">Packing lot<select id="f_t">${opts}</select></label>`,
      async () => {
        await api('/shipments/' + s.id + '/tlcs', {
          method: 'POST',
          body: JSON.stringify({ tlcId: val('f_t') }),
        });
        toast('Packing lot added to load');
        state.selectedShipmentId = s.id;
      }
    );
  };

  document.getElementById('btnTransport').onclick = () => {
    openModal(
      'Transport fields',
      `<div class="form-grid">
        <label class="field">BOL/AWB #<input id="f_bol" value="${esc(s.transportDocNumber)}" /></label>
        <label class="field">Container / conveyance<input id="f_conv" value="${esc(s.conveyanceId)}" /></label>
      </div>`,
      async () => {
        await api('/shipments/' + s.id, {
          method: 'PATCH',
          body: JSON.stringify({
            transportDocNumber: val('f_bol'),
            conveyanceId: val('f_conv'),
          }),
        });
        toast('Transport updated');
        state.selectedShipmentId = s.id;
      }
    );
  };

  document.getElementById('btnPhyto').onclick = async () => {
    try {
      await api('/documents', {
        method: 'POST',
        body: JSON.stringify({
          type: 'PHYTO',
          number: 'PHYTO-' + Date.now(),
          shipmentId: s.id,
          additionalDeclaration: 'Registered production site; molecular test on file for Ralstonia pathway.',
          fileName: 'phyto.txt',
        }),
      });
      await api('/documents', {
        method: 'POST',
        body: JSON.stringify({ type: 'INVOICE', number: 'INV-' + Date.now(), shipmentId: s.id, fileName: 'inv.txt' }),
      });
      await api('/documents', {
        method: 'POST',
        body: JSON.stringify({
          type: 'PACKING_LIST',
          number: 'PL-' + Date.now(),
          shipmentId: s.id,
          fileName: 'pl.txt',
        }),
      });
      await api('/documents', {
        method: 'POST',
        body: JSON.stringify({ type: 'COO', number: 'COO-' + Date.now(), shipmentId: s.id, fileName: 'coo.txt' }),
      });
      toast('Phyto + commercial docs added');
      await refresh();
      state.selectedShipmentId = s.id;
      renderShipmentDetail(s.id);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  document.getElementById('btnShipLock').onclick = async () => {
    try {
      const r = await api('/shipments/' + s.id + '/ship-lock', { method: 'POST', body: '{}' });
      toast('Load locked — export folder ready');
      await refresh();
      state.selectedShipmentId = s.id;
      renderShipmentDetail(s.id);
    } catch (e) {
      toast(e.message, 'error');
      if (e.evaluation) {
        await refresh();
        state.selectedShipmentId = s.id;
        renderShipmentDetail(s.id);
      }
    }
  };

  document.getElementById('btnShipped').onclick = async () => {
    try {
      await api('/shipments/' + s.id + '/shipped', { method: 'POST', body: '{}' });
      toast('Marked as truck left');
      await refresh();
      state.selectedShipmentId = s.id;
      renderShipmentDetail(s.id);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
}

function renderRecall() {
  el.detail.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>Find a box later</h2>
        <div class="meta">Type the code on the box or packing lot. We show where it grew, when it was dug, and which truck it went on.</div>
      </div>
    </div>
    <div class="form-grid">
      <label class="field">Box or packing-lot code
        <input id="recallQ" placeholder="Code from the label on the box or lot" />
      </label>
    </div>
    <button class="btn btn-primary" id="runRecall">Find where this came from</button>
    <div id="recallOut" class="section"></div>
  `;
  document.getElementById('runRecall').onclick = async () => {
    const q = document.getElementById('recallQ').value.trim();
    const out = document.getElementById('recallOut');
    if (!q) {
      toast('Type a box or packing-lot code first', 'error');
      return;
    }
    try {
      const r = await api('/recall', { method: 'POST', body: JSON.stringify({ query: q }) });
      const res = r.result || {};
      const lot = res.tlc || {};
      const site = res.site || {};
      const cases = res.cases || [];
      const harvests = res.harvests || [];
      const ships = res.shipments || [];
      const docs = res.documents || [];
      const harvestLines = harvests
        .map((x) => {
          const h = x.harvest || x;
          return `<li>${esc(h.code || '')} — ${esc(h.quantityKg ?? x.quantityKg ?? '—')} kg</li>`;
        })
        .join('');
      const shipLines = ships
        .map(
          (s) =>
            `<li>${esc(s.code)} — ${esc(s.consigneeName || '')} · ${esc(s.destinationCountry || '')} · ${esc(s.status || '')}</li>`
        )
        .join('');
      const docLines = docs
        .map((d) => `<li>${esc(d.type)} ${esc(d.number || '')}</li>`)
        .join('');
      out.innerHTML = `
        <div class="passport-card" style="margin-top:12px">
          <h3 style="margin:0 0 8px">Found packing lot: ${esc(lot.code || '—')}</h3>
          <p class="meta">${statusBadge(lot.status)} · ${esc(lot.productDescription || '')} · ${esc(lot.packedQtyKg ?? '—')} kg packed</p>
          <dl class="kv">
            <dt>Where it grew</dt>
            <dd>${esc(site.name || site.code || '—')}${site.registrationNumber ? ' · reg ' + esc(site.registrationNumber) : ''}</dd>
            <dt>Boxes on this lot</dt>
            <dd>${esc(cases.length)} box(es)</dd>
          </dl>
          <div class="section">
            <h3>Dig batches</h3>
            <ul>${harvestLines || '<li>None listed</li>'}</ul>
          </div>
          <div class="section">
            <h3>Truck loads</h3>
            <ul>${shipLines || '<li>Not on a load yet</li>'}</ul>
          </div>
          <div class="section">
            <h3>Papers on file</h3>
            <ul>${docLines || '<li>None</li>'}</ul>
          </div>
        </div>`;
      toast('Found — see story below');
    } catch (e) {
      out.innerHTML = `<p class="meta balance-warn">${esc(e.message || 'Not found')}</p>`;
      toast(e.message, 'error');
    }
  };
}

async function renderDocs() {
  const savedMarkets = Array.isArray(loadFlow().paperMarkets) ? loadFlow().paperMarkets : [];
  let destinations = [];
  try {
    const d = await api('/destinations');
    destinations = d.destinations || [];
  } catch {
    destinations = [
      { id: 'EU', label: 'European Union' },
      { id: 'US', label: 'United States' },
      { id: 'GCC', label: 'Gulf (UAE, Saudi Arabia, etc.)' },
      { id: 'OTHER', label: 'Other country' },
    ];
  }

  const marketChecks = destinations
    .map(
      (d) => `
    <label class="dest-check">
      <input type="checkbox" name="paperMarket" value="${esc(d.id)}" ${
        savedMarkets.includes(d.id) ? 'checked' : ''
      } />
      <span>${esc(d.label)}</span>
    </label>`
    )
    .join('');

  el.detail.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>4. Papers</h2>
        <div class="meta">First pick where you will sell. Then upload only the papers that place needs.</div>
      </div>
    </div>
    ${balancePanelHtml()}
    <div class="section" style="margin-top:0">
      <h3>Where are you exporting? (pick one or more)</h3>
      <div class="dest-grid">${marketChecks}</div>
      <button type="button" class="btn btn-primary btn-sm" id="showPaperList" style="margin-top:12px">Show papers needed</button>
    </div>
    <div class="section" id="paperChecklistWrap">
      <p class="meta">Select at least one country / market above, then press <strong>Show papers needed</strong>.</p>
    </div>
  `;

  async function loadChecklist() {
    const markets = [...document.querySelectorAll('input[name="paperMarket"]:checked')].map(
      (el) => el.value
    );
    saveFlow({ paperMarkets: markets });
    const wrap = document.getElementById('paperChecklistWrap');
    if (!markets.length) {
      wrap.innerHTML =
        '<p class="meta balance-warn">Tick where you will export, then show the list.</p>';
      return;
    }
    wrap.innerHTML = '<p class="meta">Loading list…</p>';
    try {
      const data = await api('/papers/required?markets=' + encodeURIComponent(markets.join(',')));
      const rows = (data.checklist || [])
        .map((p) => {
          const statusLabel =
            p.status === 'ready' ? 'Ready' : p.status === 'uploaded' ? 'Uploaded' : 'Needed';
          const statusClass =
            p.status === 'ready' ? 'pass' : p.status === 'uploaded' ? 'OPEN_PACKING' : 'fail';
          return `
          <tr>
            <td><strong>${esc(p.title)}</strong><br><span class="meta">${esc(p.help || '')}</span></td>
            <td>${esc((p.requiredFor || []).join(', '))}</td>
            <td><span class="status ${statusClass}">${esc(statusLabel)}</span></td>
            <td>${esc(p.fileName || p.number || '—')}</td>
            <td>
              <button type="button" class="btn btn-primary btn-sm" data-upload-paper="${esc(p.key)}">Upload</button>
              ${
                p.downloadUrl
                  ? `<a class="btn btn-secondary btn-sm" href="${esc(p.downloadUrl)}" download>Download</a>`
                  : ''
              }
            </td>
          </tr>`;
        })
        .join('');
      wrap.innerHTML = `
        <h3>Papers needed for: ${esc((data.destinations || []).map((d) => d.label).join(', '))}</h3>
        <p class="meta">Upload each paper. Green “Ready” means it is on file for export checks.</p>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Paper</th><th>Needed for</th><th>Status</th><th>File</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5">No papers listed</td></tr>'}</tbody>
          </table>
        </div>`;
      wrap.querySelectorAll('[data-upload-paper]').forEach((btn) => {
        btn.onclick = () => openPaperUpload(btn.dataset.uploadPaper, data.checklist);
      });
    } catch (e) {
      wrap.innerHTML = `<p class="meta balance-warn">${esc(e.message)}</p>`;
    }
  }

  document.getElementById('showPaperList').onclick = () => loadChecklist();
  if (savedMarkets.length) loadChecklist();
}

function openPaperUpload(paperKey, checklist) {
  const paper = (checklist || []).find((p) => p.key === paperKey);
  if (!paper) return;
  const lots = (state.board?.tlcs || [])
    .map((t) => `<option value="${esc(t.id)}">${esc(t.code)} · ${esc(t.placeLabel || '')}</option>`)
    .join('');
  const ships = (state.board?.shipments || [])
    .map((s) => `<option value="${esc(s.id)}">${esc(s.code)} · ${esc(s.consigneeName || '')}</option>`)
    .join('');
  const today = new Date().toISOString().slice(0, 10);
  const yearEnd = `${new Date().getFullYear() + 1}-12-31`;

  let extraFields = '';
  if (paper.kind === 'certification') {
    extraFields = `
      <label class="field">Certificate number<input id="f_n" required /></label>
      <label class="field">GGN (if any)<input id="f_g" /></label>
      <label class="field">Valid from<input id="f_from" type="date" value="${esc(today)}" /></label>
      <label class="field">Valid to<input id="f_to" type="date" value="${esc(yearEnd)}" /></label>`;
  } else {
    extraFields = `
      <label class="field">Document number<input id="f_n" placeholder="Lab or certificate number" /></label>
      ${
        paper.needsResult
          ? `<label class="field">Result
              <select id="f_res"><option value="pass">Passed</option><option value="fail">Failed</option></select>
            </label>`
          : ''
      }
      ${
        paper.needsAd
          ? `<label class="field">Extra statement (if on the paper)<input id="f_ad" placeholder="Plant health statement if any" /></label>`
          : ''
      }
      ${
        paper.link === 'lot' || paper.link === 'lot_or_site'
          ? `<label class="field">Packing lot (optional)<select id="f_tlc"><option value="">—</option>${lots}</select></label>`
          : ''
      }
      ${
        paper.link === 'shipment'
          ? `<label class="field">Truck load (optional)<select id="f_ship"><option value="">—</option>${ships}</select></label>`
          : ''
      }`;
  }

  openModal(
    'Upload: ' + paper.title,
    `
    <p class="meta" style="margin:0 0 12px">${esc(paper.help || '')}</p>
    <div class="form-grid">
      ${extraFields}
      <label class="field">Upload file<input id="f_file" type="file" /></label>
    </div>`,
    async () => {
      const filePayload = await readFileInputAsBase64('f_file');
      if (paper.kind === 'certification') {
        await api('/certifications', {
          method: 'POST',
          body: JSON.stringify({
            scheme: paper.scheme,
            number: val('f_n') || paper.scheme + '-' + Date.now(),
            ggn: val('f_g'),
            validFrom: val('f_from') || today,
            validTo: val('f_to') || yearEnd,
            scope: state.board?.scope?.productLabel || 'Export crop',
            fileName: filePayload?.fileName || paper.scheme + '.txt',
            fileContentBase64: filePayload?.base64,
          }),
        });
      } else {
        await api('/documents', {
          method: 'POST',
          body: JSON.stringify({
            type: paper.type,
            number: val('f_n') || paper.type + '-' + Date.now(),
            result: paper.needsResult ? val('f_res') || 'pass' : null,
            additionalDeclaration: paper.needsAd ? val('f_ad') : '',
            tlcId: val('f_tlc') || null,
            shipmentId: val('f_ship') || null,
            fileName: filePayload?.fileName || paper.type + '.txt',
            fileContentBase64: filePayload?.base64,
            labName: paper.needsResult ? 'Lab' : '',
            sampleDate: paper.needsResult ? today : null,
          }),
        });
      }
      toast('Paper saved');
      await refresh();
      state.view = 'docs';
      syncNav();
      renderDocs();
    }
  );
}

function readFileInputAsBase64(inputId) {
  const input = document.getElementById(inputId);
  const file = input?.files?.[0];
  if (!file) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      resolve({ fileName: file.name, base64 });
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

refresh().catch((e) => {
  el.detail.innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p><p>Start the server and try Refresh.</p></div>`;
});

/* Agronexia Export Traceability — dashboard (standalone working model) */

const state = {
  view: 'board',
  board: null,
  selectedTlcId: null,
  selectedShipmentId: null,
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
  renderScope(state.board.scope);
  render();
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
        <li><strong>Where it grew</strong> — Prefer a greenhouse from <strong>Greenhouse ops</strong>, or add an export-only place. Then add a planting season.</li>
        <li><strong>What you dug</strong> — Harvest from that same place: date and kilos.</li>
        <li><strong>Packing lot</strong> — Make one packing lot from that harvest, fill boxes, put labels, then lock the lot so numbers cannot be quietly changed.</li>
        <li><strong>Papers</strong> — Add lab reports (safe food) and farm certificates (like GLOBALG.A.P.). Download anytime.</li>
        <li><strong>Load the truck</strong> — Say who the buyer is and where it goes. When everything is ready, lock the load and ship.</li>
        <li><strong>Find a box later</strong> — If someone asks “where did this box come from?”, type the lot or box code.</li>
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
  const availableOps = opsGhs.filter((g) => !g.linkedToExport);
  const linkedOps = opsGhs.filter((g) => g.linkedToExport);

  const opsAvailableRows = availableOps
    .map(
      (g) => `
    <tr>
      <td><strong>${esc(g.name)}</strong></td>
      <td>${esc(g.code)}</td>
      <td>${esc(g.plantType || '—')}</td>
      <td>${esc(g.location || '—')}</td>
      <td>${esc(g.plantCount)} plants</td>
      <td><button type="button" class="btn btn-primary btn-sm" data-use-gh="${esc(g.id)}">Use for export</button></td>
    </tr>`
    )
    .join('');

  const exportRows = sites
    .map(
      (s) => `
    <tr>
      <td><strong>${esc(s.displayName || s.name)}</strong></td>
      <td>${esc(s.code)}</td>
      <td>${esc(s.sourceLabel || (s.greenhouseId ? 'From Greenhouse ops' : 'Export only'))}</td>
      <td>${esc(s.cropName || '—')}</td>
      <td>${esc(s.registrationNumber || '—')}</td>
      <td>${esc(pathwayLabel(s.pestPathway))}</td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-edit-site="${esc(s.id)}">Edit export details</button></td>
    </tr>`
    )
    .join('');

  el.detail.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>1. Where it grew</h2>
        <div class="meta">Choose a greenhouse from Greenhouse ops, or add a place only for export.</div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-secondary btn-sm" id="addSiteOnly">+ Export-only place</button>
        <button class="btn btn-secondary btn-sm" id="addCycle">+ Planting season</button>
      </div>
    </div>

    <div class="section" style="margin-top:0">
      <h3>From Greenhouse ops (your greenhouses)</h3>
      <p class="meta">These come from the Greenhouse ops dashboard. Pick one to use for export tracking.</p>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Greenhouse</th><th>Code</th><th>Crop</th><th>Location</th><th>Plants</th><th></th></tr></thead>
          <tbody>
            ${
              opsAvailableRows ||
              (opsGhs.length
                ? '<tr><td colspan="6">All greenhouses are already linked for export (see below).</td></tr>'
                : '<tr><td colspan="6">No greenhouses yet. Create one under <a href="/">Greenhouse ops</a>, then come back.</td></tr>')
            }
          </tbody>
        </table>
      </div>
      ${
        linkedOps.length
          ? `<p class="meta" style="margin-top:10px">Already linked: ${linkedOps.map((g) => esc(g.name)).join(', ')}</p>`
          : ''
      }
    </div>

    <div class="section">
      <h3>Places ready for export</h3>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Place</th><th>Code</th><th>Source</th><th>Crop</th><th>Registration</th><th>Plant health origin</th><th></th></tr></thead>
          <tbody>${exportRows || '<tr><td colspan="7">None yet. Use a greenhouse above, or add an export-only place.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;

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
          await api('/sites', {
            method: 'POST',
            body: JSON.stringify({
              greenhouseId: gh.id,
              country: val('f_country'),
              registrationNumber: val('f_reg'),
              pestPathway: val('f_path'),
            }),
          });
          toast('Greenhouse linked for export');
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
        await api('/sites', {
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
        toast('Export place created');
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
  const rows = (state.board.harvests || [])
    .map((h) => {
      const when = h.harvestedAt ? new Date(h.harvestedAt).toLocaleString() : '—';
      return `
    <tr>
      <td><strong>${esc(h.code)}</strong></td>
      <td>${esc(h.placeLabel || '—')}${h.greenhouseId || h.site?.greenhouseId ? ' <span class="scope-pill">ops</span>' : ''}</td>
      <td>${esc(h.cropName || '—')}</td>
      <td>${esc(when)}</td>
      <td>${statusBadge(h.status)}</td>
      <td>${esc(h.quantityKg ?? '—')} kg</td>
      <td>${esc(h.remainingKg ?? '—')} kg left</td>
      <td>${
        h.status === 'OPEN'
          ? `<button type="button" class="btn btn-primary btn-sm" data-confirm="${esc(h.id)}">Confirm kilos</button>`
          : ''
      }</td>
    </tr>`;
    })
    .join('');

  el.detail.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>2. What you dug</h2>
        <div class="meta">Harvest is always from a place in step 1 (greenhouse from ops, or export-only place).</div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-primary btn-sm" id="addHarvest">+ Harvest</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Harvest</th><th>Place</th><th>Crop</th><th>When</th><th>Status</th><th>Kilos</th><th>Left</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8">No harvests yet. Link a greenhouse (or add a place) in step 1, then add a harvest.</td></tr>'}</tbody>
      </table>
    </div>
  `;

  document.getElementById('addHarvest').onclick = async () => {
    const cycles = await api('/cycles');
    if (!sites.length) {
      toast('Add a place in step 1 first (use a greenhouse or export-only place)', 'error');
      return;
    }
    const siteOpts = sites
      .map(
        (s) =>
          `<option value="${esc(s.id)}">${esc(s.displayName || s.name)}${s.greenhouseId ? ' · from ops' : ' · export only'}</option>`
      )
      .join('');
    const cycleOpts = cycles
      .map((c) => {
        const site = sites.find((x) => x.id === c.siteId);
        return `<option value="${esc(c.id)}" data-site="${esc(c.siteId)}">${esc(c.code)} · ${esc(c.variety)} · ${esc(site?.displayName || site?.name || '')}</option>`;
      })
      .join('');
    const today = new Date().toISOString().slice(0, 10);
    openModal(
      'Record harvest',
      `
      <div class="form-grid">
        <label class="field">Place (from step 1)<select id="f_site">${siteOpts}</select></label>
        <label class="field">Planting season<select id="f_cycle">${cycleOpts || '<option value="">Add a planting season in step 1 first</option>'}</select></label>
        <label class="field">Harvest date<input id="f_date" type="date" value="${esc(today)}" /></label>
        <label class="field">Who recorded it<input id="f_sup" /></label>
      </div>
      <p class="meta">After saving, use <strong>Confirm kilos</strong> on the row to enter weight.</p>
`,
      async () => {
        const dateVal = val('f_date');
        const harvestedAt = dateVal ? new Date(dateVal + 'T12:00:00').toISOString() : undefined;
        await api('/harvests', {
          method: 'POST',
          body: JSON.stringify({
            siteId: val('f_site'),
            cycleId: val('f_cycle'),
            supervisor: val('f_sup'),
            harvestedAt,
          }),
        });
        toast('Harvest opened');
      }
    );
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
          toast('Harvest kilos saved');
        }
      );
    };
  });
}

function renderTlcs() {
  if (state.selectedTlcId) {
    return renderTlcDetail(state.selectedTlcId);
  }
  const rows = state.board.tlcs
    .map(
      (t) => `
    <tr class="clickable" data-id="${esc(t.id)}">
      <td><strong>${esc(t.code)}</strong></td>
      <td>${statusBadge(t.status)}</td>
      <td>${esc(t.grade)}</td>
      <td>${esc(t.packedQtyKg)} kg</td>
    </tr>`
    )
    .join('');

  el.detail.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>3. Packing lot</h2>
        <div class="meta">Join harvest kilos into one lot, pack boxes, print labels, then lock.</div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-primary btn-sm" id="addTlc">+ TLC</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Code</th><th>Status</th><th>Grade</th><th>Packed</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">No TLCs</td></tr>'}</tbody>
      </table>
    </div>
  `;

  document.getElementById('addTlc').onclick = () => {
    const opts = state.board.sites.map((s) => `<option value="${esc(s.id)}">${esc(s.code)}</option>`).join('');
    openModal(
      'Create TLC (export batch)',
      `
      <div class="form-grid">
        <label class="field">Primary site<select id="f_site">${opts}</select></label>
        <label class="field">Grade<input id="f_grade" value="large" /></label>
        <label class="field">Program
          <select id="f_prog"><option value="conventional">conventional</option><option value="organic">organic</option></select>
        </label>
      </div>`,
      async () => {
        const t = await api('/tlcs', {
          method: 'POST',
          body: JSON.stringify({
            primarySiteId: val('f_site'),
            grade: val('f_grade'),
            program: val('f_prog'),
          }),
        });
        toast('TLC ' + t.code);
        state.selectedTlcId = t.id;
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
        <button class="btn btn-ghost btn-sm" id="backTlcs">All TLCs</button>
        <a class="btn btn-secondary btn-sm" href="/export/passport.html?code=${encodeURIComponent(t.code)}" target="_blank">Public passport</a>
        <button class="btn btn-secondary btn-sm" id="btnQr">QR passport URL</button>
        <button class="btn btn-secondary btn-sm" id="btnAlloc">Allocate harvest</button>
        <button class="btn btn-secondary btn-sm" id="btnCase">+ Case</button>
        <button class="btn btn-secondary btn-sm" id="btnLabels">Issue labels</button>
        <button class="btn btn-primary btn-sm" id="btnPackLock">Pack lock</button>
        <button class="btn btn-secondary btn-sm" id="btnMrl">Add MRL pass</button>
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
        <tbody>${docRows || '<tr><td colspan="4">No documents on this TLC</td></tr>'}</tbody>
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
      'Allocate harvest to TLC (same site only)',
      `<div class="form-grid">
        <label class="field">Harvest<select id="f_h">${opts}</select></label>
        <label class="field">Kg<input id="f_qty" type="number" min="0.1" step="0.1" /></label>
      </div>`,
      async () => {
        await api('/tlcs/' + t.id + '/allocate', {
          method: 'POST',
          body: JSON.stringify({ harvestId: val('f_h'), quantityKg: Number(val('f_qty')) }),
        });
        toast('Allocated');
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
      toast('Labels issued from system');
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
      toast('Pack locked');
      await refresh();
      state.selectedTlcId = t.id;
      renderTlcDetail(t.id);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  document.getElementById('btnMrl').onclick = () => {
    openModal(
      'Add MRL lab (pass)',
      `<div class="form-grid">
        <label class="field">Number<input id="f_n" value="LAB-MRL-" /></label>
        <label class="field">Market<input id="f_m" value="EU" /></label>
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
        toast('MRL document stored');
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
        <button class="btn btn-secondary btn-sm" id="btnAddTlc">Add TLC</button>
        <button class="btn btn-secondary btn-sm" id="btnTransport">Transport / docs fields</button>
        <button class="btn btn-secondary btn-sm" id="btnPhyto">Add phyto + commercial</button>
        <button class="btn btn-primary btn-sm" id="btnShipLock">Ship lock</button>
        <button class="btn btn-secondary btn-sm" id="btnShipped">Mark shipped</button>
      </div>
    </div>
    <div class="section" style="margin-top:0">
      <h3>Member TLCs</h3>
      <div class="table-wrap"><table class="data"><thead><tr><th>TLC</th><th>Kg</th><th>Status</th></tr></thead><tbody>${members || '<tr><td colspan="3">None</td></tr>'}</tbody></table></div>
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
      'Add TLC to shipment',
      `<label class="field">TLC<select id="f_t">${opts}</select></label>`,
      async () => {
        await api('/shipments/' + s.id + '/tlcs', {
          method: 'POST',
          body: JSON.stringify({ tlcId: val('f_t') }),
        });
        toast('TLC added');
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
      toast('Shipment locked — export pack ready');
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
      toast('Marked shipped');
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
        <div class="meta">Type a box code or packing-lot code to see where it came from.</div>
      </div>
    </div>
    <div class="form-grid">
      <label class="field">Case or TLC code<input id="recallQ" placeholder="e.g. CS-… or TLC-G-2026-0042" /></label>
    </div>
    <button class="btn btn-primary" id="runRecall">Run recall</button>
    <div id="recallOut" class="section"></div>
  `;
  document.getElementById('runRecall').onclick = async () => {
    const q = document.getElementById('recallQ').value.trim();
    const out = document.getElementById('recallOut');
    try {
      const r = await api('/recall', { method: 'POST', body: JSON.stringify({ query: q }) });
      out.innerHTML = `<pre style="white-space:pre-wrap;font-size:12px;background:#f7faf6;padding:14px;border-radius:12px;border:1px solid var(--border)">${esc(JSON.stringify(r.result, null, 2))}</pre>`;
      toast('Recall run logged');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
}

async function renderDocs() {
  const [docs, certs] = await Promise.all([api('/documents'), api('/certifications')]);
  const docRows = docs
    .map(
      (d) =>
        `<tr>
          <td>${esc(d.type)}</td>
          <td>${esc(d.number)}</td>
          <td>${esc(d.result || '—')}</td>
          <td>${esc(d.fileName || '—')}</td>
          <td>${esc(d.number ? '' : '')}${d.tlcId || d.shipmentId ? 'Linked' : '—'}</td>
          <td><a class="btn btn-secondary btn-sm" href="${esc(d.downloadUrl || '/api/traceability/documents/' + d.id + '/download')}" download>Download</a></td>
        </tr>`
    )
    .join('');
  const certRows = certs
    .map(
      (c) =>
        `<tr>
          <td>${esc(c.scheme)}</td>
          <td>${esc(c.number)}</td>
          <td>${esc(c.validFrom)} → ${esc(c.validTo)}</td>
          <td>${esc(c.fileName || '—')}</td>
          <td><a class="btn btn-secondary btn-sm" href="${esc(c.downloadUrl || '/api/traceability/certifications/' + c.id + '/download')}" download>Download</a></td>
        </tr>`
    )
    .join('');

  el.detail.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>4. Papers</h2>
        <div class="meta">Lab results and farm certificates. Same place for everyone — no separate cert app.</div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-secondary btn-sm" id="addGap">+ Farm certificate</button>
        <button class="btn btn-secondary btn-sm" id="addDoc">+ Lab or paper</button>
      </div>
    </div>
    <div class="section" style="margin-top:0">
      <h3>Lab reports & shipping papers</h3>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Type</th><th>Number</th><th>Result</th><th>File</th><th>Link</th><th></th></tr></thead>
        <tbody>${docRows || '<tr><td colspan="6">None</td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="section">
      <h3>Farm certificates (e.g. GLOBALG.A.P.)</h3>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Scheme</th><th>Number</th><th>Validity</th><th>File</th><th></th></tr></thead>
        <tbody>${certRows || '<tr><td colspan="5">None</td></tr>'}</tbody>
      </table></div>
    </div>
  `;

  document.getElementById('addGap').onclick = () => {
    openModal(
      'Add GLOBALG.A.P.',
      `<div class="form-grid">
        <label class="field">Number<input id="f_n" /></label>
        <label class="field">GGN<input id="f_g" /></label>
        <label class="field">Valid from<input id="f_from" type="date" /></label>
        <label class="field">Valid to<input id="f_to" type="date" /></label>
        <label class="field">Upload file (optional)<input id="f_file" type="file" /></label>
      </div>`,
      async () => {
        const filePayload = await readFileInputAsBase64('f_file');
        await api('/certifications', {
          method: 'POST',
          body: JSON.stringify({
            scheme: 'GLOBALG.A.P.',
            number: val('f_n'),
            ggn: val('f_g'),
            validFrom: val('f_from'),
            validTo: val('f_to'),
            scope: 'Fresh ginger rhizome',
            fileName: filePayload?.fileName,
            fileContentBase64: filePayload?.base64,
          }),
        });
        toast('Cert stored — downloadable');
      }
    );
  };

  document.getElementById('addDoc').onclick = () => {
    openModal(
      'Add document',
      `<div class="form-grid">
        <label class="field">Type
          <select id="f_type">
            <option value="MRL_LAB">MRL_LAB</option>
            <option value="RALSTONIA_LAB">RALSTONIA_LAB</option>
            <option value="PHYTO">PHYTO</option>
            <option value="INVOICE">INVOICE</option>
            <option value="PACKING_LIST">PACKING_LIST</option>
            <option value="COO">COO</option>
            <option value="OTHER">OTHER</option>
          </select>
        </label>
        <label class="field">Number<input id="f_n" /></label>
        <label class="field">Result
          <select id="f_res"><option value="">—</option><option value="pass">pass</option><option value="fail">fail</option></select>
        </label>
        <label class="field">TLC id (optional)<input id="f_tlc" /></label>
        <label class="field">Shipment id (optional)<input id="f_ship" /></label>
        <label class="field">Upload file (optional)<input id="f_file" type="file" /></label>
      </div>
`,
      async () => {
        const filePayload = await readFileInputAsBase64('f_file');
        await api('/documents', {
          method: 'POST',
          body: JSON.stringify({
            type: val('f_type'),
            number: val('f_n'),
            result: val('f_res') || null,
            tlcId: val('f_tlc') || null,
            shipmentId: val('f_ship') || null,
            fileName: filePayload?.fileName,
            fileContentBase64: filePayload?.base64,
          }),
        });
        toast('Document stored — downloadable');
      }
    );
  };
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

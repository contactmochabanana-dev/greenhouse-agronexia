const { id, code, now } = require('./ids');
const { evaluateTlc, evaluateShipment } = require('./gates');
const { getProfile, listProfiles } = require('./profiles');
const { buildExportPack } = require('./pack');

function audit(db, action, detail, actor = 'dashboard') {
  db.auditLog.push({ id: id(8), at: now(), action, detail, actor });
}

function appendEvent(db, payload) {
  const event = {
    id: id(12),
    eventType: payload.eventType,
    eventDatetime: payload.eventDatetime || now(),
    tlcId: payload.tlcId || null,
    tlcCode: payload.tlcCode || null,
    productDescription: payload.productDescription || 'Fresh ginger rhizome',
    quantity: payload.quantity ?? null,
    unit: payload.unit || 'kg',
    locationName: payload.locationName || null,
    siteId: payload.siteId || null,
    party: payload.party || null,
    referenceDocType: payload.referenceDocType || null,
    referenceDocNumber: payload.referenceDocNumber || null,
    recordedBy: payload.recordedBy || 'dashboard',
    recordedAt: now(),
    source: payload.source || 'dashboard',
    meta: payload.meta || null,
  };
  db.events.push(event);
  return event;
}

function requireFields(obj, fields) {
  for (const f of fields) {
    if (obj[f] === undefined || obj[f] === null || String(obj[f]).trim() === '') {
      const err = new Error(`Missing required field: ${f}`);
      err.status = 400;
      throw err;
    }
  }
}

function loadOpsDb() {
  try {
    return require('../store').load();
  } catch {
    return { greenhouses: [], plants: [] };
  }
}

/** Plant / crop names from Greenhouse ops dashboard (plantType on greenhouses). */
function productNamesFromOps() {
  const ops = loadOpsDb();
  return [
    ...new Set(
      (ops.greenhouses || [])
        .map((g) => (g.plantType || '').trim())
        .filter(Boolean)
    ),
  ];
}

/** Greenhouses from ops, with link status for export. */
function listOpsGreenhouses(db) {
  const ops = loadOpsDb();
  return (ops.greenhouses || []).map((g) => {
    const linked = (db.sites || []).find((s) => s.greenhouseId === g.id) || null;
    return {
      id: g.id,
      code: g.code,
      name: g.name,
      location: g.location || '',
      plantType: g.plantType || '',
      plantCount: (ops.plants || []).filter((p) => p.greenhouseId === g.id).length,
      linkedToExport: Boolean(linked),
      exportSiteId: linked?.id || null,
      exportSiteCode: linked?.code || null,
    };
  });
}

function enrichSite(db, site) {
  if (!site) return site;
  let greenhouse = null;
  if (site.greenhouseId) {
    greenhouse = loadOpsDb().greenhouses.find((g) => g.id === site.greenhouseId) || null;
  }
  return {
    ...site,
    source: site.greenhouseId ? 'greenhouse_ops' : 'export_only',
    sourceLabel: site.greenhouseId ? 'From Greenhouse ops' : 'Export only',
    greenhouse: greenhouse
      ? {
          id: greenhouse.id,
          code: greenhouse.code,
          name: greenhouse.name,
          location: greenhouse.location || '',
          plantType: greenhouse.plantType || '',
        }
      : null,
    displayName: greenhouse
      ? `${greenhouse.name} (${greenhouse.code})`
      : site.name,
    cropName:
      (greenhouse && greenhouse.plantType) ||
      site.plantType ||
      productNamesFromOps()[0] ||
      '',
  };
}

/** Plant ids already used in any harvest for this greenhouse / export site. */
function harvestedPlantIdSet(db, greenhouseId, siteId) {
  const used = new Set();
  for (const h of db.harvests || []) {
    const sameGh = greenhouseId && h.greenhouseId === greenhouseId;
    const sameSite = siteId && h.siteId === siteId;
    if (!sameGh && !sameSite) continue;
    for (const pid of h.plantIds || []) used.add(pid);
  }
  return used;
}

/**
 * Plants from Greenhouse ops for an export place (if linked).
 * Marks plants already put in a dig batch.
 */
function listOpsPlantsForExportSite(db, siteId) {
  const site = db.sites.find((s) => s.id === siteId);
  if (!site) {
    const err = new Error('Place not found');
    err.status = 404;
    throw err;
  }
  if (!site.greenhouseId) {
    return {
      linkedToOps: false,
      greenhouseId: null,
      plants: [],
      total: 0,
      free: 0,
      alreadyInBatch: 0,
    };
  }
  const ops = loadOpsDb();
  const all = (ops.plants || [])
    .filter((p) => p.greenhouseId === site.greenhouseId)
    .slice()
    .sort((a, b) => (a.number || 0) - (b.number || 0));
  const used = harvestedPlantIdSet(db, site.greenhouseId, site.id);
  const plants = all.map((p) => ({
    id: p.id,
    code: p.code,
    number: p.number,
    alreadyInBatch: used.has(p.id),
  }));
  return {
    linkedToOps: true,
    greenhouseId: site.greenhouseId,
    plants,
    total: plants.length,
    free: plants.filter((p) => !p.alreadyInBatch).length,
    alreadyInBatch: plants.filter((p) => p.alreadyInBatch).length,
  };
}

function enrichHarvest(db, harvest) {
  if (!harvest) return harvest;
  const site = db.sites.find((s) => s.id === harvest.siteId);
  const siteEnriched = enrichSite(db, site);
  const cycle = db.cropCycles.find((c) => c.id === harvest.cycleId);
  const totalKg = harvest.quantityKg == null ? null : Number(harvest.quantityKg);
  const remainingKg =
    harvest.remainingKg == null
      ? totalKg
      : Number(harvest.remainingKg);
  const inPackingLotsKg =
    totalKg == null || remainingKg == null ? null : Math.max(0, totalKg - remainingKg);
  // Unaccounted = confirmed kilos not yet put into any packing lot
  const unaccountedKg =
    harvest.status === 'OPEN' || totalKg == null ? null : Math.max(0, remainingKg);
  const allocations = (db.harvestAllocations || [])
    .filter((a) => a.harvestId === harvest.id)
    .map((a) => {
      const tlc = db.tlcs.find((t) => t.id === a.tlcId);
      return {
        tlcId: a.tlcId,
        tlcCode: tlc?.code || a.tlcId,
        quantityKg: a.quantityKg,
      };
    });
  const plantIds = Array.isArray(harvest.plantIds) ? harvest.plantIds : [];
  return {
    ...harvest,
    plantIds,
    plantCount: plantIds.length || harvest.plantCount || 0,
    site: siteEnriched || null,
    cycle: cycle || null,
    placeLabel: siteEnriched?.displayName || site?.name || '—',
    cropName: siteEnriched?.cropName || cycle?.variety || '',
    totalKg,
    inPackingLotsKg,
    unaccountedKg,
    allocations,
    selectableForPacking:
      harvest.status === 'CONFIRMED' && Number(remainingKg) > 0,
  };
}

function computeBalance(db) {
  const harvests = (db.harvests || []).map((h) => enrichHarvest(db, h));
  const confirmed = harvests.filter((h) => h.status === 'CONFIRMED' || h.quantityKg != null);
  const harvestedKg = confirmed.reduce((s, h) => s + Number(h.quantityKg || 0), 0);
  const inPackingLotsKg = confirmed.reduce((s, h) => s + Number(h.inPackingLotsKg || 0), 0);
  const unaccountedKg = confirmed.reduce((s, h) => s + Number(h.unaccountedKg || 0), 0);
  const openUnconfirmed = harvests.filter((h) => h.status === 'OPEN').length;
  return {
    harvestedKg,
    inPackingLotsKg,
    unaccountedKg,
    openUnconfirmedHarvests: openUnconfirmed,
    harvestCount: harvests.length,
    packingLotCount: (db.tlcs || []).length,
  };
}

function getScope(db) {
  const fromOps = productNamesFromOps();
  const fromCycles = [
    ...new Set(
      (db.cropCycles || [])
        .map((c) => (c.variety || '').trim())
        .filter(Boolean)
    ),
  ];
  // Prefer names already set on the Greenhouse ops dashboard
  const productNames = fromOps.length ? fromOps : fromCycles;
  const productLabel = productNames.length ? productNames.join(' · ') : '—';
  return {
    app: db.meta.app,
    /** Display name only — from greenhouse plantType (or cycle variety fallback) */
    productLabel,
    productNames,
    markets: db.meta.markets,
    photoGatesEnabled: Boolean(db.meta.photoGatesEnabled),
    profiles: listProfiles().map((p) => ({
      id: p.id,
      label: p.label,
      markets: p.markets,
      product: p.product,
    })),
  };
}

// ---------- Sites & cycles ----------

/**
 * Create an export place.
 * Choice:
 * - body.greenhouseId → link Greenhouse ops greenhouse (name/code from ops)
 * - no greenhouseId → export-only place (manual name/code)
 */
function createSite(db, body, actor = 'dashboard') {
  const greenhouseId = (body.greenhouseId || '').trim() || null;
  let opsGh = null;

  if (greenhouseId) {
    if (db.sites.some((s) => s.greenhouseId === greenhouseId)) {
      const err = new Error('This greenhouse is already linked for export');
      err.status = 400;
      throw err;
    }
    opsGh = loadOpsDb().greenhouses.find((g) => g.id === greenhouseId);
    if (!opsGh) {
      const err = new Error('Greenhouse not found in Greenhouse ops');
      err.status = 404;
      throw err;
    }
  }

  const code = (body.code || opsGh?.code || '').trim();
  const name = (body.name || opsGh?.name || '').trim();
  if (!code || !name) {
    const err = new Error('Name and code are required (or pick a greenhouse from ops)');
    err.status = 400;
    throw err;
  }
  if (db.sites.some((s) => s.code === code)) {
    const err = new Error('Site code already exists');
    err.status = 400;
    throw err;
  }

  const site = {
    id: id(),
    code,
    name,
    greenhouseId,
    plantType: (opsGh?.plantType || body.plantType || '').trim(),
    facilityName: (body.facilityName || opsGh?.name || '').trim(),
    address: (body.address || opsGh?.location || '').trim(),
    country: (body.country || '').trim(),
    geoLat: body.geoLat ?? null,
    geoLng: body.geoLng ?? null,
    registrationNumber: (body.registrationNumber || '').trim(),
    pestPathway: body.pestPathway || null,
    createdAt: now(),
  };
  db.sites.push(site);
  audit(
    db,
    'site.create',
    { siteId: site.id, code: site.code, greenhouseId: site.greenhouseId },
    actor
  );
  return enrichSite(db, site);
}

function updateSite(db, siteId, body, actor = 'dashboard') {
  const site = db.sites.find((s) => s.id === siteId);
  if (!site) {
    const err = new Error('Site not found');
    err.status = 404;
    throw err;
  }
  if (body.registrationNumber !== undefined) {
    site.registrationNumber = String(body.registrationNumber).trim();
  }
  if (body.pestPathway !== undefined) site.pestPathway = body.pestPathway;
  if (body.country !== undefined) site.country = String(body.country).trim();
  if (body.facilityName !== undefined) site.facilityName = String(body.facilityName).trim();
  if (body.address !== undefined) site.address = String(body.address).trim();
  // Do not freely reassign greenhouseId after create (keeps history stable)
  audit(db, 'site.update', { siteId: site.id }, actor);
  return enrichSite(db, site);
}

function createCropCycle(db, body, actor = 'dashboard') {
  requireFields(body, ['siteId', 'plantDate']);
  const site = db.sites.find((s) => s.id === body.siteId);
  if (!site) {
    const err = new Error('Site not found');
    err.status = 404;
    throw err;
  }
  const enriched = enrichSite(db, site);
  const variety = (body.variety || enriched.cropName || productNamesFromOps()[0] || 'Crop').trim();
  const cycle = {
    id: id(),
    code: code('CY'),
    siteId: site.id,
    variety,
    plantDate: body.plantDate,
    seedLotCode: (body.seedLotCode || '').trim(),
    status: 'active',
    createdAt: now(),
  };
  db.cropCycles.push(cycle);
  if (body.seedLotCode) {
    db.inputLots.push({
      id: id(),
      type: 'seed_rhizome',
      code: body.seedLotCode.trim(),
      cycleId: cycle.id,
      createdAt: now(),
    });
  }
  appendEvent(db, {
    eventType: 'GROWING_INPUT',
    siteId: site.id,
    locationName: site.name,
    quantity: null,
    recordedBy: actor,
    meta: { cycleId: cycle.id, variety: cycle.variety },
  });
  audit(db, 'cycle.create', { cycleId: cycle.id }, actor);
  return cycle;
}

function addTreatment(db, body, actor = 'dashboard') {
  requireFields(body, ['siteId', 'productName', 'appliedAt']);
  const site = db.sites.find((s) => s.id === body.siteId);
  if (!site) {
    const err = new Error('Site not found');
    err.status = 404;
    throw err;
  }
  const t = {
    id: id(),
    siteId: body.siteId,
    cycleId: body.cycleId || null,
    productName: body.productName.trim(),
    activeIngredient: (body.activeIngredient || '').trim(),
    rate: (body.rate || '').trim(),
    phiDays: body.phiDays ?? null,
    appliedAt: body.appliedAt,
    applicator: (body.applicator || '').trim(),
    createdAt: now(),
  };
  db.treatments.push(t);
  appendEvent(db, {
    eventType: 'TREATMENT',
    siteId: site.id,
    locationName: site.name,
    recordedBy: actor,
    referenceDocType: 'TREATMENT_LOG',
    referenceDocNumber: t.id,
    meta: { productName: t.productName },
  });
  return t;
}

// ---------- Harvest ----------

function createHarvest(db, body, actor = 'dashboard') {
  requireFields(body, ['siteId', 'cycleId']);
  const site = db.sites.find((s) => s.id === body.siteId);
  const cycle = db.cropCycles.find((c) => c.id === body.cycleId);
  if (!site || !cycle) {
    const err = new Error('Site or crop cycle not found');
    err.status = 404;
    throw err;
  }
  if (cycle.siteId !== site.id) {
    const err = new Error('Crop cycle does not belong to site');
    err.status = 400;
    throw err;
  }

  let plantIds = Array.isArray(body.plantIds) ? body.plantIds.filter(Boolean) : [];
  // Optional range by plant number for linked greenhouses: { fromNumber, toNumber }
  if (
    site.greenhouseId &&
    !plantIds.length &&
    body.fromNumber != null &&
    body.toNumber != null
  ) {
    const fromN = Number(body.fromNumber);
    const toN = Number(body.toNumber);
    if (!(fromN > 0) || !(toN >= fromN)) {
      const err = new Error('Plant number range is not valid');
      err.status = 400;
      throw err;
    }
    const plantInfo = listOpsPlantsForExportSite(db, site.id);
    plantIds = plantInfo.plants
      .filter((p) => !p.alreadyInBatch && p.number >= fromN && p.number <= toN)
      .map((p) => p.id);
  }

  if (site.greenhouseId && plantIds.length) {
    const plantInfo = listOpsPlantsForExportSite(db, site.id);
    const free = new Set(plantInfo.plants.filter((p) => !p.alreadyInBatch).map((p) => p.id));
    const valid = new Set(plantInfo.plants.map((p) => p.id));
    for (const pid of plantIds) {
      if (!valid.has(pid)) {
        const err = new Error('Plant does not belong to this greenhouse');
        err.status = 400;
        throw err;
      }
      if (!free.has(pid)) {
        const err = new Error('One or more plants are already in another dig batch');
        err.status = 400;
        throw err;
      }
    }
  } else if (site.greenhouseId && !plantIds.length && body.requirePlants) {
    const err = new Error('Select at least one plant for this dig batch');
    err.status = 400;
    throw err;
  }

  const harvest = {
    id: id(),
    code: code('HV'),
    siteId: site.id,
    cycleId: cycle.id,
    greenhouseId: site.greenhouseId || null,
    plantIds,
    plantCount: plantIds.length,
    harvestedAt: body.harvestedAt || now(),
    quantityKg: null,
    remainingKg: null,
    status: 'OPEN',
    supervisor: (body.supervisor || '').trim(),
    createdAt: now(),
  };
  db.harvests.push(harvest);
  audit(
    db,
    'harvest.create',
    {
      harvestId: harvest.id,
      greenhouseId: harvest.greenhouseId,
      plantCount: harvest.plantCount,
    },
    actor
  );
  return enrichHarvest(db, harvest);
}

function confirmHarvest(db, harvestId, body, actor = 'dashboard') {
  const harvest = db.harvests.find((h) => h.id === harvestId);
  if (!harvest) {
    const err = new Error('Harvest not found');
    err.status = 404;
    throw err;
  }
  if (harvest.status !== 'OPEN' && harvest.status !== 'CONFIRMED') {
    const err = new Error('Harvest cannot be confirmed in status ' + harvest.status);
    err.status = 400;
    throw err;
  }
  const qty = Number(body.quantityKg);
  if (!(qty > 0)) {
    const err = new Error('quantityKg must be > 0');
    err.status = 400;
    throw err;
  }
  const prev = Number(harvest.quantityKg || 0);
  const prevRemaining = harvest.remainingKg == null ? prev : Number(harvest.remainingKg);
  // first confirm sets qty; reconfirm only allowed if still OPEN-like with full remaining
  if (harvest.status === 'CONFIRMED' && prevRemaining !== prev) {
    const err = new Error('Harvest already partially allocated; cannot reconfirm total');
    err.status = 400;
    throw err;
  }
  harvest.quantityKg = qty;
  harvest.remainingKg = qty;
  harvest.status = 'CONFIRMED';
  harvest.supervisor = (body.supervisor || harvest.supervisor || '').trim();
  const site = db.sites.find((s) => s.id === harvest.siteId);
  appendEvent(db, {
    eventType: 'HARVEST',
    siteId: harvest.siteId,
    locationName: site?.name,
    quantity: qty,
    unit: 'kg',
    recordedBy: actor,
    referenceDocType: 'HARVEST',
    referenceDocNumber: harvest.code,
  });
  audit(db, 'harvest.confirm', { harvestId, quantityKg: qty }, actor);
  return enrichHarvest(db, harvest);
}

// ---------- TLC / pack ----------

function createTlc(db, body, actor = 'dashboard') {
  requireFields(body, ['primarySiteId', 'program', 'grade']);
  const site = db.sites.find((s) => s.id === body.primarySiteId);
  if (!site) {
    const err = new Error('Site not found');
    err.status = 404;
    throw err;
  }
  const program = body.program === 'organic' ? 'organic' : 'conventional';
  const defaultProduct =
    (body.productDescription || '').trim() ||
    productNamesFromOps()[0] ||
    'Export crop';
  const tlc = {
    id: id(),
    code: body.code?.trim() || code('TLC'),
    primarySiteId: site.id,
    program,
    grade: body.grade.trim(),
    productDescription: defaultProduct,
    form: (body.form || 'whole_washed').trim(),
    status: 'PLANNED',
    packedQtyKg: 0,
    wasteQtyKg: Number(body.wasteQtyKg || 0),
    packLockedAt: null,
    createdAt: now(),
  };
  if (db.tlcs.some((t) => t.code === tlc.code)) {
    const err = new Error('TLC code already exists');
    err.status = 400;
    throw err;
  }
  db.tlcs.push(tlc);
  audit(db, 'tlc.create', { tlcId: tlc.id, code: tlc.code }, actor);
  return tlc;
}

function allocateHarvest(db, tlcId, body, actor = 'dashboard') {
  const tlc = db.tlcs.find((t) => t.id === tlcId);
  if (!tlc) {
    const err = new Error('TLC not found');
    err.status = 404;
    throw err;
  }
  if (['PACKED', 'SHIP_LOCKED', 'SHIPPED'].includes(tlc.status)) {
    const err = new Error('Cannot allocate to locked TLC');
    err.status = 400;
    throw err;
  }
  requireFields(body, ['harvestId', 'quantityKg']);
  const harvest = db.harvests.find((h) => h.id === body.harvestId);
  if (!harvest || harvest.status === 'OPEN') {
    const err = new Error('Harvest must exist and be CONFIRMED');
    err.status = 400;
    throw err;
  }
  if (harvest.siteId !== tlc.primarySiteId) {
    const err = new Error('Cannot mix sites: harvest site does not match TLC primary site');
    err.status = 400;
    throw err;
  }
  const qty = Number(body.quantityKg);
  if (!(qty > 0)) {
    const err = new Error('quantityKg must be > 0');
    err.status = 400;
    throw err;
  }
  if (Number(harvest.remainingKg) < qty) {
    const err = new Error('Insufficient harvest remaining quantity');
    err.status = 400;
    throw err;
  }
  harvest.remainingKg = Number(harvest.remainingKg) - qty;
  const alloc = {
    id: id(8),
    tlcId: tlc.id,
    harvestId: harvest.id,
    quantityKg: qty,
    createdAt: now(),
  };
  db.harvestAllocations.push(alloc);
  if (tlc.status === 'PLANNED') tlc.status = 'OPEN_PACKING';
  audit(db, 'tlc.allocate', { tlcId, harvestId: harvest.id, quantityKg: qty }, actor);
  return { tlc, harvest, allocation: alloc };
}

function addCase(db, tlcId, body, actor = 'dashboard') {
  const tlc = db.tlcs.find((t) => t.id === tlcId);
  if (!tlc) {
    const err = new Error('TLC not found');
    err.status = 404;
    throw err;
  }
  if (['PACKED', 'SHIP_LOCKED', 'SHIPPED'].includes(tlc.status)) {
    const err = new Error('Cannot add cases after pack lock');
    err.status = 400;
    throw err;
  }
  const netKg = Number(body.netKg);
  if (!(netKg > 0)) {
    const err = new Error('netKg must be > 0');
    err.status = 400;
    throw err;
  }
  const c = {
    id: id(),
    code: body.code?.trim() || code('CS'),
    tlcId: tlc.id,
    netKg,
    labelIssued: false,
    createdAt: now(),
  };
  db.cases.push(c);
  tlc.packedQtyKg = Number(tlc.packedQtyKg || 0) + netKg;
  if (tlc.status === 'PLANNED') tlc.status = 'OPEN_PACKING';
  audit(db, 'case.add', { caseId: c.id, tlcId }, actor);
  return c;
}

function issueLabels(db, tlcId, actor = 'dashboard') {
  const tlc = db.tlcs.find((t) => t.id === tlcId);
  if (!tlc) {
    const err = new Error('TLC not found');
    err.status = 404;
    throw err;
  }
  const cases = db.cases.filter((c) => c.tlcId === tlcId);
  if (!cases.length) {
    const err = new Error('No cases to label');
    err.status = 400;
    throw err;
  }
  for (const c of cases) {
    c.labelIssued = true;
    c.labelIssuedAt = now();
  }
  audit(db, 'tlc.labels', { tlcId, count: cases.length }, actor);
  return cases;
}

function packLock(db, tlcId, actor = 'dashboard') {
  const tlc = db.tlcs.find((t) => t.id === tlcId);
  if (!tlc) {
    const err = new Error('TLC not found');
    err.status = 404;
    throw err;
  }
  if (!['OPEN_PACKING', 'PLANNED', 'DOCS_INCOMPLETE', 'CLEARED'].includes(tlc.status) && tlc.status !== 'ON_HOLD') {
    // allow pack lock from open packing primarily
  }
  if (['PACKED', 'SHIP_LOCKED', 'SHIPPED'].includes(tlc.status)) {
    const err = new Error('Already pack locked');
    err.status = 400;
    throw err;
  }
  const cases = db.cases.filter((c) => c.tlcId === tlcId);
  if (!cases.length) {
    const err = new Error('Cannot pack lock without cases');
    err.status = 400;
    throw err;
  }
  if (!cases.every((c) => c.labelIssued)) {
    const err = new Error('All cases must have system labels before pack lock');
    err.status = 400;
    throw err;
  }
  const allocs = db.harvestAllocations.filter((a) => a.tlcId === tlcId);
  if (!allocs.length) {
    const err = new Error('Cannot pack lock without harvest allocation');
    err.status = 400;
    throw err;
  }
  tlc.packedQtyKg = cases.reduce((s, c) => s + Number(c.netKg), 0);
  tlc.status = 'PACKED';
  tlc.packLockedAt = now();
  const site = db.sites.find((s) => s.id === tlc.primarySiteId);
  appendEvent(db, {
    eventType: 'INITIAL_PACK',
    tlcId: tlc.id,
    tlcCode: tlc.code,
    siteId: tlc.primarySiteId,
    locationName: site?.name,
    quantity: tlc.packedQtyKg,
    unit: 'kg',
    recordedBy: actor,
    productDescription: tlc.productDescription,
    referenceDocType: 'TLC',
    referenceDocNumber: tlc.code,
  });
  refreshTlcDocStatus(db, tlc);
  audit(db, 'tlc.pack_lock', { tlcId, packedQtyKg: tlc.packedQtyKg }, actor);
  return tlc;
}

function refreshTlcDocStatus(db, tlc) {
  if (!['PACKED', 'DOCS_INCOMPLETE', 'CLEARED'].includes(tlc.status)) return tlc;
  // without shipment, use DEFAULT_EXPORT-ish check of pack-level only
  const profileId = 'DEFAULT_EXPORT';
  const ev = evaluateTlc(db, tlc, profileId, null);
  // keep PACKED vs DOCS_INCOMPLETE based on MRL if present requirement soft
  const hasMrl = db.documents.some((d) => d.type === 'MRL_LAB' && d.tlcId === tlc.id && d.result === 'pass');
  if (tlc.status === 'PACKED' || tlc.status === 'DOCS_INCOMPLETE' || tlc.status === 'CLEARED') {
    tlc.status = hasMrl ? 'CLEARED' : 'DOCS_INCOMPLETE';
  }
  return { tlc, evaluation: ev };
}

// ---------- Documents ----------

function documentTextBody(doc) {
  return [
    'AGRONE XIA EXPORT TRACEABILITY — DOCUMENT',
    `Type: ${doc.type || ''}`,
    `Number: ${doc.number || ''}`,
    `Result: ${doc.result || ''}`,
    `Market: ${doc.market || ''}`,
    `Lab: ${doc.labName || ''}`,
    `Sample date: ${doc.sampleDate || ''}`,
    `Additional declaration: ${doc.additionalDeclaration || ''}`,
    `TLC id: ${doc.tlcId || ''}`,
    `Site id: ${doc.siteId || ''}`,
    `Shipment id: ${doc.shipmentId || ''}`,
    `Notes: ${doc.notes || ''}`,
    `Created: ${doc.createdAt || ''}`,
    `Created by: ${doc.createdBy || ''}`,
  ].join('\n');
}

function certificationTextBody(cert) {
  return [
    'AGRONE XIA EXPORT TRACEABILITY — CERTIFICATION',
    `Scheme: ${cert.scheme || ''}`,
    `Number: ${cert.number || ''}`,
    `GGN: ${cert.ggn || ''}`,
    `Valid from: ${cert.validFrom || ''}`,
    `Valid to: ${cert.validTo || ''}`,
    `Scope: ${cert.scope || ''}`,
    `Created: ${cert.createdAt || ''}`,
  ].join('\n');
}

function safeDownloadName(name, fallback) {
  const n = (name || fallback || 'download.txt').trim() || 'download.txt';
  return n.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

/** Returns { buffer, fileName, contentType } for HTTP download. */
function getDocumentDownload(doc) {
  if (!doc) return null;
  const fileName = safeDownloadName(doc.fileName, `${doc.type || 'document'}_${doc.number || doc.id}.txt`);
  if (doc.fileContentBase64) {
    const buffer = Buffer.from(doc.fileContentBase64, 'base64');
    const lower = fileName.toLowerCase();
    let contentType = 'application/octet-stream';
    if (lower.endsWith('.pdf')) contentType = 'application/pdf';
    else if (lower.endsWith('.png')) contentType = 'image/png';
    else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) contentType = 'image/jpeg';
    else if (lower.endsWith('.txt') || lower.endsWith('.csv')) contentType = 'text/plain; charset=utf-8';
    return { buffer, fileName, contentType };
  }
  const textName = fileName.includes('.') ? fileName : `${fileName}.txt`;
  return {
    buffer: Buffer.from(documentTextBody(doc), 'utf-8'),
    fileName: textName.endsWith('.txt') ? textName : textName.replace(/\.[^.]+$/, '') + '.txt',
    contentType: 'text/plain; charset=utf-8',
  };
}

function getCertificationDownload(cert) {
  if (!cert) return null;
  const fileName = safeDownloadName(
    cert.fileName,
    `${cert.scheme || 'cert'}_${cert.number || cert.id}.txt`
  );
  if (cert.fileContentBase64) {
    const buffer = Buffer.from(cert.fileContentBase64, 'base64');
    const lower = fileName.toLowerCase();
    let contentType = 'application/octet-stream';
    if (lower.endsWith('.pdf')) contentType = 'application/pdf';
    else if (lower.endsWith('.txt')) contentType = 'text/plain; charset=utf-8';
    return { buffer, fileName, contentType };
  }
  const textName = fileName.includes('.') ? fileName : `${fileName}.txt`;
  return {
    buffer: Buffer.from(certificationTextBody(cert), 'utf-8'),
    fileName: textName.endsWith('.txt') ? textName : `${textName}.txt`,
    contentType: 'text/plain; charset=utf-8',
  };
}

function addDocument(db, body, actor = 'dashboard') {
  requireFields(body, ['type']);
  const doc = {
    id: id(),
    type: body.type.trim(),
    number: (body.number || '').trim(),
    result: body.result || null,
    market: (body.market || '').trim(),
    labName: (body.labName || '').trim(),
    sampleDate: body.sampleDate || null,
    additionalDeclaration: (body.additionalDeclaration || '').trim(),
    fileName: (body.fileName || '').trim(),
    fileContentBase64: body.fileContentBase64 || null,
    tlcId: body.tlcId || null,
    siteId: body.siteId || null,
    shipmentId: body.shipmentId || null,
    notes: (body.notes || '').trim(),
    createdAt: now(),
    createdBy: actor,
  };
  if (!doc.fileName) {
    doc.fileName = `${doc.type || 'document'}_${doc.number || doc.id}.txt`;
  }
  if (!doc.fileContentBase64) {
    doc.fileContentBase64 = Buffer.from(documentTextBody(doc), 'utf-8').toString('base64');
  }
  db.documents.push(doc);
  if (doc.tlcId) {
    const tlc = db.tlcs.find((t) => t.id === doc.tlcId);
    if (tlc) refreshTlcDocStatus(db, tlc);
  }
  audit(db, 'document.add', { documentId: doc.id, type: doc.type }, actor);
  return doc;
}

function addCertification(db, body, actor = 'dashboard') {
  requireFields(body, ['scheme', 'number', 'validFrom', 'validTo']);
  const cert = {
    id: id(),
    scheme: body.scheme.trim(),
    number: body.number.trim(),
    ggn: (body.ggn || '').trim(),
    validFrom: body.validFrom,
    validTo: body.validTo,
    scope: (body.scope || 'Fresh ginger').trim(),
    fileName: (body.fileName || '').trim(),
    fileContentBase64: body.fileContentBase64 || null,
    createdAt: now(),
  };
  if (!cert.fileName) {
    cert.fileName = `${cert.scheme || 'cert'}_${cert.number || cert.id}.txt`.replace(/\s+/g, '_');
  }
  if (!cert.fileContentBase64) {
    cert.fileContentBase64 = Buffer.from(certificationTextBody(cert), 'utf-8').toString('base64');
  }
  db.certifications.push(cert);
  audit(db, 'cert.add', { certId: cert.id, scheme: cert.scheme }, actor);
  return cert;
}

// ---------- Shipments ----------

function createShipment(db, body, actor = 'dashboard') {
  requireFields(body, ['destinationProfile', 'consigneeName']);
  if (!getProfile(body.destinationProfile)) {
    const err = new Error('Unknown destination profile');
    err.status = 400;
    throw err;
  }
  const shipment = {
    id: id(),
    code: code('SH'),
    destinationProfile: body.destinationProfile,
    consigneeName: body.consigneeName.trim(),
    destinationCountry: (body.destinationCountry || '').trim(),
    pestPathway: body.pestPathway || null,
    transportDocNumber: (body.transportDocNumber || '').trim(),
    conveyanceId: (body.conveyanceId || '').trim(),
    status: 'OPEN',
    shipLockedAt: null,
    shippedAt: null,
    createdAt: now(),
  };
  db.shipments.push(shipment);
  audit(db, 'shipment.create', { shipmentId: shipment.id }, actor);
  return shipment;
}

function addTlcToShipment(db, shipmentId, body, actor = 'dashboard') {
  const shipment = db.shipments.find((s) => s.id === shipmentId);
  if (!shipment) {
    const err = new Error('Shipment not found');
    err.status = 404;
    throw err;
  }
  if (['SHIP_LOCKED', 'SHIPPED'].includes(shipment.status)) {
    const err = new Error('Shipment is locked');
    err.status = 400;
    throw err;
  }
  requireFields(body, ['tlcId']);
  const tlc = db.tlcs.find((t) => t.id === body.tlcId);
  if (!tlc) {
    const err = new Error('TLC not found');
    err.status = 404;
    throw err;
  }
  if (!['PACKED', 'DOCS_INCOMPLETE', 'CLEARED'].includes(tlc.status)) {
    const err = new Error('TLC must be pack-locked before adding to shipment');
    err.status = 400;
    throw err;
  }
  if (db.shipmentTlcs.some((m) => m.tlcId === tlc.id && m.shipmentId !== shipmentId)) {
    const existing = db.shipmentTlcs.find((m) => m.tlcId === tlc.id);
    const other = db.shipments.find((s) => s.id === existing.shipmentId);
    if (other && ['SHIP_LOCKED', 'SHIPPED'].includes(other.status)) {
      const err = new Error('TLC already on a locked shipment');
      err.status = 400;
      throw err;
    }
  }
  if (db.shipmentTlcs.some((m) => m.shipmentId === shipmentId && m.tlcId === tlc.id)) {
    return { shipment, tlc };
  }
  db.shipmentTlcs.push({
    id: id(8),
    shipmentId,
    tlcId: tlc.id,
    quantityKg: Number(body.quantityKg || tlc.packedQtyKg || 0),
  });
  audit(db, 'shipment.add_tlc', { shipmentId, tlcId: tlc.id }, actor);
  return { shipment, tlc };
}

function updateShipmentTransport(db, shipmentId, body, actor = 'dashboard') {
  const shipment = db.shipments.find((s) => s.id === shipmentId);
  if (!shipment) {
    const err = new Error('Shipment not found');
    err.status = 404;
    throw err;
  }
  if (['SHIP_LOCKED', 'SHIPPED'].includes(shipment.status)) {
    const err = new Error('Shipment is locked');
    err.status = 400;
    throw err;
  }
  if (body.transportDocNumber !== undefined) shipment.transportDocNumber = String(body.transportDocNumber).trim();
  if (body.conveyanceId !== undefined) shipment.conveyanceId = String(body.conveyanceId).trim();
  if (body.pestPathway !== undefined) shipment.pestPathway = body.pestPathway;
  if (body.consigneeName !== undefined) shipment.consigneeName = String(body.consigneeName).trim();
  if (body.destinationCountry !== undefined) shipment.destinationCountry = String(body.destinationCountry).trim();
  if (body.destinationProfile !== undefined) {
    if (!getProfile(body.destinationProfile)) {
      const err = new Error('Unknown destination profile');
      err.status = 400;
      throw err;
    }
    shipment.destinationProfile = body.destinationProfile;
  }
  audit(db, 'shipment.update', { shipmentId }, actor);
  return shipment;
}

function shipLock(db, shipmentId, actor = 'dashboard') {
  const shipment = db.shipments.find((s) => s.id === shipmentId);
  if (!shipment) {
    const err = new Error('Shipment not found');
    err.status = 404;
    throw err;
  }
  if (['SHIP_LOCKED', 'SHIPPED'].includes(shipment.status)) {
    const err = new Error('Already ship locked');
    err.status = 400;
    throw err;
  }
  const evaluation = evaluateShipment(db, shipment);
  if (!evaluation.ok) {
    const err = new Error('Gates failed — cannot ship lock');
    err.status = 400;
    err.evaluation = evaluation;
    throw err;
  }
  const pack = buildExportPack(db, shipment);
  db.exportPacks.push(pack.record);
  shipment.status = 'SHIP_LOCKED';
  shipment.shipLockedAt = now();
  shipment.exportPackId = pack.record.id;

  const members = db.shipmentTlcs.filter((m) => m.shipmentId === shipmentId);
  for (const m of members) {
    const tlc = db.tlcs.find((t) => t.id === m.tlcId);
    if (tlc) {
      tlc.status = 'SHIP_LOCKED';
      appendEvent(db, {
        eventType: 'SHIP',
        tlcId: tlc.id,
        tlcCode: tlc.code,
        siteId: tlc.primarySiteId,
        quantity: m.quantityKg,
        unit: 'kg',
        recordedBy: actor,
        productDescription: tlc.productDescription,
        referenceDocType: 'SHIPMENT',
        referenceDocNumber: shipment.code,
        party: shipment.consigneeName,
        meta: { conveyanceId: shipment.conveyanceId, transportDocNumber: shipment.transportDocNumber },
      });
    }
  }
  audit(db, 'shipment.ship_lock', { shipmentId, packId: pack.record.id }, actor);
  return { shipment, evaluation, pack: pack.record };
}

function markShipped(db, shipmentId, actor = 'dashboard') {
  const shipment = db.shipments.find((s) => s.id === shipmentId);
  if (!shipment) {
    const err = new Error('Shipment not found');
    err.status = 404;
    throw err;
  }
  if (shipment.status !== 'SHIP_LOCKED' && shipment.status !== 'SHIPPED') {
    const err = new Error('Ship lock required before marking shipped');
    err.status = 400;
    throw err;
  }
  shipment.status = 'SHIPPED';
  shipment.shippedAt = now();
  for (const m of db.shipmentTlcs.filter((x) => x.shipmentId === shipmentId)) {
    const tlc = db.tlcs.find((t) => t.id === m.tlcId);
    if (tlc) tlc.status = 'SHIPPED';
  }
  audit(db, 'shipment.shipped', { shipmentId }, actor);
  return shipment;
}

function overrideGate(db, body, actor = 'dashboard') {
  requireFields(body, ['gateId', 'reason']);
  const row = {
    id: id(8),
    gateId: body.gateId,
    tlcId: body.tlcId || null,
    shipmentId: body.shipmentId || null,
    reason: body.reason.trim(),
    actor,
    at: now(),
  };
  db.gateOverrides.push(row);
  audit(db, 'gate.override', row, actor);
  return row;
}

// ---------- Recall & passport ----------

function recallByCaseOrTlc(db, query, actor = 'dashboard') {
  const q = String(query || '').trim();
  if (!q) {
    const err = new Error('query required');
    err.status = 400;
    throw err;
  }
  let tlc = db.tlcs.find((t) => t.id === q || t.code === q);
  let caseRow = db.cases.find((c) => c.id === q || c.code === q);
  if (caseRow && !tlc) tlc = db.tlcs.find((t) => t.id === caseRow.tlcId);
  if (!tlc) {
    const err = new Error('Case or TLC not found');
    err.status = 404;
    throw err;
  }
  const cases = db.cases.filter((c) => c.tlcId === tlc.id);
  const allocs = db.harvestAllocations.filter((a) => a.tlcId === tlc.id);
  const harvests = allocs.map((a) => {
    const h = db.harvests.find((x) => x.id === a.harvestId);
    return { allocation: a, harvest: h };
  });
  const site = db.sites.find((s) => s.id === tlc.primarySiteId);
  const cycleIds = [...new Set(harvests.map((x) => x.harvest?.cycleId).filter(Boolean))];
  const cycles = db.cropCycles.filter((c) => cycleIds.includes(c.id));
  const treatments = db.treatments.filter((t) => t.siteId === tlc.primarySiteId);
  const docs = db.documents.filter((d) => d.tlcId === tlc.id);
  const membership = db.shipmentTlcs.filter((m) => m.tlcId === tlc.id);
  const shipments = membership.map((m) => db.shipments.find((s) => s.id === m.shipmentId)).filter(Boolean);
  for (const s of shipments) {
    docs.push(...db.documents.filter((d) => d.shipmentId === s.id));
  }
  const events = db.events.filter((e) => e.tlcId === tlc.id || e.tlcCode === tlc.code);
  const result = {
    queried: q,
    tlc,
    site,
    cases,
    harvests,
    cycles,
    treatments,
    documents: docs,
    shipments,
    events,
  };
  const run = {
    id: id(8),
    query: q,
    tlcId: tlc.id,
    at: now(),
    actor,
    summary: {
      caseCount: cases.length,
      shipmentCount: shipments.length,
      harvestCount: harvests.length,
    },
  };
  db.recallRuns.push(run);
  audit(db, 'recall.run', run, actor);
  return { run, result };
}

function publicPassport(db, tlcCode) {
  const tlc = db.tlcs.find((t) => t.code === tlcCode || t.id === tlcCode);
  if (!tlc) return null;
  const site = db.sites.find((s) => s.id === tlc.primarySiteId);
  const certs = (db.certifications || []).filter((c) => {
    const to = c.validTo ? new Date(c.validTo) : null;
    const from = c.validFrom ? new Date(c.validFrom) : null;
    const at = new Date();
    if (from && at < from) return false;
    if (to && at > to) return false;
    return true;
  });
  const events = db.events
    .filter((e) => e.tlcId === tlc.id)
    .map((e) => ({
      eventType: e.eventType,
      eventDatetime: e.eventDatetime,
      quantity: e.quantity,
      unit: e.unit,
    }));
  const names = productNamesFromOps();
  const productName =
    names[0] ||
    tlc.productDescription ||
    (db.cropCycles[0] && db.cropCycles[0].variety) ||
    'Export crop';
  return {
    scope: {
      product: productName,
      app: 'Agronexia Export Traceability',
      note: 'Public passport — limited fields. Full pack for authorized buyers only.',
    },
    tlc: {
      code: tlc.code,
      status: tlc.status,
      productDescription: tlc.productDescription,
      form: tlc.form,
      grade: tlc.grade,
      program: tlc.program,
      packLockedAt: tlc.packLockedAt,
      packedQtyKg: tlc.packedQtyKg,
    },
    origin: {
      country: site?.country || null,
      siteName: site?.name || null,
      siteCode: site?.code || null,
    },
    certifications: certs.map((c) => ({
      scheme: c.scheme,
      number: c.number,
      validTo: c.validTo,
    })),
    timeline: events,
  };
}

function listBoard(db) {
  const opsGreenhouses = listOpsGreenhouses(db);
  const harvests = db.harvests.map((h) => enrichHarvest(db, h));
  return {
    scope: getScope(db),
    balance: computeBalance(db),
    opsGreenhouses,
    sites: db.sites.map((s) => enrichSite(db, s)),
    harvests,
    cropCycles: db.cropCycles,
    tlcs: db.tlcs.map((t) => ({
      ...t,
      caseCount: db.cases.filter((c) => c.tlcId === t.id).length,
      allocatedKg: db.harvestAllocations
        .filter((a) => a.tlcId === t.id)
        .reduce((s, a) => s + Number(a.quantityKg || 0), 0),
      placeLabel: enrichSite(db, db.sites.find((s) => s.id === t.primarySiteId))?.displayName,
    })),
    shipments: db.shipments.map((s) => ({
      ...s,
      tlcCodes: db.shipmentTlcs
        .filter((m) => m.shipmentId === s.id)
        .map((m) => db.tlcs.find((t) => t.id === m.tlcId)?.code)
        .filter(Boolean),
    })),
  };
}

/**
 * Create packing lot from selected harvest batches (same place).
 * body: { harvestIds: [], grade, program, allocateAllRemaining?: boolean }
 */
function createPackingLotFromHarvests(db, body, actor = 'dashboard') {
  const harvestIds = Array.isArray(body.harvestIds) ? body.harvestIds.filter(Boolean) : [];
  if (!harvestIds.length) {
    const err = new Error('Select at least one harvest batch for packing');
    err.status = 400;
    throw err;
  }
  const harvests = harvestIds.map((hid) => db.harvests.find((h) => h.id === hid));
  if (harvests.some((h) => !h)) {
    const err = new Error('One or more harvests not found');
    err.status = 404;
    throw err;
  }
  const siteId = harvests[0].siteId;
  if (harvests.some((h) => h.siteId !== siteId)) {
    const err = new Error('All selected harvests must be from the same place');
    err.status = 400;
    throw err;
  }
  for (const h of harvests) {
    if (h.status !== 'CONFIRMED' || !(Number(h.remainingKg) > 0)) {
      const err = new Error(
        `Harvest ${h.code} has no kilos left for packing (confirm kilos first)`
      );
      err.status = 400;
      throw err;
    }
  }

  const tlc = createTlc(
    db,
    {
      primarySiteId: siteId,
      program: body.program || 'conventional',
      grade: (body.grade || 'standard').trim(),
      form: body.form || 'whole_washed',
      productDescription: body.productDescription,
    },
    actor
  );

  const allocations = [];
  for (const h of harvests) {
    const qty =
      body.allocateAllRemaining === false && body.quantities && body.quantities[h.id] != null
        ? Number(body.quantities[h.id])
        : Number(h.remainingKg);
    if (!(qty > 0)) continue;
    const result = allocateHarvest(db, tlc.id, { harvestId: h.id, quantityKg: qty }, actor);
    allocations.push(result.allocation);
  }
  if (!allocations.length) {
    const err = new Error('No kilos allocated to packing lot');
    err.status = 400;
    throw err;
  }

  return {
    tlc: db.tlcs.find((t) => t.id === tlc.id),
    allocations,
    balance: computeBalance(db),
  };
}

function getTlcDetail(db, tlcId) {
  const tlc = db.tlcs.find((t) => t.id === tlcId || t.code === tlcId);
  if (!tlc) return null;
  const site = enrichSite(db, db.sites.find((s) => s.id === tlc.primarySiteId));
  const cases = db.cases.filter((c) => c.tlcId === tlc.id);
  const allocs = db.harvestAllocations.filter((a) => a.tlcId === tlc.id);
  const harvests = allocs.map((a) => ({
    ...a,
    harvest: enrichHarvest(db, db.harvests.find((h) => h.id === a.harvestId)),
  }));
  const documents = db.documents.filter((d) => d.tlcId === tlc.id);
  const events = db.events.filter((e) => e.tlcId === tlc.id);
  return { tlc, site, cases, harvests, documents, events };
}

function getShipmentDetail(db, shipmentId) {
  const shipment = db.shipments.find((s) => s.id === shipmentId || s.code === shipmentId);
  if (!shipment) return null;
  const members = db.shipmentTlcs
    .filter((m) => m.shipmentId === shipment.id)
    .map((m) => ({
      ...m,
      tlc: db.tlcs.find((t) => t.id === m.tlcId),
    }));
  const documents = db.documents.filter((d) => d.shipmentId === shipment.id);
  const evaluation = evaluateShipment(db, shipment);
  const packs = db.exportPacks.filter((p) => p.shipmentId === shipment.id);
  return { shipment, members, documents, evaluation, packs };
}

module.exports = {
  getScope,
  listOpsGreenhouses,
  enrichSite,
  enrichHarvest,
  createSite,
  updateSite,
  createCropCycle,
  addTreatment,
  createHarvest,
  listOpsPlantsForExportSite,
  confirmHarvest,
  createTlc,
  createPackingLotFromHarvests,
  computeBalance,
  allocateHarvest,
  addCase,
  issueLabels,
  packLock,
  addDocument,
  addCertification,
  getDocumentDownload,
  getCertificationDownload,
  documentTextBody,
  certificationTextBody,
  createShipment,
  addTlcToShipment,
  updateShipmentTransport,
  shipLock,
  markShipped,
  overrideGate,
  recallByCaseOrTlc,
  publicPassport,
  listBoard,
  getTlcDetail,
  getShipmentDetail,
  evaluateTlc,
  evaluateShipment,
  appendEvent,
  audit,
};

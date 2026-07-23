const express = require('express');
const { nanoid } = require('nanoid');
const { load, save } = require('../lib/store');
const {
  evaluatePlantHealth,
  latestReadingsForPlants,
  normalizeRanges,
  validateConditionList,
} = require('../lib/health');

const router = express.Router();

function shortCode(prefix) {
  return `${prefix}-${nanoid(6).toUpperCase()}`;
}

// Greenhouses created before ideal-condition support won't have these
// fields on disk yet; default them so the rest of the app can rely on them.
function withConditions(gh) {
  return {
    ...gh,
    greenhouseConditions: gh.greenhouseConditions || [],
    plantConditions: gh.plantConditions || [],
  };
}

/**
 * Conditions support:
 *   rangeMode: "simple" — fineMin/Max + alertBelow/Above
 *   rangeMode: "bands"  — bands: [{ level: ok|warn|critical, min, max }, ...]
 */
function normalizeConditionList(list) {
  if (!Array.isArray(list)) return [];
  const result = [];
  for (const c of list) {
    const parameter = (c.parameter || '').trim();
    if (!parameter) continue;

    const payload = { ...c };
    const ranges = normalizeRanges(payload);
    const anyRange =
      ranges.fineMin ||
      ranges.fineMax ||
      ranges.alertBelow ||
      ranges.alertAbove ||
      (Array.isArray(c.bands) && c.bands.length > 0) ||
      ranges.rangeMode === 'bands';
    if (anyRange && !ranges.limitsOk) {
      const err = new Error(
        `${parameter}: ${ranges.limitsError || 'Invalid ranges (values must not overlap)'}`
      );
      err.status = 400;
      throw err;
    }

    result.push({
      id: c.id || nanoid(8),
      parameter,
      value: (c.value ?? '').toString().trim(),
      unit: (c.unit ?? '').toString().trim(),
      rangeMode: ranges.rangeMode,
      fineMin: ranges.fineMin,
      fineMax: ranges.fineMax,
      alertBelow: ranges.alertBelow,
      alertAbove: ranges.alertAbove,
      bands: ranges.bands,
      okMin: ranges.okMin,
      okMax: ranges.okMax,
      acceptableMin: ranges.acceptableMin,
      acceptableMax: ranges.acceptableMax,
      warnMin: ranges.warnMin,
      warnMax: ranges.warnMax,
      critMin: ranges.critMin,
      critMax: ranges.critMax,
    });
  }
  return result;
}

function attachPlantHealth(plants, greenhouse, db) {
  const conditions = greenhouse.plantConditions || [];
  const latestMap = latestReadingsForPlants(
    db.readings || [],
    plants.map((p) => p.id)
  );
  return plants.map((p) => {
    const { health, worstParameter } = evaluatePlantHealth(
      conditions,
      latestMap.get(p.id)
    );
    return { ...p, health, worstParameter };
  });
}

// ---------- Greenhouses ----------
// Each greenhouse grows exactly one kind of plant (plantType). Plants inside
// it are just numbered instances of that kind (#1, #2, ...).

router.get('/greenhouses', (req, res) => {
  const db = load();
  const result = db.greenhouses.map((gh) => ({
    ...withConditions(gh),
    plantCount: db.plants.filter((p) => p.greenhouseId === gh.id).length,
  }));
  res.json(result);
});

router.post('/greenhouses', (req, res) => {
  const { name, location, plantType } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!plantType || !plantType.trim()) return res.status(400).json({ error: 'Plant type is required' });

  const db = load();
  const greenhouse = {
    id: nanoid(10),
    code: shortCode('GH'),
    name: name.trim(),
    location: (location || '').trim(),
    plantType: plantType.trim(),
    // Ideal-condition parameters are fully user-defined (name/value/unit),
    // kept as two separate lists: one for the greenhouse environment itself,
    // one for the plant type grown in it.
    greenhouseConditions: [],
    plantConditions: [],
    createdAt: new Date().toISOString(),
  };
  db.greenhouses.push(greenhouse);
  save(db);
  res.status(201).json(greenhouse);
});

router.get('/greenhouses/:id', (req, res) => {
  const db = load();
  const greenhouse = db.greenhouses.find((g) => g.id === req.params.id);
  if (!greenhouse) return res.status(404).json({ error: 'Greenhouse not found' });
  res.json(withConditions(greenhouse));
});

router.put('/greenhouses/:id', (req, res) => {
  const db = load();
  const greenhouse = db.greenhouses.find((g) => g.id === req.params.id);
  if (!greenhouse) return res.status(404).json({ error: 'Greenhouse not found' });
  const { name, location, plantType } = req.body;
  if (name !== undefined) greenhouse.name = name.trim();
  if (location !== undefined) greenhouse.location = location.trim();
  if (plantType !== undefined) greenhouse.plantType = plantType.trim();
  save(db);
  res.json(greenhouse);
});

// Replace the full set of ideal-condition parameters for a greenhouse.
// Each list is an array of { parameter, value, unit, warnMin, warnMax, critMin, critMax }.
// Ranges drive plant-tile colour: ok / warn / critical from latest plant readings.
router.put('/greenhouses/:id/conditions', (req, res) => {
  const db = load();
  const greenhouse = db.greenhouses.find((g) => g.id === req.params.id);
  if (!greenhouse) return res.status(404).json({ error: 'Greenhouse not found' });

  try {
    if (req.body.greenhouseConditions !== undefined) {
      greenhouse.greenhouseConditions = normalizeConditionList(req.body.greenhouseConditions);
    }
    if (req.body.plantConditions !== undefined) {
      greenhouse.plantConditions = normalizeConditionList(req.body.plantConditions);
    }
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message || 'Invalid condition ranges' });
  }
  save(db);
  res.json(withConditions(greenhouse));
});

router.delete('/greenhouses/:id', (req, res) => {
  const db = load();
  const exists = db.greenhouses.some((g) => g.id === req.params.id);
  if (!exists) return res.status(404).json({ error: 'Greenhouse not found' });
  db.greenhouses = db.greenhouses.filter((g) => g.id !== req.params.id);
  db.plants = db.plants.filter((p) => p.greenhouseId !== req.params.id);
  save(db);
  res.status(204).end();
});

// ---------- Plants ----------

// Paginated plant list so the UI never has to render hundreds/thousands of
// rows at once.
router.get('/greenhouses/:id/plants', (req, res) => {
  const db = load();
  const greenhouse = db.greenhouses.find((g) => g.id === req.params.id);
  if (!greenhouse) return res.status(404).json({ error: 'Greenhouse not found' });

  const plants = db.plants
    .filter((p) => p.greenhouseId === req.params.id)
    .sort((a, b) => a.number - b.number);

  const total = plants.length;
  const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 100, 500);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const start = (page - 1) * pageSize;
  const pageItems = attachPlantHealth(
    plants.slice(start, start + pageSize),
    withConditions(greenhouse),
    db
  );

  res.json({ plants: pageItems, total, page, pageSize });
});

// Find a specific plant by number or code, and which page it falls on for
// the given pageSize, so the UI can jump straight to it instead of paging
// through thousands of plants.
router.get('/greenhouses/:id/plants/find', (req, res) => {
  const db = load();
  const greenhouse = db.greenhouses.find((g) => g.id === req.params.id);
  if (!greenhouse) return res.status(404).json({ error: 'Greenhouse not found' });

  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Query is required' });

  const plants = db.plants
    .filter((p) => p.greenhouseId === req.params.id)
    .sort((a, b) => a.number - b.number);

  const qNumber = parseInt(q, 10);
  const index = plants.findIndex(
    (p) => p.number === qNumber || p.code.toLowerCase() === q.toLowerCase()
  );
  if (index === -1) return res.status(404).json({ error: `No plant matching "${q}"` });

  const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 100, 500);
  const page = Math.floor(index / pageSize) + 1;

  res.json({ plant: plants[index], page, pageSize });
});

// Batch-create N more plants in a greenhouse, numbered to continue from
// whatever is already there, e.g. quantity 20 in a greenhouse that already
// has 30 plants creates #31 .. #50.
router.post('/greenhouses/:id/plants', (req, res) => {
  const db = load();
  const greenhouse = db.greenhouses.find((g) => g.id === req.params.id);
  if (!greenhouse) return res.status(404).json({ error: 'Greenhouse not found' });

  const qty = parseInt(req.body.quantity, 10);
  if (!Number.isInteger(qty) || qty < 1) return res.status(400).json({ error: 'Quantity must be at least 1' });
  if (qty > 1000) return res.status(400).json({ error: 'Quantity is too large (max 1000 at a time)' });

  const existingNumbers = db.plants
    .filter((p) => p.greenhouseId === greenhouse.id)
    .map((p) => p.number);
  let nextNumber = existingNumbers.length ? Math.max(...existingNumbers) + 1 : 1;

  const created = [];
  for (let i = 0; i < qty; i++) {
    const plant = {
      id: nanoid(10),
      code: shortCode('PL'),
      greenhouseId: greenhouse.id,
      number: nextNumber++,
      createdAt: new Date().toISOString(),
    };
    db.plants.push(plant);
    created.push(plant);
  }
  save(db);
  res.status(201).json(created);
});

router.get('/plants/:id', (req, res) => {
  const db = load();
  const plant = db.plants.find((p) => p.id === req.params.id);
  if (!plant) return res.status(404).json({ error: 'Plant not found' });
  res.json(plant);
});

// Plant plus its parent greenhouse (name, plant type, allowed parameters) —
// everything a client needs to render a plant detail view in one call.
router.get('/plants/:id/full', (req, res) => {
  const db = load();
  const plant = db.plants.find((p) => p.id === req.params.id);
  if (!plant) return res.status(404).json({ error: 'Plant not found' });
  const greenhouse = db.greenhouses.find((g) => g.id === plant.greenhouseId);
  if (!greenhouse) return res.status(404).json({ error: 'Greenhouse not found' });
  res.json({ plant, greenhouse: withConditions(greenhouse) });
});

router.delete('/plants/:id', (req, res) => {
  const db = load();
  const exists = db.plants.some((p) => p.id === req.params.id);
  if (!exists) return res.status(404).json({ error: 'Plant not found' });
  db.plants = db.plants.filter((p) => p.id !== req.params.id);
  save(db);
  res.status(204).end();
});

// ---------- QR lookup ----------
// Resolve the code(s) encoded in a QR to the full greenhouse (+ plant, if
// scanned) and the allowed-parameter list for *that* scope, so a scanner app
// can go straight from a scanned code to the right data-entry form.
//
// `pl` is optional: a greenhouse's own QR only encodes `gh`, and is used to
// enter greenhouse-wide readings (e.g. Temperature, Humidity). A plant's QR
// encodes both `gh` and `pl`, and is used to enter that plant's own readings
// (e.g. Soil pH) — greenhouse-wide parameters are never mixed into a plant's
// data, and plant-specific parameters are never mixed into the greenhouse's.
router.get('/lookup', (req, res) => {
  const gh = (req.query.gh || '').trim();
  const pl = (req.query.pl || '').trim();
  if (!gh) return res.status(400).json({ error: 'gh query param is required' });

  const db = load();
  const greenhouse = db.greenhouses.find((g) => g.code.toLowerCase() === gh.toLowerCase());
  if (!greenhouse) return res.status(404).json({ error: `No greenhouse matching "${gh}"` });
  const gh2 = withConditions(greenhouse);

  if (!pl) {
    return res.json({
      mode: 'greenhouse',
      greenhouse: gh2,
      parameters: gh2.greenhouseConditions.map((c) => ({
        ...c,
        source: 'greenhouse',
        warnMin: c.warnMin || '',
        warnMax: c.warnMax || '',
        critMin: c.critMin || '',
        critMax: c.critMax || '',
      })),
    });
  }

  const plant = db.plants.find(
    (p) => p.greenhouseId === greenhouse.id && p.code.toLowerCase() === pl.toLowerCase()
  );
  if (!plant) return res.status(404).json({ error: `No plant matching "${pl}" in this greenhouse` });

  res.json({
    mode: 'plant',
    greenhouse: gh2,
    plant,
    parameters: gh2.plantConditions.map((c) => ({
      ...c,
      source: 'plant',
      warnMin: c.warnMin || '',
      warnMax: c.warnMax || '',
      critMin: c.critMin || '',
      critMax: c.critMax || '',
    })),
  });
});

// ---------- Readings ----------
// Actual values entered over time, one row per parameter per submission.
// Greenhouse-wide readings (Temperature, Humidity, ...) and plant-specific
// readings (Soil pH, ...) are kept in entirely separate collections so a
// plant's history never shows greenhouse-wide data and vice versa.

router.get('/plants/:id/readings', (req, res) => {
  const db = load();
  const plant = db.plants.find((p) => p.id === req.params.id);
  if (!plant) return res.status(404).json({ error: 'Plant not found' });

  const readings = db.readings
    .filter((r) => r.plantId === req.params.id)
    .sort((a, b) => new Date(a.enteredAt) - new Date(b.enteredAt));
  res.json(readings);
});

router.post('/plants/:id/readings', (req, res) => {
  const db = load();
  const plant = db.plants.find((p) => p.id === req.params.id);
  if (!plant) return res.status(404).json({ error: 'Plant not found' });

  const entries = normalizeConditionList(req.body.readings);
  if (!entries.length) return res.status(400).json({ error: 'At least one reading is required' });

  const enteredAt = new Date().toISOString();
  const created = entries.map((e) => ({
    id: nanoid(10),
    plantId: plant.id,
    parameter: e.parameter,
    value: e.value,
    unit: e.unit,
    enteredAt,
  }));
  db.readings.push(...created);
  save(db);
  res.status(201).json(created);
});

router.get('/greenhouses/:id/readings', (req, res) => {
  const db = load();
  const greenhouse = db.greenhouses.find((g) => g.id === req.params.id);
  if (!greenhouse) return res.status(404).json({ error: 'Greenhouse not found' });

  const readings = db.greenhouseReadings
    .filter((r) => r.greenhouseId === req.params.id)
    .sort((a, b) => new Date(a.enteredAt) - new Date(b.enteredAt));
  res.json(readings);
});

router.post('/greenhouses/:id/readings', (req, res) => {
  const db = load();
  const greenhouse = db.greenhouses.find((g) => g.id === req.params.id);
  if (!greenhouse) return res.status(404).json({ error: 'Greenhouse not found' });

  const entries = normalizeConditionList(req.body.readings);
  if (!entries.length) return res.status(400).json({ error: 'At least one reading is required' });

  const enteredAt = new Date().toISOString();
  const created = entries.map((e) => ({
    id: nanoid(10),
    greenhouseId: greenhouse.id,
    parameter: e.parameter,
    value: e.value,
    unit: e.unit,
    enteredAt,
  }));
  db.greenhouseReadings.push(...created);
  save(db);
  res.status(201).json(created);
});

module.exports = router;

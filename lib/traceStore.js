/**
 * Separate persistence for Export Traceability (ginger batches).
 * Does not mix into greenhouses/plants db.json.
 */
const fs = require('fs');
const path = require('path');

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_DIR = path.join(__dirname, '..', 'data');
const LOCAL_DB = path.join(DATA_DIR, 'export-db.json');
const RUNTIME_DB = IS_SERVERLESS ? path.join('/tmp', 'export-db.json') : LOCAL_DB;
const PACKS_DIR = IS_SERVERLESS
  ? path.join('/tmp', 'export-packs')
  : path.join(DATA_DIR, 'export-packs');

function emptyDb() {
  return {
    meta: {
      app: 'agronexia-export-traceability',
      productScope:
        'Fresh ginger rhizome (Zingiber officinale) — whole / washed / graded for export',
      markets: ['EU_STRICT', 'EU_BASIC', 'US_STANDARD', 'GCC_PREMIUM', 'DEFAULT_EXPORT'],
      notInScope: ['fresh-cut ginger', 'dried ginger', 'blockchain theatre'],
      photoGatesEnabled: false,
    },
    parties: [],
    facilities: [],
    sites: [],
    cropCycles: [],
    inputLots: [],
    treatments: [],
    harvests: [],
    tlcs: [],
    harvestAllocations: [],
    cases: [],
    pallets: [],
    shipments: [],
    shipmentTlcs: [],
    documents: [],
    certifications: [],
    media: [],
    events: [],
    amendments: [],
    gateOverrides: [],
    recallRuns: [],
    exportPacks: [],
    accessGrants: [],
    auditLog: [],
  };
}

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PACKS_DIR)) fs.mkdirSync(PACKS_DIR, { recursive: true });
}

function load() {
  ensureDirs();
  if (!fs.existsSync(RUNTIME_DB)) {
    const db = emptyDb();
    save(db);
    return db;
  }
  try {
    const raw = fs.readFileSync(RUNTIME_DB, 'utf-8');
    const db = { ...emptyDb(), ...JSON.parse(raw || '{}') };
    for (const key of Object.keys(emptyDb())) {
      if (key === 'meta') {
        db.meta = { ...emptyDb().meta, ...(db.meta || {}) };
      } else if (!Array.isArray(db[key])) {
        db[key] = [];
      }
    }
    return db;
  } catch (err) {
    console.error('export-db read failed:', err.message);
    return emptyDb();
  }
}

function save(db) {
  ensureDirs();
  try {
    fs.writeFileSync(RUNTIME_DB, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('export-db write failed:', err.message);
  }
}

function packsDir() {
  ensureDirs();
  return PACKS_DIR;
}

module.exports = { load, save, emptyDb, packsDir, DATA_DIR };

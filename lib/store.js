const fs = require('fs');
const path = require('path');

// Vercel (and most serverless hosts) only allow writes under /tmp.
// Locally we keep using data/db.json so development stays simple.
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const SEED_FILE = path.join(__dirname, '..', 'data', 'seed.json');
const LOCAL_DB_FILE = path.join(__dirname, '..', 'data', 'db.json');
const RUNTIME_DB_FILE = IS_SERVERLESS
  ? path.join('/tmp', 'greenhouse-db.json')
  : LOCAL_DB_FILE;

const EMPTY_DB = () => ({
  greenhouses: [],
  plants: [],
  readings: [],
  greenhouseReadings: [],
});

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const db = JSON.parse(raw || '{}');
  if (!Array.isArray(db.greenhouses)) db.greenhouses = [];
  if (!Array.isArray(db.plants)) db.plants = [];
  if (!Array.isArray(db.readings)) db.readings = [];
  if (!Array.isArray(db.greenhouseReadings)) db.greenhouseReadings = [];
  return db;
}

function loadSeed() {
  if (fs.existsSync(SEED_FILE)) {
    try {
      return readJson(SEED_FILE);
    } catch (err) {
      console.error('Failed to read seed.json:', err.message);
    }
  }
  return EMPTY_DB();
}

// In-memory fallback if even /tmp writes fail.
let memoryDb = null;

function load() {
  try {
    if (fs.existsSync(RUNTIME_DB_FILE)) {
      return readJson(RUNTIME_DB_FILE);
    }
  } catch (err) {
    console.error('Failed to read runtime db:', err.message);
  }

  // First boot (or cold start with empty /tmp): seed Greenhouse A data.
  const seeded = loadSeed();
  try {
    save(seeded);
  } catch (err) {
    console.error('Failed to persist seeded db, using memory:', err.message);
    memoryDb = seeded;
  }
  return memoryDb || seeded;
}

function save(db) {
  if (memoryDb) {
    memoryDb = db;
  }
  try {
    ensureDir(RUNTIME_DB_FILE);
    fs.writeFileSync(RUNTIME_DB_FILE, JSON.stringify(db, null, 2));
    memoryDb = null;
  } catch (err) {
    // Serverless without writable disk — keep serving from memory.
    console.error('Failed to write db, falling back to memory:', err.message);
    memoryDb = db;
  }
}

module.exports = { load, save };

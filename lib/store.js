const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

function load() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = { greenhouses: [], plants: [], readings: [], greenhouseReadings: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  const db = JSON.parse(raw || '{"greenhouses":[],"plants":[],"readings":[],"greenhouseReadings":[]}');
  if (!Array.isArray(db.readings)) db.readings = [];
  if (!Array.isArray(db.greenhouseReadings)) db.greenhouseReadings = [];
  return db;
}

function save(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

module.exports = { load, save };

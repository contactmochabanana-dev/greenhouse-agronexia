const express = require('express');
const archiver = require('archiver');
const { load } = require('../lib/store');
const { buildPlantPayload, buildGreenhousePayload, generatePngBuffer } = require('../lib/qr');

const router = express.Router();

function safeFileName(str) {
  return str.replace(/[^a-z0-9\-_]+/gi, '_');
}

function plantFileName(greenhouse, plant) {
  return `${safeFileName(greenhouse.plantType)}_${plant.number}_${plant.code}.png`;
}

function byNumber(a, b) {
  return a.number - b.number;
}

// The greenhouse's own QR (scan this to enter greenhouse-wide readings,
// as opposed to a plant's QR which is for that plant's own readings)
router.get('/greenhouses/:id/qr.png', async (req, res) => {
  const db = load();
  const greenhouse = db.greenhouses.find((g) => g.id === req.params.id);
  if (!greenhouse) return res.status(404).json({ error: 'Greenhouse not found' });

  const payload = buildGreenhousePayload(greenhouse);
  const png = await generatePngBuffer(payload);
  const filename = `${safeFileName(greenhouse.name)}_${greenhouse.code}.png`;
  res.set('Content-Type', 'image/png');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(png);
});

// Single plant QR as a downloadable PNG
router.get('/plants/:id/qr.png', async (req, res) => {
  const db = load();
  const plant = db.plants.find((p) => p.id === req.params.id);
  if (!plant) return res.status(404).json({ error: 'Plant not found' });
  const greenhouse = db.greenhouses.find((g) => g.id === plant.greenhouseId);
  if (!greenhouse) return res.status(404).json({ error: 'Greenhouse not found' });

  const payload = buildPlantPayload(greenhouse, plant);
  const png = await generatePngBuffer(payload);
  const filename = `${safeFileName(greenhouse.name)}_${plantFileName(greenhouse, plant)}`;
  res.set('Content-Type', 'image/png');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(png);
});

// All plant QR codes for one greenhouse, zipped
router.get('/greenhouses/:id/qr-all.zip', async (req, res) => {
  const db = load();
  const greenhouse = db.greenhouses.find((g) => g.id === req.params.id);
  if (!greenhouse) return res.status(404).json({ error: 'Greenhouse not found' });
  const plants = db.plants.filter((p) => p.greenhouseId === greenhouse.id).sort(byNumber);

  res.set('Content-Type', 'application/zip');
  res.set(
    'Content-Disposition',
    `attachment; filename="${safeFileName(greenhouse.name)}_QRs.zip"`
  );

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => res.status(500).end(err.message));
  archive.pipe(res);

  for (const plant of plants) {
    const payload = buildPlantPayload(greenhouse, plant);
    const png = await generatePngBuffer(payload);
    archive.append(png, { name: plantFileName(greenhouse, plant) });
  }

  await archive.finalize();
});

// Every plant QR code across every greenhouse, zipped into folders
router.get('/qr-all.zip', async (req, res) => {
  const db = load();

  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', 'attachment; filename="all_greenhouses_QRs.zip"');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => res.status(500).end(err.message));
  archive.pipe(res);

  for (const greenhouse of db.greenhouses) {
    const plants = db.plants.filter((p) => p.greenhouseId === greenhouse.id).sort(byNumber);
    const folder = `${safeFileName(greenhouse.name)}_${greenhouse.code}`;
    for (const plant of plants) {
      const payload = buildPlantPayload(greenhouse, plant);
      const png = await generatePngBuffer(payload);
      archive.append(png, { name: `${folder}/${plantFileName(greenhouse, plant)}` });
    }
  }

  await archive.finalize();
});

module.exports = router;

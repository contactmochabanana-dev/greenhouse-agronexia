const QRCode = require('qrcode');

// Base URL of the (future) scanning website. Configurable via env var.
const SCAN_BASE_URL = process.env.SCAN_BASE_URL || 'https://scan.example.com';

// The payload encoded in each plant's QR code. It's a URL so a phone camera
// can open it directly once the scanning site exists, but it also carries
// the raw greenhouse/plant codes as query params for easy parsing.
function buildPlantPayload(greenhouse, plant) {
  const url = new URL(`${SCAN_BASE_URL}/scan`);
  url.searchParams.set('gh', greenhouse.code);
  url.searchParams.set('pl', plant.code);
  return url.toString();
}

// The greenhouse's own QR — no `pl` param, so a scanner can tell this is a
// greenhouse-level scan (for entering greenhouse-wide readings) rather than
// a plant-level one.
function buildGreenhousePayload(greenhouse) {
  const url = new URL(`${SCAN_BASE_URL}/scan`);
  url.searchParams.set('gh', greenhouse.code);
  return url.toString();
}

async function generatePngBuffer(text) {
  return QRCode.toBuffer(text, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 8,
  });
}

module.exports = { buildPlantPayload, buildGreenhousePayload, generatePngBuffer, SCAN_BASE_URL };

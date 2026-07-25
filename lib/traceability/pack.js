const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { id, now } = require('./ids');
const { packsDir } = require('../traceStore');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function safeName(s) {
  return String(s).replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function buildKdeCsv(db, shipment, tlcIds) {
  const headers = [
    'event_type',
    'event_datetime_utc',
    'tlc',
    'product_name',
    'quantity',
    'unit',
    'location_name',
    'site_id',
    'reference_doc_type',
    'reference_doc_number',
    'party',
    'recorded_by',
    'source',
  ];
  const rows = db.events.filter(
    (e) =>
      (e.tlcId && tlcIds.includes(e.tlcId)) ||
      (e.referenceDocType === 'SHIPMENT' && e.referenceDocNumber === shipment.code)
  );
  const lines = [headers.join(',')];
  for (const e of rows) {
    const tlc = db.tlcs.find((t) => t.id === e.tlcId);
    const vals = [
      e.eventType,
      e.eventDatetime,
      tlc?.code || e.tlcCode || '',
      e.productDescription || '',
      e.quantity ?? '',
      e.unit || '',
      e.locationName || '',
      e.siteId || '',
      e.referenceDocType || '',
      e.referenceDocNumber || '',
      e.party || '',
      e.recordedBy || '',
      e.source || '',
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
    lines.push(vals.join(','));
  }
  return lines.join('\n');
}

function buildPassportText(db, tlc) {
  const site = db.sites.find((s) => s.id === tlc.primarySiteId);
  const cases = db.cases.filter((c) => c.tlcId === tlc.id);
  return [
    'AGRONE XIA EXPORT TRACEABILITY — LOT PASSPORT',
    'Product scope: Fresh ginger rhizome (Zingiber officinale) export',
    '-----------------------------------------------------------',
    `TLC: ${tlc.code}`,
    `Status: ${tlc.status}`,
    `Product: ${tlc.productDescription}`,
    `Form/Grade: ${tlc.form} / ${tlc.grade}`,
    `Program: ${tlc.program}`,
    `Packed kg: ${tlc.packedQtyKg}`,
    `Cases: ${cases.length}`,
    `Site: ${site?.name || ''} (${site?.code || ''})`,
    `Country: ${site?.country || ''}`,
    `Registration: ${site?.registrationNumber || ''}`,
    `Pack locked at: ${tlc.packLockedAt || ''}`,
    '',
    'This file was generated from system of record at ship lock.',
    'Not a mock. Fields reflect stored genealogy and documents.',
  ].join('\n');
}

function buildPackingList(db, shipment, members) {
  const lines = [
    'PACKING LIST — Fresh ginger rhizome export',
    `Shipment: ${shipment.code}`,
    `Consignee: ${shipment.consigneeName}`,
    `Destination profile: ${shipment.destinationProfile}`,
    `Transport: ${shipment.transportDocNumber} / ${shipment.conveyanceId}`,
    '',
    'TLC,Grade,Program,Cases,Kg',
  ];
  for (const m of members) {
    const tlc = db.tlcs.find((t) => t.id === m.tlcId);
    const caseCount = db.cases.filter((c) => c.tlcId === m.tlcId).length;
    lines.push(
      `${tlc?.code || m.tlcId},${tlc?.grade || ''},${tlc?.program || ''},${caseCount},${m.quantityKg}`
    );
  }
  return lines.join('\n');
}

function buildExportPack(db, shipment) {
  const version = (db.exportPacks.filter((p) => p.shipmentId === shipment.id).length || 0) + 1;
  const folderName = `AGX-GINGER-${new Date().getUTCFullYear()}-${safeName(shipment.code)}-v${version}`;
  const dir = path.join(packsDir(), folderName);
  fs.mkdirSync(dir, { recursive: true });

  const members = db.shipmentTlcs.filter((m) => m.shipmentId === shipment.id);
  const tlcIds = members.map((m) => m.tlcId);
  const files = [];

  function writeFile(rel, content) {
    const abs = path.join(dir, rel);
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
    const parent = path.dirname(abs);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(abs, buf);
    files.push({ path: rel, sha256: sha256(buf), bytes: buf.length });
  }

  writeFile(`02_KDE_${safeName(shipment.code)}.csv`, buildKdeCsv(db, shipment, tlcIds));
  writeFile(`03_PackingList_${safeName(shipment.code)}.csv`, buildPackingList(db, shipment, members));
  writeFile(
    `03_PackingList_${safeName(shipment.code)}.txt`,
    buildPackingList(db, shipment, members)
  );

  for (const m of members) {
    const tlc = db.tlcs.find((t) => t.id === m.tlcId);
    if (tlc) {
      writeFile(`01_Passport_${safeName(tlc.code)}.txt`, buildPassportText(db, tlc));
    }
  }

  const docs = db.documents.filter(
    (d) => d.shipmentId === shipment.id || tlcIds.includes(d.tlcId)
  );
  for (const d of docs) {
    const sub =
      d.type === 'PHYTO'
        ? '05_Phyto_Certs'
        : d.type === 'MRL_LAB' || d.type === 'RALSTONIA_LAB'
          ? '04_Labs'
          : d.type === 'INVOICE' || d.type === 'PACKING_LIST' || d.type === 'COO'
            ? '06_Commercial'
            : '07_Other';
    const name = d.fileName || `${d.type}_${d.id}.txt`;
    let body = d.fileContentBase64
      ? Buffer.from(d.fileContentBase64, 'base64')
      : Buffer.from(
          [
            `Document type: ${d.type}`,
            `Number: ${d.number}`,
            `Result: ${d.result || ''}`,
            `Lab: ${d.labName || ''}`,
            `Sample date: ${d.sampleDate || ''}`,
            `Additional declaration: ${d.additionalDeclaration || ''}`,
            `Notes: ${d.notes || ''}`,
            `TLC: ${d.tlcId || ''}`,
            `Shipment: ${d.shipmentId || ''}`,
          ].join('\n'),
          'utf-8'
        );
    writeFile(path.join(sub, safeName(name)), body);
  }

  for (const cert of db.certifications || []) {
    writeFile(
      path.join('07_Certifications', safeName(`${cert.scheme}_${cert.number}.txt`)),
      [
        `Scheme: ${cert.scheme}`,
        `Number: ${cert.number}`,
        `GGN: ${cert.ggn || ''}`,
        `Valid: ${cert.validFrom} — ${cert.validTo}`,
        `Scope: ${cert.scope}`,
      ].join('\n')
    );
  }

  const manifest = {
    app: 'agronexia-export-traceability',
    productScope: 'Fresh ginger rhizome export',
    shipmentCode: shipment.code,
    shipmentId: shipment.id,
    destinationProfile: shipment.destinationProfile,
    version,
    generatedAt: now(),
    tlcCodes: members.map((m) => db.tlcs.find((t) => t.id === m.tlcId)?.code).filter(Boolean),
    files,
  };
  writeFile('00_MANIFEST.json', JSON.stringify(manifest, null, 2));

  const record = {
    id: id(),
    shipmentId: shipment.id,
    version,
    folderName,
    absolutePath: dir,
    manifest,
    createdAt: now(),
  };

  return { record, dir, manifest };
}

function readPackManifest(db, packId) {
  const pack = db.exportPacks.find((p) => p.id === packId);
  if (!pack) return null;
  const manifestPath = path.join(packsDir(), pack.folderName, '00_MANIFEST.json');
  if (!fs.existsSync(manifestPath)) return pack;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  return { ...pack, manifest };
}

module.exports = { buildExportPack, readPackManifest, packsDir };

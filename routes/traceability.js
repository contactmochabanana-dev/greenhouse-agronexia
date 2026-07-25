const express = require('express');
const path = require('path');
const fs = require('fs');
const store = require('../lib/traceStore');
const domain = require('../lib/traceability/domain');
const { listProfiles, GATE_CATALOG } = require('../lib/traceability/profiles');
const { seedFresh } = require('../lib/traceability/seed');
const { packsDir } = require('../lib/traceStore');

const router = express.Router();

function withDb(fn) {
  return (req, res) => {
    try {
      const db = store.load();
      const result = fn(db, req, res);
      if (result && typeof result.then === 'function') {
        result
          .then((data) => {
            if (res.headersSent) return;
            store.save(db);
            res.json(data);
          })
          .catch((err) => sendErr(res, err));
        return;
      }
      if (res.headersSent) return;
      store.save(db);
      if (result === undefined) return;
      res.json(result);
    } catch (err) {
      sendErr(res, err);
    }
  };
}

function sendErr(res, err) {
  const status = err.status || 500;
  const body = { error: err.message || 'Server error' };
  if (err.evaluation) body.evaluation = err.evaluation;
  res.status(status).json(body);
}

// ---------- Scope / meta ----------
router.get(
  '/scope',
  withDb((db) => domain.getScope(db))
);

router.get('/profiles', (_req, res) => {
  res.json({ profiles: listProfiles(), gateCatalog: GATE_CATALOG });
});

router.post('/seed', (req, res) => {
  try {
    const { result } = seedFresh();
    res.json({ ok: true, result });
  } catch (err) {
    sendErr(res, err);
  }
});

router.get(
  '/board',
  withDb((db) => domain.listBoard(db))
);

// ---------- Sites / cycles / harvests ----------
router.get(
  '/sites',
  withDb((db) => db.sites)
);
router.post(
  '/sites',
  withDb((db, req) => domain.createSite(db, req.body || {}))
);

router.get(
  '/cycles',
  withDb((db) => db.cropCycles)
);
router.post(
  '/cycles',
  withDb((db, req) => domain.createCropCycle(db, req.body || {}))
);

router.get(
  '/harvests',
  withDb((db) => db.harvests)
);
router.post(
  '/harvests',
  withDb((db, req) => domain.createHarvest(db, req.body || {}))
);
router.post(
  '/harvests/:id/confirm',
  withDb((db, req) => domain.confirmHarvest(db, req.params.id, req.body || {}))
);

router.post(
  '/treatments',
  withDb((db, req) => domain.addTreatment(db, req.body || {}))
);

// ---------- TLC ----------
router.get(
  '/tlcs',
  withDb((db) => domain.listBoard(db).tlcs)
);
router.get(
  '/tlcs/:id',
  withDb((db, req) => {
    const detail = domain.getTlcDetail(db, req.params.id);
    if (!detail) {
      const err = new Error('TLC not found');
      err.status = 404;
      throw err;
    }
    return detail;
  })
);
router.post(
  '/tlcs',
  withDb((db, req) => domain.createTlc(db, req.body || {}))
);
router.post(
  '/tlcs/:id/allocate',
  withDb((db, req) => domain.allocateHarvest(db, req.params.id, req.body || {}))
);
router.post(
  '/tlcs/:id/cases',
  withDb((db, req) => domain.addCase(db, req.params.id, req.body || {}))
);
router.post(
  '/tlcs/:id/labels',
  withDb((db, req) => domain.issueLabels(db, req.params.id))
);
router.post(
  '/tlcs/:id/pack-lock',
  withDb((db, req) => domain.packLock(db, req.params.id))
);
router.get(
  '/tlcs/:id/gates',
  withDb((db, req) => {
    const tlc = db.tlcs.find((t) => t.id === req.params.id || t.code === req.params.id);
    if (!tlc) {
      const err = new Error('TLC not found');
      err.status = 404;
      throw err;
    }
    const profileId = req.query.profile || 'DEFAULT_EXPORT';
    return domain.evaluateTlc(db, tlc, profileId, null);
  })
);

/** QR target URL for labels (print/scan uses public passport). PNG via external tool if needed. */
router.get('/tlcs/:id/qr-target', (req, res) => {
  try {
    const db = store.load();
    const tlc = db.tlcs.find((t) => t.id === req.params.id || t.code === req.params.id);
    if (!tlc) return res.status(404).json({ error: 'TLC not found' });
    const base = `${req.protocol}://${req.get('host')}`;
    const url = `${base}/export/passport.html?code=${encodeURIComponent(tlc.code)}`;
    res.json({ tlcCode: tlc.code, passportUrl: url });
  } catch (err) {
    sendErr(res, err);
  }
});

// ---------- Documents / certs ----------
router.get(
  '/documents',
  withDb((db) =>
    db.documents.map((d) => {
      const { fileContentBase64, ...rest } = d;
      return {
        ...rest,
        hasFile: true,
        downloadUrl: `/api/traceability/documents/${d.id}/download`,
      };
    })
  )
);
router.post(
  '/documents',
  withDb((db, req) => domain.addDocument(db, req.body || {}))
);
router.get('/documents/:id/download', (req, res) => {
  try {
    const db = store.load();
    const doc = db.documents.find((d) => d.id === req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const file = domain.getDocumentDownload(doc);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName.replace(/"/g, '')}"`
    );
    res.send(file.buffer);
  } catch (err) {
    sendErr(res, err);
  }
});

router.get(
  '/certifications',
  withDb((db) =>
    db.certifications.map((c) => {
      const { fileContentBase64, ...rest } = c;
      return {
        ...rest,
        hasFile: true,
        downloadUrl: `/api/traceability/certifications/${c.id}/download`,
      };
    })
  )
);
router.post(
  '/certifications',
  withDb((db, req) => domain.addCertification(db, req.body || {}))
);
router.get('/certifications/:id/download', (req, res) => {
  try {
    const db = store.load();
    const cert = db.certifications.find((c) => c.id === req.params.id);
    if (!cert) return res.status(404).json({ error: 'Certification not found' });
    const file = domain.getCertificationDownload(cert);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName.replace(/"/g, '')}"`
    );
    res.send(file.buffer);
  } catch (err) {
    sendErr(res, err);
  }
});

// ---------- Shipments ----------
router.get(
  '/shipments',
  withDb((db) => domain.listBoard(db).shipments)
);
router.get(
  '/shipments/:id',
  withDb((db, req) => {
    const detail = domain.getShipmentDetail(db, req.params.id);
    if (!detail) {
      const err = new Error('Shipment not found');
      err.status = 404;
      throw err;
    }
    return detail;
  })
);
router.post(
  '/shipments',
  withDb((db, req) => domain.createShipment(db, req.body || {}))
);
router.patch(
  '/shipments/:id',
  withDb((db, req) => domain.updateShipmentTransport(db, req.params.id, req.body || {}))
);
router.post(
  '/shipments/:id/tlcs',
  withDb((db, req) => domain.addTlcToShipment(db, req.params.id, req.body || {}))
);
router.post(
  '/shipments/:id/ship-lock',
  withDb((db, req) => domain.shipLock(db, req.params.id))
);
router.post(
  '/shipments/:id/shipped',
  withDb((db, req) => domain.markShipped(db, req.params.id))
);

router.get('/shipments/:id/pack', (req, res) => {
  try {
    const db = store.load();
    const detail = domain.getShipmentDetail(db, req.params.id);
    if (!detail) return res.status(404).json({ error: 'Shipment not found' });
    const pack = detail.packs[detail.packs.length - 1];
    if (!pack) return res.status(404).json({ error: 'No export pack — ship lock first' });
    res.json(pack);
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/shipments/:id/pack/file', (req, res) => {
  try {
    const db = store.load();
    const detail = domain.getShipmentDetail(db, req.params.id);
    if (!detail) return res.status(404).json({ error: 'Shipment not found' });
    const pack = detail.packs[detail.packs.length - 1];
    if (!pack) return res.status(404).json({ error: 'No export pack' });
    const rel = String(req.query.path || '00_MANIFEST.json');
    if (rel.includes('..')) return res.status(400).json({ error: 'Invalid path' });
    const abs = path.join(packsDir(), pack.folderName, rel);
    if (!abs.startsWith(path.join(packsDir(), pack.folderName))) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File not found' });
    res.sendFile(abs);
  } catch (err) {
    sendErr(res, err);
  }
});

// ---------- Recall / events / overrides ----------
router.post(
  '/recall',
  withDb((db, req) => domain.recallByCaseOrTlc(db, req.body?.query || req.body?.q || ''))
);

router.post(
  '/gates/override',
  withDb((db, req) => domain.overrideGate(db, req.body || {}))
);

router.get(
  '/events',
  withDb((db) => db.events.slice(-500))
);

router.get(
  '/audit',
  withDb((db) => db.auditLog.slice(-200))
);

// Public passport JSON
router.get('/passport/:code', (req, res) => {
  try {
    const db = store.load();
    const passport = domain.publicPassport(db, req.params.code);
    if (!passport) return res.status(404).json({ error: 'TLC not found' });
    res.json(passport);
  } catch (err) {
    sendErr(res, err);
  }
});

module.exports = router;

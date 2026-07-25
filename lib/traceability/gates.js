const { getProfile, GATE_CATALOG } = require('./profiles');

const MASS_TOLERANCE_KG = 25;

function docsOf(db, filterFn) {
  return (db.documents || []).filter(filterFn);
}

function certValid(cert, at = new Date()) {
  if (!cert) return false;
  const from = cert.validFrom ? new Date(cert.validFrom) : null;
  const to = cert.validTo ? new Date(cert.validTo) : null;
  if (from && at < from) return false;
  if (to && at > to) return false;
  return true;
}

function evaluateGate(gateId, ctx) {
  const { db, tlc, shipment, photoGatesEnabled } = ctx;
  const reasonFail = (reason) => ({ id: gateId, pass: false, reason });
  const pass = () => ({ id: gateId, pass: true, reason: 'ok' });

  switch (gateId) {
    case 'G_SITE': {
      if (!tlc?.primarySiteId) return reasonFail('missing_primary_site');
      const site = db.sites.find((s) => s.id === tlc.primarySiteId);
      if (!site) return reasonFail('site_not_found');
      return pass();
    }
    case 'G_SITE_REG': {
      const site = db.sites.find((s) => s.id === tlc?.primarySiteId);
      if (!site?.registrationNumber?.trim()) return reasonFail('missing_site_registration');
      return pass();
    }
    case 'G_GENEALOGY': {
      const allocs = db.harvestAllocations.filter((a) => a.tlcId === tlc?.id);
      if (!allocs.length) return reasonFail('no_harvest_allocations');
      for (const a of allocs) {
        const h = db.harvests.find((x) => x.id === a.harvestId);
        if (!h) return reasonFail('harvest_missing');
        if (h.siteId !== tlc.primarySiteId) return reasonFail('site_mismatch');
      }
      return pass();
    }
    case 'G_PACK_LOCK': {
      if (!['PACKED', 'DOCS_INCOMPLETE', 'CLEARED', 'SHIP_LOCKED', 'SHIPPED'].includes(tlc?.status)) {
        return reasonFail('not_pack_locked');
      }
      return pass();
    }
    case 'G_MASS_BAL': {
      const allocs = db.harvestAllocations.filter((a) => a.tlcId === tlc?.id);
      const allocated = allocs.reduce((s, a) => s + Number(a.quantityKg || 0), 0);
      const packed = Number(tlc?.packedQtyKg || 0);
      const waste = Number(tlc?.wasteQtyKg || 0);
      const diff = Math.abs(allocated - (packed + waste));
      if (diff > MASS_TOLERANCE_KG) {
        return reasonFail(`mass_balance_variance_kg:${diff.toFixed(2)}`);
      }
      return pass();
    }
    case 'G_LABEL': {
      const cases = db.cases.filter((c) => c.tlcId === tlc?.id && c.labelIssued);
      if (!cases.length) return reasonFail('no_labeled_cases');
      return pass();
    }
    case 'G_PHOTO_CASE': {
      if (!photoGatesEnabled) return pass();
      const ok = db.media.some(
        (m) => m.linkType === 'tlc' && m.linkId === tlc?.id && m.reviewState === 'accepted' && m.moment === 'labeled_case'
      );
      if (!ok) return reasonFail('missing_accepted_case_photos');
      return pass();
    }
    case 'G_PHOTO_LOAD': {
      if (!photoGatesEnabled) return pass();
      const ok = db.media.some(
        (m) =>
          m.linkType === 'shipment' &&
          m.linkId === shipment?.id &&
          m.reviewState === 'accepted' &&
          m.moment === 'load'
      );
      if (!ok) return reasonFail('missing_accepted_load_photos');
      return pass();
    }
    case 'G_MRL': {
      const lab = docsOf(
        db,
        (d) => d.type === 'MRL_LAB' && d.tlcId === tlc?.id && d.result === 'pass'
      );
      if (!lab.length) return reasonFail('missing_mrl_pass');
      return pass();
    }
    case 'G_RALSTONIA': {
      const lab = docsOf(
        db,
        (d) =>
          d.type === 'RALSTONIA_LAB' &&
          d.result === 'pass' &&
          (d.tlcId === tlc?.id || d.siteId === tlc?.primarySiteId)
      );
      if (!lab.length) return reasonFail('missing_ralstonia_pass');
      return pass();
    }
    case 'G_PHYTO': {
      const phyto = docsOf(
        db,
        (d) =>
          d.type === 'PHYTO' &&
          d.shipmentId === shipment?.id &&
          d.number?.trim() &&
          d.fileName
      );
      if (!phyto.length) return reasonFail('missing_phyto');
      if (!phyto.some((p) => p.additionalDeclaration?.trim())) {
        return reasonFail('missing_phyto_additional_declaration');
      }
      return pass();
    }
    case 'G_PATHWAY': {
      const pathway = shipment?.pestPathway || db.sites.find((s) => s.id === tlc?.primarySiteId)?.pestPathway;
      if (!pathway) return reasonFail('missing_pest_pathway');
      return pass();
    }
    case 'G_GAP': {
      const certs = (db.certifications || []).filter(
        (c) => c.scheme === 'GLOBALG.A.P.' && certValid(c)
      );
      if (!certs.length) return reasonFail('missing_valid_globalgap');
      return pass();
    }
    case 'G_ORGANIC': {
      if (tlc?.program !== 'organic') return pass();
      const certs = (db.certifications || []).filter((c) => c.scheme === 'ORGANIC' && certValid(c));
      if (!certs.length) return reasonFail('missing_valid_organic');
      return pass();
    }
    case 'G_COMMERCIAL': {
      const inv = docsOf(db, (d) => d.type === 'INVOICE' && d.shipmentId === shipment?.id);
      const pl = docsOf(db, (d) => d.type === 'PACKING_LIST' && d.shipmentId === shipment?.id);
      if (!inv.length) return reasonFail('missing_invoice');
      if (!pl.length) return reasonFail('missing_packing_list');
      return pass();
    }
    case 'G_TRANSPORT': {
      if (!shipment?.transportDocNumber?.trim()) return reasonFail('missing_transport_doc');
      if (!shipment?.conveyanceId?.trim()) return reasonFail('missing_conveyance_id');
      return pass();
    }
    case 'G_COO': {
      const coo = docsOf(db, (d) => d.type === 'COO' && d.shipmentId === shipment?.id);
      if (!coo.length) return reasonFail('missing_coo');
      return pass();
    }
    case 'G_HOLD': {
      if (tlc?.status === 'ON_HOLD') return reasonFail('tlc_on_hold');
      if (shipment?.status === 'ON_HOLD') return reasonFail('shipment_on_hold');
      return pass();
    }
    default:
      return reasonFail('unknown_gate');
  }
}

function evaluateTlc(db, tlc, profileId, shipment = null) {
  const profile = getProfile(profileId);
  if (!profile) {
    return { profileId, ok: false, results: [{ id: 'PROFILE', pass: false, reason: 'unknown_profile' }] };
  }
  const photoGatesEnabled = Boolean(db.meta?.photoGatesEnabled);
  const ctx = { db, tlc, shipment, photoGatesEnabled };
  const results = profile.tlcGates.map((g) => {
    const r = evaluateGate(g, ctx);
    return { ...r, description: GATE_CATALOG[g] || g };
  });
  const overrides = (db.gateOverrides || []).filter(
    (o) => o.tlcId === tlc.id && (!shipment || o.shipmentId === shipment.id || !o.shipmentId)
  );
  for (const r of results) {
    if (!r.pass && overrides.some((o) => o.gateId === r.id)) {
      r.pass = true;
      r.reason = 'override';
      r.overridden = true;
    }
  }
  return { profileId, ok: results.every((r) => r.pass), results };
}

function evaluateShipment(db, shipment) {
  const profile = getProfile(shipment.destinationProfile);
  if (!profile) {
    return {
      profileId: shipment.destinationProfile,
      ok: false,
      tlcResults: [],
      shipmentResults: [{ id: 'PROFILE', pass: false, reason: 'unknown_profile' }],
    };
  }
  const photoGatesEnabled = Boolean(db.meta?.photoGatesEnabled);
  const memberIds = db.shipmentTlcs.filter((m) => m.shipmentId === shipment.id).map((m) => m.tlcId);
  const tlcs = memberIds.map((id) => db.tlcs.find((t) => t.id === id)).filter(Boolean);

  const tlcResults = tlcs.map((tlc) => ({
    tlcId: tlc.id,
    tlcCode: tlc.code,
    ...evaluateTlc(db, tlc, shipment.destinationProfile, shipment),
  }));

  const shipCtxBase = { db, shipment, photoGatesEnabled };
  const shipmentResults = profile.shipmentGates.map((g) => {
    // shipment-level gates that need a tlc use first member for site-linked checks
    const tlc = tlcs[0] || null;
    const r = evaluateGate(g, { ...shipCtxBase, tlc });
    return { ...r, description: GATE_CATALOG[g] || g };
  });

  const overrides = (db.gateOverrides || []).filter((o) => o.shipmentId === shipment.id);
  for (const r of shipmentResults) {
    if (!r.pass && overrides.some((o) => o.gateId === r.id && !o.tlcId)) {
      r.pass = true;
      r.reason = 'override';
      r.overridden = true;
    }
  }

  // All member TLCs must pass their gates; shipment gates must pass
  const ok =
    tlcResults.length > 0 &&
    tlcResults.every((t) => t.ok) &&
    shipmentResults.every((r) => r.pass);

  return {
    profileId: profile.id,
    profileLabel: profile.label,
    ok,
    tlcResults,
    shipmentResults,
  };
}

module.exports = { evaluateTlc, evaluateShipment, evaluateGate, MASS_TOLERANCE_KG };

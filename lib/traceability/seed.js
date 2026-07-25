/**
 * Sample export dataset — real records via domain functions (validations on).
 * Creates one incomplete lot and one ship-ready path.
 */

const store = require('../traceStore');
const domain = require('./domain');

function seedFresh() {
  const db = store.emptyDb();
  const actor = 'seed';

  domain.addCertification(
    db,
    {
      scheme: 'GLOBALG.A.P.',
      number: 'GGN-9001',
      ggn: '4049929123456',
      validFrom: '2025-01-01',
      validTo: '2027-12-31',
      scope: 'Fresh ginger rhizome',
      fileName: 'globalgap.txt',
    },
    actor
  );

  const siteA = domain.createSite(
    db,
    {
      name: 'Greenhouse Block A — Ginger',
      code: 'SITE-A',
      facilityName: 'Agronexia Ginger Complex',
      address: 'Nagaon Export Farm',
      country: 'IN',
      geoLat: 26.35,
      geoLng: 92.68,
      registrationNumber: 'NPPO-REG-SITE-A-001',
      pestPathway: 'registered_site',
    },
    actor
  );

  const siteB = domain.createSite(
    db,
    {
      name: 'Greenhouse Block B — Ginger',
      code: 'SITE-B',
      facilityName: 'Agronexia Ginger Complex',
      address: 'Nagaon Export Farm',
      country: 'IN',
      geoLat: 26.351,
      geoLng: 92.682,
      registrationNumber: 'NPPO-REG-SITE-B-002',
      pestPathway: 'registered_site',
    },
    actor
  );

  const cycleA = domain.createCropCycle(
    db,
    {
      siteId: siteA.id,
      variety: productNamesFromOpsOrDefault(),
      plantDate: '2025-11-01',
      seedLotCode: 'SEED-GIN-2025-11',
    },
    actor
  );

  domain.createCropCycle(
    db,
    {
      siteId: siteB.id,
      variety: productNamesFromOpsOrDefault(),
      plantDate: '2025-11-05',
      seedLotCode: 'SEED-GIN-2025-11B',
    },
    actor
  );

  domain.addTreatment(
    db,
    {
      siteId: siteA.id,
      cycleId: cycleA.id,
      productName: 'Neem oil',
      activeIngredient: 'azadirachtin',
      rate: 'as label',
      phiDays: 3,
      appliedAt: '2026-06-01T08:00:00.000Z',
      applicator: 'Farm lead',
    },
    actor
  );

  const hA = domain.createHarvest(
    db,
    { siteId: siteA.id, cycleId: cycleA.id, supervisor: 'Harvest lead' },
    actor
  );
  domain.confirmHarvest(db, hA.id, { quantityKg: 1200, supervisor: 'Harvest lead' }, actor);

  const productName = productNamesFromOpsOrDefault();
  const tlcReady = domain.createTlc(
    db,
    {
      primarySiteId: siteA.id,
      program: 'conventional',
      grade: 'large',
      form: 'whole_washed',
      productDescription: productName,
      code: 'TLC-G-2026-0042',
    },
    actor
  );
  domain.allocateHarvest(db, tlcReady.id, { harvestId: hA.id, quantityKg: 800 }, actor);
  for (let i = 0; i < 80; i++) {
    domain.addCase(db, tlcReady.id, { netKg: 10 }, actor);
  }
  domain.issueLabels(db, tlcReady.id, actor);
  domain.packLock(db, tlcReady.id, actor);

  domain.addDocument(
    db,
    {
      type: 'MRL_LAB',
      number: 'LAB-MRL-7781',
      result: 'pass',
      market: 'EU',
      labName: 'Residue Lab',
      sampleDate: '2026-07-20',
      tlcId: tlcReady.id,
      fileName: 'mrl_tlc42.txt',
      notes: 'Sample lab report — stored document record',
    },
    actor
  );
  domain.addDocument(
    db,
    {
      type: 'RALSTONIA_LAB',
      number: 'LAB-RAL-221',
      result: 'pass',
      labName: 'Plant Health Molecular Lab',
      sampleDate: '2026-07-18',
      siteId: siteA.id,
      tlcId: tlcReady.id,
      fileName: 'ralstonia_siteA.txt',
    },
    actor
  );

  const ship = domain.createShipment(
    db,
    {
      destinationProfile: 'EU_STRICT',
      consigneeName: 'EU Importer BV',
      destinationCountry: 'NL',
      pestPathway: 'registered_site',
    },
    actor
  );
  domain.updateShipmentTransport(
    db,
    ship.id,
    {
      transportDocNumber: 'BOL-900',
      conveyanceId: 'CONT-MSKU1234567',
    },
    actor
  );
  domain.addTlcToShipment(db, ship.id, { tlcId: tlcReady.id }, actor);
  domain.addDocument(
    db,
    {
      type: 'PHYTO',
      number: 'PHYTO-IN-2026-55421',
      shipmentId: ship.id,
      additionalDeclaration:
        'Rhizomes from registered production site NPPO-REG-SITE-A-001; pre-export molecular test LAB-RAL-221 negative for Ralstonia pseudosolanacearum.',
      fileName: 'phyto.txt',
    },
    actor
  );
  domain.addDocument(
    db,
    {
      type: 'INVOICE',
      number: 'INV-2026-100',
      shipmentId: ship.id,
      fileName: 'invoice.txt',
    },
    actor
  );
  domain.addDocument(
    db,
    {
      type: 'PACKING_LIST',
      number: 'PL-2026-100',
      shipmentId: ship.id,
      fileName: 'packing_list.txt',
    },
    actor
  );
  domain.addDocument(
    db,
    {
      type: 'COO',
      number: 'COO-IN-2026-88',
      shipmentId: ship.id,
      fileName: 'coo.txt',
    },
    actor
  );

  const locked = domain.shipLock(db, ship.id, actor);
  domain.markShipped(db, ship.id, actor);

  const tlcOpen = domain.createTlc(
    db,
    {
      primarySiteId: siteA.id,
      program: 'conventional',
      grade: 'small',
      productDescription: productName,
      code: 'TLC-G-2026-0043',
    },
    actor
  );
  domain.allocateHarvest(db, tlcOpen.id, { harvestId: hA.id, quantityKg: 200 }, actor);
  domain.addCase(db, tlcOpen.id, { netKg: 10 }, actor);
  domain.addCase(db, tlcOpen.id, { netKg: 10 }, actor);

  store.save(db);
  const result = {
    shippedTlc: tlcReady.code,
    openTlc: tlcOpen.code,
    shipment: ship.code,
    packFolder: locked.pack.folderName,
    caseExample: db.cases.find((c) => c.tlcId === tlcReady.id)?.code,
    note: 'Sample dataset loaded via domain functions. EU_STRICT ship lock succeeded with complete documents. Open TLC has no pack lock yet.',
  };
  return { db, result };
}

function productNamesFromOpsOrDefault() {
  try {
    const ghStore = require('../store');
    const ops = ghStore.load();
    const name = (ops.greenhouses || []).map((g) => (g.plantType || '').trim()).find(Boolean);
    if (name) return name;
  } catch {
    /* ignore */
  }
  return 'Ginger';
}

function runSeedCli() {
  const { result } = seedFresh();
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { seedFresh, runSeedCli };

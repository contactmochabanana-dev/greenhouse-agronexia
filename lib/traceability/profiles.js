/**
 * Destination gate profiles for fresh ginger export.
 * photo gates only apply when meta.photoGatesEnabled is true.
 */

const GATE_CATALOG = {
  G_SITE: 'TLC has exactly one primary production site',
  G_SITE_REG: 'Site registration / official fields filled',
  G_GENEALOGY: 'Harvest allocations match TLC site',
  G_PACK_LOCK: 'Pack lock done',
  G_MASS_BAL: 'Mass balance within tolerance',
  G_LABEL: 'At least one case under TLC with system label',
  G_PHOTO_CASE: 'Accepted labeled-case photos (when photo gates on)',
  G_PHOTO_LOAD: 'Accepted load photos (when photo gates on)',
  G_MRL: 'MRL lab pass linked',
  G_RALSTONIA: 'Ralstonia molecular test pass linked',
  G_PHYTO: 'Phytosanitary cert with number + fields + file',
  G_PATHWAY: 'Pest pathway mode set',
  G_GAP: 'GLOBALG.A.P. cert valid',
  G_ORGANIC: 'Organic cert valid when TLC is organic',
  G_COMMERCIAL: 'Invoice + packing list on shipment',
  G_TRANSPORT: 'BOL/AWB + conveyance id',
  G_COO: 'Certificate of origin present',
  G_HOLD: 'Not on hold',
};

const PROFILES = {
  EU_STRICT: {
    id: 'EU_STRICT',
    label: 'EU strict (retail / supermarket path)',
    markets: 'European Union',
    product: 'Fresh ginger rhizome',
    tlcGates: [
      'G_SITE',
      'G_SITE_REG',
      'G_GENEALOGY',
      'G_PACK_LOCK',
      'G_MASS_BAL',
      'G_LABEL',
      'G_PHOTO_CASE',
      'G_MRL',
      'G_RALSTONIA',
      'G_GAP',
      'G_ORGANIC',
      'G_HOLD',
    ],
    shipmentGates: [
      'G_PHYTO',
      'G_PATHWAY',
      'G_PHOTO_LOAD',
      'G_COMMERCIAL',
      'G_TRANSPORT',
      'G_COO',
      'G_HOLD',
    ],
  },
  EU_BASIC: {
    id: 'EU_BASIC',
    label: 'EU basic (legal-oriented importer)',
    markets: 'European Union',
    product: 'Fresh ginger rhizome',
    tlcGates: [
      'G_SITE',
      'G_SITE_REG',
      'G_GENEALOGY',
      'G_PACK_LOCK',
      'G_MASS_BAL',
      'G_LABEL',
      'G_MRL',
      'G_RALSTONIA',
      'G_ORGANIC',
      'G_HOLD',
    ],
    shipmentGates: [
      'G_PHYTO',
      'G_PATHWAY',
      'G_COMMERCIAL',
      'G_TRANSPORT',
      'G_HOLD',
    ],
  },
  US_STANDARD: {
    id: 'US_STANDARD',
    label: 'US standard (buyer / import path)',
    markets: 'United States',
    product: 'Fresh ginger rhizome',
    tlcGates: [
      'G_SITE',
      'G_GENEALOGY',
      'G_PACK_LOCK',
      'G_MASS_BAL',
      'G_LABEL',
      'G_MRL',
      'G_ORGANIC',
      'G_HOLD',
    ],
    shipmentGates: ['G_COMMERCIAL', 'G_TRANSPORT', 'G_COO', 'G_HOLD'],
  },
  GCC_PREMIUM: {
    id: 'GCC_PREMIUM',
    label: 'GCC premium retail',
    markets: 'GCC (e.g. UAE / KSA retail)',
    product: 'Fresh ginger rhizome',
    tlcGates: [
      'G_SITE',
      'G_GENEALOGY',
      'G_PACK_LOCK',
      'G_MASS_BAL',
      'G_LABEL',
      'G_MRL',
      'G_GAP',
      'G_ORGANIC',
      'G_HOLD',
    ],
    shipmentGates: ['G_PHYTO', 'G_COMMERCIAL', 'G_TRANSPORT', 'G_HOLD'],
  },
  DEFAULT_EXPORT: {
    id: 'DEFAULT_EXPORT',
    label: 'Default export (minimum bar)',
    markets: 'Unspecified / new market',
    product: 'Fresh ginger rhizome',
    tlcGates: [
      'G_SITE',
      'G_GENEALOGY',
      'G_PACK_LOCK',
      'G_LABEL',
      'G_HOLD',
    ],
    shipmentGates: ['G_COMMERCIAL', 'G_TRANSPORT', 'G_HOLD'],
  },
};

function listProfiles() {
  return Object.values(PROFILES);
}

function getProfile(id) {
  return PROFILES[id] || null;
}

/**
 * Destination markets for the Papers checklist (farmer-facing).
 * Multiple can be selected; requirements are the union.
 */
const EXPORT_DESTINATIONS = {
  EU: {
    id: 'EU',
    label: 'European Union',
    shortLabel: 'EU',
    profileId: 'EU_STRICT',
    countryHints: ['NL', 'DE', 'FR', 'IT', 'ES', 'BE', 'PL', 'AT'],
  },
  US: {
    id: 'US',
    label: 'United States',
    shortLabel: 'USA',
    profileId: 'US_STANDARD',
    countryHints: ['US'],
  },
  GCC: {
    id: 'GCC',
    label: 'Gulf (UAE, Saudi Arabia, etc.)',
    shortLabel: 'Gulf',
    profileId: 'GCC_PREMIUM',
    countryHints: ['AE', 'SA', 'QA', 'KW', 'BH', 'OM'],
  },
  OTHER: {
    id: 'OTHER',
    label: 'Other country',
    shortLabel: 'Other',
    profileId: 'DEFAULT_EXPORT',
    countryHints: [],
  },
};

/** Paper types with human labels and how they are stored. */
const PAPER_CATALOG = {
  MRL_LAB: {
    key: 'MRL_LAB',
    kind: 'document',
    type: 'MRL_LAB',
    title: 'Residue / pesticide lab report',
    help: 'Lab paper showing the crop passed residue limits.',
    needsResult: true,
    link: 'lot',
  },
  RALSTONIA_LAB: {
    key: 'RALSTONIA_LAB',
    kind: 'document',
    type: 'RALSTONIA_LAB',
    title: 'Plant health lab test (bacterial wilt / Ralstonia)',
    help: 'Often needed for EU ginger rhizomes.',
    needsResult: true,
    link: 'lot_or_site',
  },
  GAP_CERT: {
    key: 'GAP_CERT',
    kind: 'certification',
    scheme: 'GLOBALG.A.P.',
    title: 'Farm certificate (GLOBALG.A.P.)',
    help: 'Valid farm assurance certificate for the product.',
    needsValidity: true,
  },
  PHYTO: {
    key: 'PHYTO',
    kind: 'document',
    type: 'PHYTO',
    title: 'Phytosanitary certificate',
    help: 'Government plant health certificate for the shipment.',
    needsNumber: true,
    needsAd: true,
    link: 'shipment',
  },
  INVOICE: {
    key: 'INVOICE',
    kind: 'document',
    type: 'INVOICE',
    title: 'Commercial invoice',
    help: 'Invoice for the buyer.',
    link: 'shipment',
  },
  PACKING_LIST: {
    key: 'PACKING_LIST',
    kind: 'document',
    type: 'PACKING_LIST',
    title: 'Packing list',
    help: 'List of boxes and weights on the load.',
    link: 'shipment',
  },
  COO: {
    key: 'COO',
    kind: 'document',
    type: 'COO',
    title: 'Certificate of origin',
    help: 'Paper stating the country of origin.',
    link: 'shipment',
  },
};

/** Which papers each destination needs (union when multi-select). */
const DEST_PAPERS = {
  EU: ['MRL_LAB', 'RALSTONIA_LAB', 'GAP_CERT', 'PHYTO', 'INVOICE', 'PACKING_LIST', 'COO'],
  US: ['MRL_LAB', 'INVOICE', 'PACKING_LIST', 'COO'],
  GCC: ['MRL_LAB', 'GAP_CERT', 'PHYTO', 'INVOICE', 'PACKING_LIST'],
  OTHER: ['INVOICE', 'PACKING_LIST'],
};

function listExportDestinations() {
  return Object.values(EXPORT_DESTINATIONS);
}

/**
 * @param {string[]} destinationIds e.g. ['EU','US']
 * @returns {{ destinations, papers: Array<paper catalog + requiredFor> }}
 */
function papersRequiredForDestinations(destinationIds) {
  const ids = (destinationIds || []).filter((id) => EXPORT_DESTINATIONS[id]);
  const unique = [...new Set(ids)];
  const paperKeys = new Set();
  const requiredFor = {};
  for (const destId of unique) {
    for (const key of DEST_PAPERS[destId] || []) {
      paperKeys.add(key);
      if (!requiredFor[key]) requiredFor[key] = [];
      requiredFor[key].push(EXPORT_DESTINATIONS[destId].shortLabel);
    }
  }
  const papers = [...paperKeys].map((key) => ({
    ...PAPER_CATALOG[key],
    requiredFor: requiredFor[key] || [],
  }));
  return {
    destinations: unique.map((id) => EXPORT_DESTINATIONS[id]),
    papers,
  };
}

module.exports = {
  GATE_CATALOG,
  PROFILES,
  listProfiles,
  getProfile,
  EXPORT_DESTINATIONS,
  PAPER_CATALOG,
  DEST_PAPERS,
  listExportDestinations,
  papersRequiredForDestinations,
};

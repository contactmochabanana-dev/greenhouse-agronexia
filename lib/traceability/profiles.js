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

module.exports = { GATE_CATALOG, PROFILES, listProfiles, getProfile };

'use strict';

const { comparisonKey, normalizeDialValue, uniqueCatalogDials } = require('./dial-normalization.cjs');

function classifyResearchEligibility(row, catalog) {
  const price = Number(row?.price_usd);
  if (!row?.brand || String(row.brand).trim().toUpperCase() === 'UNKNOWN') return 'MISSING_BRAND';
  if (!row?.reference) return 'MISSING_REFERENCE';
  if (!catalog?.found || !catalog.model) return 'CATALOG_MODEL_UNCONFIRMED';
  if (!Number.isFinite(price) || price <= 0) return 'MISSING_PRICE';

  const dial = normalizeDialValue(row?.dial_color);
  if (!dial.known) return 'MISSING_DIAL';
  const catalogDials = uniqueCatalogDials(catalog.dialColors || []);
  if (!catalogDials.length) return 'CATALOG_DIAL_UNCONFIRMED';
  const dialKey = comparisonKey(dial.value);
  const equivalentKeys = new Set([dialKey]);
  // Catalog imports often describe a white-metallic/panda dial as Silver,
  // while dealer listings call the same configuration White. Keep this narrow;
  // market-significant colors such as Purple, Tiffany, Salmon, etc. never alias.
  if (dialKey === 'WHITE') equivalentKeys.add('SILVER');
  if (dialKey === 'SILVER') equivalentKeys.add('WHITE');
  if (!catalogDials.some(value => equivalentKeys.has(comparisonKey(value)))) {
    return 'CATALOG_DIAL_MISMATCH';
  }
  return null;
}

function classifyDemandEligibility(row, catalog) {
  return classifyResearchEligibility({ ...row, price_usd: 1 }, catalog);
}

module.exports = { classifyDemandEligibility, classifyResearchEligibility };

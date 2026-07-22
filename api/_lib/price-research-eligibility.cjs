'use strict';

const { comparisonKey, normalizeDialValue, uniqueCatalogDials } = require('./dial-normalization.cjs');
const { isReferencePriceCollision } = require('./trading-record-safety.cjs');

function classifyResearchEligibility(row, catalog) {
  const price = Number(row?.price_usd);
  if (Number(row?.bundle_candidate_count || 0) > 1) return 'BUNDLE_SOURCE_UNSPLIT';
  if (!row?.brand || String(row.brand).trim().toUpperCase() === 'UNKNOWN') return 'MISSING_BRAND';
  if (!row?.reference) return 'MISSING_REFERENCE';
  if (!catalog?.found || !catalog.model) return 'CATALOG_MODEL_UNCONFIRMED';
  if (!Number.isFinite(price) || price <= 0) return 'MISSING_PRICE';
  if (row?.analytics_currency_status && row.analytics_currency_status !== 'VERIFIED') return row.analytics_currency_status;
  if (isReferencePriceCollision(row)) return 'REFERENCE_TOKEN_AS_PRICE';

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
  return classifyResearchEligibility({ ...row, price_raw: null, price_usd: 1 }, catalog);
}

module.exports = { classifyDemandEligibility, classifyResearchEligibility };

'use strict';

const { lookupCatalog, normalizeRef } = require('./catalog.js');
const { comparisonKey, normalizeDialValue, uniqueCatalogDials } = require('./dial-normalization.cjs');

function normalizeBrand(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function equivalentDialKeys(value) {
  const key = comparisonKey(value);
  const keys = new Set([key]);
  if (key === 'WHITE') keys.add('SILVER');
  if (key === 'SILVER') keys.add('WHITE');
  return keys;
}

function confirmCatalogCandidate(candidate) {
  if (!candidate?.reference) {
    return { confirmed: false, reason: 'CATALOG_IDENTITY_INCOMPLETE', match: null };
  }

  let match = lookupCatalog(candidate.reference, candidate.brand || null);
  if (!match.found && candidate.brand) {
    const unqualified = lookupCatalog(candidate.reference);
    if (unqualified.found && unqualified.brand
      && normalizeBrand(unqualified.brand) !== normalizeBrand(candidate.brand)) {
      match = unqualified;
    }
  }
  if (!match.found) return { confirmed: false, reason: 'CATALOG_NOT_FOUND', match };
  if (!['exact', 'exact_alias', 'collapsed'].includes(match.matchType)) {
    return { confirmed: false, reason: 'CATALOG_PARTIAL_MATCH', match };
  }
  if (match.brand && candidate.brand && normalizeBrand(match.brand) !== normalizeBrand(candidate.brand)) {
    return { confirmed: false, reason: 'CATALOG_BRAND_CONFLICT', match };
  }

  const proposedDial = normalizeDialValue(candidate.dial_color);
  const catalogDials = uniqueCatalogDials(match.dialColors || []);
  let dialConfirmed = null;
  let dialReason = null;
  if (proposedDial.known) {
    const equivalent = equivalentDialKeys(proposedDial.value);
    dialConfirmed = catalogDials.some(value => equivalent.has(comparisonKey(value)));
    dialReason = dialConfirmed
      ? 'CATALOG_DIAL_CONFIRMED'
      : (catalogDials.length ? 'CATALOG_DIAL_CONFLICT' : 'CATALOG_DIAL_UNCONFIRMED');
  }

  return {
    confirmed: true,
    reason: 'CATALOG_CONFIRMED',
    dialConfirmed,
    dialReason,
    match: {
      reference: normalizeRef(match.matchedRef || candidate.reference),
      brand: match.brand || candidate.brand,
      source: match.source,
      matchType: match.matchType,
      collection: match.collection || null,
      model: match.model || null,
      dialColors: catalogDials,
    },
  };
}

module.exports = { confirmCatalogCandidate };

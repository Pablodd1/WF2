'use strict';

const { lookupCatalog, normalizeRef } = require('../../api/_lib/catalog.js');

function normalizeBrand(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function confirmCatalogCandidate(candidate) {
  if (!candidate?.reference) {
    return { confirmed: false, reason: 'CATALOG_IDENTITY_INCOMPLETE', match: null };
  }

  const match = lookupCatalog(candidate.reference);
  if (!match.found) {
    return { confirmed: false, reason: 'CATALOG_NOT_FOUND', match };
  }
  if (!['exact', 'collapsed'].includes(match.matchType)) {
    return { confirmed: false, reason: 'CATALOG_PARTIAL_MATCH', match };
  }
  if (match.brand && candidate.brand && normalizeBrand(match.brand) !== normalizeBrand(candidate.brand)) {
    return { confirmed: false, reason: 'CATALOG_BRAND_CONFLICT', match };
  }

  return {
    confirmed: true,
    reason: 'CATALOG_CONFIRMED',
    match: {
      reference: normalizeRef(match.matchedRef || candidate.reference),
      brand: match.brand || candidate.brand,
      source: match.source,
      matchType: match.matchType,
      collection: match.collection || null,
      model: match.model || null,
    },
  };
}

module.exports = { confirmCatalogCandidate };

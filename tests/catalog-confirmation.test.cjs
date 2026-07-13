'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { confirmCatalogCandidate } = require('../tools/shadow-reprocess/catalog-confirmation.cjs');
const { buildPromotionDecision } = require('../tools/shadow-reprocess/promotion-policy.cjs');

test('confirms an exact catalog reference with matching brand', () => {
  const confirmation = confirmCatalogCandidate({ brand: 'Rolex', reference: '126610LN' });
  assert.equal(confirmation.confirmed, true);
  assert.equal(confirmation.match.brand, 'Rolex');
  assert.equal(confirmation.match.matchType, 'exact');
});

test('returns a review decision when catalog brand conflicts with candidate', () => {
  const candidate = {
    brand: 'Patek Philippe',
    reference: '126610LN',
    prices: [{ is_primary: true, amount_original: 114000, currency_original: 'HKD', currency_evidence: 'section_context' }],
  };
  const confirmation = confirmCatalogCandidate(candidate);
  const decision = buildPromotionDecision({
    source_listing_type: 'WTS', candidate_count: 1, proposed_candidates: [candidate], change_flags: [],
  }, confirmation);
  assert.equal(confirmation.confirmed, false);
  assert.equal(decision.disposition, 'HUMAN_REVIEW');
  assert.deepEqual(decision.reasons, ['CATALOG_BRAND_CONFLICT']);
});

test('returns reviewer approval readiness only after exact catalog confirmation', () => {
  const candidate = {
    brand: 'Cartier', reference: 'WSSA0039', prices: [],
  };
  const confirmation = confirmCatalogCandidate(candidate);
  const decision = buildPromotionDecision({
    source_listing_type: 'WTB', candidate_count: 1, proposed_candidates: [candidate], change_flags: [],
  }, confirmation);
  assert.equal(decision.disposition, 'READY_FOR_HUMAN_APPROVAL');
  assert.equal(decision.catalog.reference, 'WSSA0039');
});

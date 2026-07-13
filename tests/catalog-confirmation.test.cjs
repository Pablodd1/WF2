'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { confirmCatalogCandidate } = require('../tools/shadow-reprocess/catalog-confirmation.cjs');
const { buildPromotionDecision } = require('../tools/shadow-reprocess/promotion-policy.cjs');
const { lookupCatalog } = require('../api/_lib/catalog.js');

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

test('uses the local catalog source when an overlapping reference has an explicit brand', () => {
  const rolex = lookupCatalog('52508', 'Rolex');
  const piaget = lookupCatalog('52508', 'Piaget');
  assert.equal(rolex.found, true);
  assert.equal(rolex.brand, 'Rolex');
  assert.equal(piaget.found, true);
  assert.equal(piaget.brand, 'Piaget');
});

test('does not silently resolve an unbranded cross-brand reference', () => {
  const ambiguous = lookupCatalog('52508');
  assert.equal(ambiguous.found, false);
  assert.equal(ambiguous.matchType, 'ambiguous_reference');
  assert.ok(ambiguous.candidates.some(candidate => candidate.brand === 'Rolex'));
  assert.ok(ambiguous.candidates.some(candidate => candidate.brand === 'Piaget'));
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isApprovedInventoryRecord,
} = require('../api/reviewed-market-inventory.js');
const {
  isReleaseListingEligible,
} = require('../api/_lib/publication-references.cjs');

test('Trading Floor approval accepts both legacy percent and pipeline probability confidence', () => {
  assert.equal(isApprovedInventoryRecord({ verdict: 'APPROVED', confidence: 90 }), true);
  assert.equal(isApprovedInventoryRecord({ verdict: 'approved', confidence: 0.9 }), true);
  assert.equal(isApprovedInventoryRecord({ verdict: 'approved', confidence: 0.89 }), false);
});

test('Trading Floor excludes quarantined bundles without requiring a supplied price', () => {
  assert.equal(isApprovedInventoryRecord({ verdict: 'approved', confidence: 0.95, price_usd: null }), true);
  assert.equal(isApprovedInventoryRecord({
    verdict: 'approved', confidence: 0.95, listing_status: 'bundle_child_pending_review',
  }), false);
});

test('shared release gate normalizes pipeline confidence scale', () => {
  const record = {
    brand: 'Rolex', reference: '116610LN', verdict: 'approved', confidence: 0.9,
  };
  assert.equal(isReleaseListingEligible(record, 'Rolex::116610LN'), true);
  assert.equal(isReleaseListingEligible({ ...record, confidence: 0.89 }, 'Rolex::116610LN'), false);
});

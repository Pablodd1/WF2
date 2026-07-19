'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isPriceLike, sanitizeTradingRecord } = require('../api/_lib/trading-record-safety.cjs');

test('recognizes numeric and currency amounts as price-like values', () => {
  assert.equal(isPriceLike('9000.00'), true);
  assert.equal(isPriceLike('HKD 250K'), true);
  assert.equal(isPriceLike('$1,250,000'), true);
  assert.equal(isPriceLike('Ice Blue'), false);
});

test('withholds contaminated customer fields without dropping the listing', () => {
  const result = sanitizeTradingRecord({
    id: 'listing-1',
    brand: 'Rolex',
    reference: 'Rolex',
    dial_color: '9000.00',
    condition: 'Used',
    year: 2024,
    price_usd: 16610,
  });

  assert.equal(result.id, 'listing-1');
  assert.equal(result.reference, null);
  assert.equal(result.dial_color, null);
  assert.equal(result.condition, 'Used');
  assert.equal(result.price_usd, 16610);
  assert.equal(result.data_quality_review_required, true);
  assert.deepEqual(result.data_quality_issues, ['REFERENCE_EQUALS_BRAND', 'DIAL_PRICE_CONTAMINATION']);
});

test('keeps plausible normalized watch data unchanged', () => {
  const result = sanitizeTradingRecord({
    brand: 'Patek Philippe',
    reference: '5712/1A',
    dial_color: 'Blue',
    condition: 'Used',
    year: 2022,
    price_usd: 118000,
  });

  assert.equal(result.reference, '5712/1A');
  assert.equal(result.dial_color, 'Blue');
  assert.equal(result.data_quality_review_required, false);
  assert.deepEqual(result.data_quality_issues, []);
});

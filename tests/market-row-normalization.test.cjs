'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMarketRow } = require('../api/_lib/market-row-normalization.cjs');

test('repairs HKD stored as USD using the exact reference line', () => {
  const result = normalizeMarketRow({ price_usd: 325000, raw_message: '52506 Ice Blue - HKD 325k\n52508 Black - HKD 296k' }, '52506');
  assert.equal(result.analytics_price_usd, 41667);
  assert.equal(result.price_normalization, 'EXPLICIT_HKD_FROM_REFERENCE_LINE');
});

test('prefers an explicit USD equivalent on the exact reference line', () => {
  const result = normalizeMarketRow({ price_usd: 313000, raw_message: 'New 52506 N5 Hkd313K Usdt40.5K' }, '52506');
  assert.equal(result.analytics_price_usd, 40500);
  assert.equal(result.price_normalization, 'EXPLICIT_USD_FROM_REFERENCE_LINE');
});

test('does not borrow a price from a different reference in the bundle', () => {
  const result = normalizeMarketRow({ price_usd: 26000, raw_message: '52506 Ice Blue price on request\n52508 Black HKD 296k' }, '52506');
  assert.equal(result.analytics_price_usd, 26000);
  assert.equal(result.price_normalization, null);
});

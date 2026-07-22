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

test('uses the claimed reference when catalog normalization adds a variant suffix', () => {
  const result = normalizeMarketRow(
    { price_usd: 871000, raw_message: '5167a 2023 HKD543k\n5712/1A blue 2020 HKD871k\n5961r 2022 HKD980k' },
    ['5712/1A', '5712/1A-001'],
  );
  assert.equal(result.analytics_price_usd, 111667);
  assert.equal(result.price_normalization, 'EXPLICIT_HKD_FROM_REFERENCE_LINE');
});

test('reads an explicit USD equivalent from the short multiline listing block', () => {
  const result = normalizeMarketRow(
    { price_usd: 1305000, raw_message: '5712/1A blue\n2024 Full set\nNew Buckle\nHKD 1.305m\nusdt 168k' },
    ['5712/1A', '5712/1A-001'],
  );
  assert.equal(result.analytics_price_usd, 168000);
  assert.equal(result.price_normalization, 'EXPLICIT_USD_FROM_REFERENCE_LINE');
});

test('detects CNY values and prefers explicit yuan pricing when present', () => {
  const result = normalizeMarketRow(
    { price_usd: 90000, raw_message: '116500LN Gold dial\n¥ 1,000,000\nUSDT 18,000' },
    '116500LN',
  );
  assert.equal(result.analytics_price_usd, 18000);
  assert.equal(result.price_normalization, 'EXPLICIT_USD_FROM_REFERENCE_LINE');
});

test('repairs mixed-currency rows in one pass via EUR and GBP', () => {
  const row = normalizeMarketRow(
    { price_usd: 11000, raw_message: '1908 52506 New / used 1908 18\n1908 Gold Plate EUR 8,200\nGMT-Special GBP 8,000' },
    '1908',
  );
  assert.equal(row.analytics_price_usd, 8856);
  assert.equal(row.price_normalization, 'EXPLICIT_EUR_FROM_REFERENCE_LINE');
});

test('converts SGD and CNY when they appear on the reference line', () => {
  const row = normalizeMarketRow(
    { price_usd: 70000, raw_message: '5712/1R silver dial\n5712/1R - S$ 98,000' },
    '5712/1R',
  );
  assert.equal(row.analytics_price_usd, 72520);
  assert.equal(row.price_normalization, 'EXPLICIT_SGD_FROM_REFERENCE_LINE');
});

test('inherits HKD context for a bare dollar amount in a Hong Kong inventory section', () => {
  const row = normalizeMarketRow(
    { price_usd: 283000, raw_message: 'Brand New Rolex\nHKD ~ Without Box\n126500 White N5/26 $283000' },
    '126500',
  );
  assert.equal(row.analytics_price_usd, 36282);
  assert.equal(row.price_normalization, 'EXPLICIT_HKD_FROM_REFERENCE_LINE');
});

test('does not silently treat an unqualified bare dollar amount as USD', () => {
  const row = normalizeMarketRow(
    { price_usd: 283000, raw_message: '126500 White N5/26 $283000' },
    '126500',
  );
  assert.equal(row.analytics_price_usd, 283000);
  assert.equal(row.price_normalization, null);
});

test('recognizes the common HDK typo as Hong Kong dollars', () => {
  const row = normalizeMarketRow(
    { price_usd: 380000, raw_message: '4200H/222A-B934 new HDK 380K' },
    '4200H/222A-B934',
  );
  assert.equal(row.analytics_price_usd, 48718);
  assert.equal(row.price_normalization, 'EXPLICIT_HKD_FROM_REFERENCE_LINE');
});

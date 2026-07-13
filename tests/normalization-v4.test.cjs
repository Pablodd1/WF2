'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  extractPriceObservations,
  inferBrandFromReference,
  parseNumber,
  segmentDealerMessage,
} = require('../api/_lib/normalization-v4.cjs');

test('inherits HKD for bare dollar prices under an HKD section', () => {
  const candidates = segmentDealerMessage(`
Brand New Rolex
HKD ~ Without Box
126500 White N5/26 $283000
126610LN N6/26 $114000
  `);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].context.brand_context, 'Rolex');
  assert.equal(candidates[0].context.currency_context, 'HKD');
  assert.equal(candidates[0].prices[0].currency_original, 'HKD');
  assert.equal(candidates[0].prices[0].amount_original, 283000);
});

test('does not assume USD for a bare dollar sign without context', () => {
  assert.deepEqual(extractPriceObservations('126500 White $283000', {}), []);
});

test('parses Chinese HKD labels and ten-thousand multipliers without a USD fallback', () => {
  const prices = extractPriceObservations('220\u4e07\u6e2f\u5e01');
  assert.equal(prices.length, 1);
  assert.equal(prices[0].amount_original, 2_200_000);
  assert.equal(prices[0].currency_original, 'HKD');
  assert.equal(prices[0].currency_evidence, 'explicit_line_currency');
});

test('inherits Chinese HKD section context for bare dollar prices', () => {
  const candidates = segmentDealerMessage('\u6e2f\u5e01\n126500 White N5/26 $283000');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].context.currency_context, 'HKD');
  assert.equal(candidates[0].prices[0].currency_original, 'HKD');
  assert.equal(candidates[0].prices[0].amount_original, 283_000);
});

test('preserves explicit HKD and USD equivalents', () => {
  const prices = extractPriceObservations('105,000HK$/13,500US$');
  assert.deepEqual(prices.map(price => [price.amount_original, price.currency_original]), [
    [105000, 'HKD'],
    [13500, 'USD'],
  ]);
});

test('selects the explicit discounted asking price and retains retail metadata', () => {
  const prices = extractPriceObservations('86,800 -30% = 60,760HK$');
  assert.equal(prices[0].amount_original, 60760);
  assert.equal(prices[0].currency_original, 'HKD');
  assert.equal(prices[0].retail_price, 86800);
  assert.equal(prices[0].discount_percent, 30);
});

test('repairs malformed thousands separators', () => {
  assert.equal(parseNumber('2.070,000'), 2070000);
  assert.equal(parseNumber('1.58', 'm'), 1580000);
});

test('splits inventory bundles and carries brand context', () => {
  const candidates = segmentDealerMessage(`
_Rolex_
126539TBR 01/2026 New 1,168,000HK$/149,700US$
126515 Sundust 04/2025 New 368,000HK$/47,200US$
_PP_
5990/1R 7/2026 new full set hkd 2.54m
  `);

  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].context.brand_context, 'Rolex');
  assert.equal(candidates[2].context.brand_context, 'Patek Philippe');
  assert.equal(candidates[2].prices[0].amount_original, 2540000);
});

test('reference families override contradictory section context', () => {
  const candidates = segmentDealerMessage(`
_PP_
4300V/000R-B509 Used 2022 HKD 900000
  `);
  assert.equal(candidates[0].context.brand_context, 'Vacheron Constantin');
  assert.equal(inferBrandFromReference('4300V/000R-B509'), 'Vacheron Constantin');
});

test('splits a multi-watch Richard Mille message into candidates', () => {
  const candidates = segmentDealerMessage(`
RM New HKD
RM07-01 WG Snow Diamond N11/25 USDT 350k
RM67-01 RG N11/25 HKD 1.84m
RM35-03 blue N11/25 HKD 3.51m
  `);
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map(candidate => candidate.prices[0].currency_original), ['USDT', 'HKD', 'HKD']);
});

test('classifies looking-for listings as WTB without changing inventory defaults', () => {
  const wtb = segmentDealerMessage('Looking for 126500LN white dial');
  const wts = segmentDealerMessage('126610LN N6/26 HKD 114000');
  assert.equal(wtb[0].context.intent_context, 'WTB');
  assert.equal(wts[0].context.intent_context, 'WTS');
});

test('extracts all 13 watches from the Hong Kong inventory fixture', () => {
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'hong-kong-inventory.txt'), 'utf8');
  const candidates = segmentDealerMessage(fixture);
  assert.equal(candidates.length, 13);
  assert.equal(candidates[0].prices[0].amount_original, 380000);
  assert.equal(candidates[0].prices[0].currency_original, 'HKD');
  assert.equal(candidates[11].context.brand_context, 'Patek Philippe');
  assert.equal(candidates[12].context.brand_context, 'Rolex');
});

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

test('normalizes explicit HDK typo markers before and after the amount', () => {
  const prefix = extractPriceObservations('HDK 380K');
  const suffix = extractPriceObservations('380K HDK');
  for (const prices of [prefix, suffix]) {
    assert.equal(prices.length, 1);
    assert.equal(prices[0].amount_original, 380_000);
    assert.equal(prices[0].currency_original, 'HKD');
    assert.equal(prices[0].amount_usd, 48_718);
    assert.equal(prices[0].currency_evidence, 'explicit_line_currency');
  }
});

test('parses explicit mil, mill, and million multipliers on either side of HKD', () => {
  const cases = [
    ['HKD 380 mil', 380_000],
    ['380 mil HKD', 380_000],
    ['HKD 1.2 mill', 1_200_000],
    ['1.2 million HKD', 1_200_000],
  ];

  for (const [raw, expected] of cases) {
    const prices = extractPriceObservations(raw);
    assert.equal(prices.length, 1, raw);
    assert.equal(prices[0].amount_original, expected, raw);
    assert.equal(prices[0].currency_original, 'HKD', raw);
  }
});

test('does not assign a currency to a multiplier without explicit or inherited evidence', () => {
  assert.deepEqual(extractPriceObservations('380 mil'), []);
  assert.deepEqual(extractPriceObservations('1.2 million'), []);
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

test('extracts Patek four-digit suffix references without treating prices as references', () => {
  const candidates = segmentDealerMessage(`
Patek Philippe
5935A-001 48,000US$
5396G 255,000HK$
  `);
  assert.deepEqual(candidates.map(candidate => candidate.reference), ['5935A-001', '5396G']);
  assert.deepEqual(candidates.map(candidate => candidate.context.brand_context), ['Patek Philippe', 'Patek Philippe']);
});

test('does not create a phantom Rolex candidate from a six-digit price', () => {
  const candidates = segmentDealerMessage(`
Patek Philippe 5712/1A Tiffany
Full set price 195000 USD
  `);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].reference, '5712/1A');
  assert.equal(candidates[0].context.brand_context, 'Patek Philippe');
});

test('keeps a bare six-digit reference when the following price uses a separate dollar token', () => {
  const candidates = segmentDealerMessage('Rolex 126333 $14,500 plus label');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].reference, '126333');
  assert.equal(candidates[0].context.brand_context, 'Rolex');
  assert.deepEqual(candidates[0].prices, []);
});

test('recognizes Cartier and dotted Hublot reference formats', () => {
  const candidates = segmentDealerMessage(`
WTB WSSA0039 FULL SET 2026 ONLY UNDER 8k
485.ES.5171.RX.1204 - HKD 135300 - New 2025
  `);
  assert.deepEqual(candidates.map(candidate => candidate.reference), ['WSSA0039', '485.ES.5171.RX.1204']);
  assert.deepEqual(candidates.map(candidate => candidate.context.brand_context), ['Cartier', 'Hublot']);
  assert.equal(candidates[0].context.intent_context, 'WTB');
});

test('normalizes literal Excel carriage-return markers before segmenting references', () => {
  const candidates = segmentDealerMessage('Looking for stock_x000D_5968R_x000D_Need fresh date 2025+');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].reference, '5968R');
  assert.equal(candidates[0].context.brand_context, 'Patek Philippe');
  assert.equal(candidates[0].context.intent_context, 'WTB');
});

test('classifies Chinese WTB messages and inherited request context', () => {
  const direct = segmentDealerMessage('\u6c42\u8d2d 126500LN White HKD 280k');
  const inherited = segmentDealerMessage('\u6c42\u8cfc\n126610LN Black $114000');
  assert.equal(direct[0].context.intent_context, 'WTB');
  assert.equal(inherited[0].context.intent_context, 'WTB');
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

test('explicit listing condition overrides an inherited section condition', () => {
  const candidates = segmentDealerMessage(`Audemars Piguet Brand New
15202bc salmon 2019 used full set 855k hkd
15510ST black N11/2025 New 365k hkd`);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].context.condition_context, 'Used');
  assert.equal(candidates[1].context.condition_context, 'New');
});

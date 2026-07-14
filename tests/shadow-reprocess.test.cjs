'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeRecord } = require('../tools/shadow-reprocess/shadow-reprocess.cjs');

test('flags collapsed bundles without modifying the source record', () => {
  const source = {
    id: 'source-1',
    raw_message: 'RM07-01 New USDT 350k\nRM67-01 New HKD 1.84m',
    brand: 'Richard Mille', reference: 'RM07-01', currency: 'USDT',
    price_raw: 350000, listing_type: 'WTS', parser_version: 'v3.2',
  };
  const result = analyzeRecord(source);
  assert.equal(result.candidate_count, 2);
  assert.ok(result.change_flags.includes('BUNDLE_SPLIT_REQUIRED'));
  assert.equal(source.reference, 'RM07-01');
});

test('flags brand and reference corrections in shadow output', () => {
  const result = analyzeRecord({
    id: 'source-2', raw_message: '4300V/000R-B509 Used 2022 HKD 900k',
    brand: 'Patek Philippe', reference: '900000', currency: 'HKD',
    price_raw: 900000, listing_type: 'WTS', parser_version: 'v3.1',
  });
  assert.ok(result.change_flags.includes('BRAND_CHANGED'));
  assert.ok(result.change_flags.includes('REFERENCE_CHANGED'));
  assert.equal(result.proposed_candidates[0].brand, 'Vacheron Constantin');
});

test('routes ambiguous bare-dollar prices to shadow review instead of retaining USD', () => {
  const result = analyzeRecord({
    id: 'source-3',
    raw_message: '126500LN White $283000',
    brand: 'Rolex',
    reference: '126500LN',
    currency: null,
    price_raw: 283000,
    listing_type: 'WTS',
  });
  assert.ok(result.change_flags.includes('CURRENCY_AMBIGUOUS'));
  assert.ok(result.change_flags.includes('PRICE_PARSE_FAILED'));
  assert.equal(result.review_status, 'PENDING');
});

test('uses a structured source currency with the amount parsed from raw text', () => {
  const result = analyzeRecord({
    id: 'source-5',
    raw_message: '79833MN fabric 2022 fullset $16000',
    brand: 'Tudor',
    reference: '79833MN',
    currency: 'USD',
    price_raw: 160,
    price_usd: 160,
    listing_type: 'WTS',
  });
  const candidate = result.proposed_candidates[0];
  assert.equal(candidate.price_raw, 16000);
  assert.equal(candidate.price_usd, 16000);
  assert.equal(candidate.currency, 'USD');
  assert.equal(candidate.currency_evidence, 'source_record_currency');
  assert.ok(!result.change_flags.includes('CURRENCY_AMBIGUOUS'));
  assert.ok(result.change_flags.includes('PRICE_CHANGED'));
});

test('uses source HKD only as currency evidence for a bare-dollar text amount', () => {
  const result = analyzeRecord({
    id: 'source-6',
    raw_message: '126500 White N5/26 $283000',
    brand: 'Rolex',
    reference: '126500',
    currency: 'HKD',
    price_raw: 283000,
    price_usd: 36282,
    listing_type: 'WTS',
  });
  const candidate = result.proposed_candidates[0];
  assert.equal(candidate.price_raw, 283000);
  assert.equal(candidate.price_usd, 36282);
  assert.equal(candidate.currency, 'HKD');
  assert.equal(candidate.currency_evidence, 'source_record_currency');
  assert.ok(!result.change_flags.includes('CURRENCY_AMBIGUOUS'));
});

test('retains an existing structured source price when a marketplace title has no price text', () => {
  const result = analyzeRecord({
    id: 'source-4',
    raw_message: 'Rolex Yacht-Master 16628 18k Solid Yellow Gold Automatic Mens Watch 40mm',
    brand: 'Rolex',
    reference: '16628',
    currency: 'USD',
    price_raw: 18000,
    price_usd: 18000,
    listing_type: 'WTS',
  });
  assert.equal(result.proposed_candidates[0].price_raw, 18000);
  assert.equal(result.proposed_candidates[0].prices[0].currency_evidence, 'source_record');
  assert.ok(!result.change_flags.includes('PRICE_PARSE_FAILED'));
  assert.equal(result.review_status, 'NO_CHANGE');
});


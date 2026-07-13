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
    currency: 'USD',
    price_raw: 283000,
    listing_type: 'WTS',
  });
  assert.ok(result.change_flags.includes('CURRENCY_AMBIGUOUS'));
  assert.ok(!result.change_flags.includes('PRICE_PARSE_FAILED'));
  assert.equal(result.review_status, 'PENDING');
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


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


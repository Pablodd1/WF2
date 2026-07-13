'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildComparableCohorts, summarizePrices } = require('../api/_lib/market-stats.cjs');

test('uses standard 1.5 IQR fences and preserves outliers separately', () => {
  const result = summarizePrices([100, 101, 102, 103, 104, 105, 500]);
  assert.equal(result.stats.iqr, 3);
  assert.equal(result.stats.upper_fence, 109);
  assert.deepEqual(result.outliers, [500]);
  assert.equal(result.included.length, 6);
});

test('does not claim analytics readiness below five observations', () => {
  const result = summarizePrices([100, 110, 120, 1000]);
  assert.equal(result.analytics_ready, false);
  assert.equal(result.sample_quality, 'observational');
  assert.deepEqual(result.outliers, []);
});

test('labels five to nine rows provisional and ten or more robust', () => {
  assert.equal(summarizePrices([1, 2, 3, 4, 5]).sample_quality, 'provisional');
  assert.equal(summarizePrices([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).sample_quality, 'robust');
});

test('separates price cohorts by condition and dial', () => {
  const cohorts = buildComparableCohorts([
    { condition: 'New', dial_color: 'Blue' },
    { condition: 'New', dial_color: 'Blue' },
    { condition: 'Used', dial_color: 'Blue' },
    { condition: 'New', dial_color: 'Green' },
  ]);
  assert.equal(cohorts.length, 3);
  assert.equal(cohorts[0].condition, 'New');
  assert.equal(cohorts[0].dial_color, 'Blue');
  assert.equal(cohorts[0].count, 2);
});


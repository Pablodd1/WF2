'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateSourceRow } = require('../tools/price-quality/audit-source-price-cohorts.cjs');

test('source audit rejects an emoji-bullet parent before it can publish a price', () => {
  const result = evaluateSourceRow({
    brand: 'Patek Philippe', reference: '5712/1R', price_usd: 480000,
    raw_message: '🚀 5712/1R 5/2025 NEW HKD 1.73m 🚀 5303R 5/2025 NEW 1.05m usdt',
  });
  assert.equal(result.gate, 'BUNDLE_SOURCE_UNSPLIT');
  assert.equal(result.derived_price_usd, 221795);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyDemandEligibility, classifyResearchEligibility } = require('../api/_lib/price-research-eligibility.cjs');

const catalog = { found: true, model: 'Cosmograph Daytona', dialColors: ['Black', 'White'] };
const valid = { brand: 'Rolex', reference: '116500LN', dial_color: 'Black', price_usd: 25000 };

test('accepts a complete catalog-consistent WTS observation', () => {
  assert.equal(classifyResearchEligibility(valid, catalog), null);
});

test('rejects a dial that is impossible for the cataloged reference', () => {
  assert.equal(
    classifyResearchEligibility({ ...valid, dial_color: 'Purple' }, catalog),
    'CATALOG_DIAL_MISMATCH',
  );
});

test('accepts the narrow white and silver marketplace/catalog vocabulary equivalence', () => {
  assert.equal(
    classifyResearchEligibility({ ...valid, dial_color: 'White' }, { ...catalog, dialColors: ['Black', 'Silver'] }),
    null,
  );
});

test('accepts a matching dial from a scalar legacy catalog field', () => {
  assert.equal(
    classifyResearchEligibility(
      { brand: 'Patek Philippe', reference: '3712/1A', dial_color: 'Blue', price_usd: 120000 },
      { found: true, model: 'Nautilus Moon Phase', dialColors: 'Blue' },
    ),
    null,
  );
});

test('requires a catalog model, dial and price', () => {
  assert.equal(classifyResearchEligibility(valid, { found: true, model: null, dialColors: ['Black'] }), 'CATALOG_MODEL_UNCONFIRMED');
  assert.equal(classifyResearchEligibility({ ...valid, dial_color: 'Unknown' }, catalog), 'MISSING_DIAL');
  assert.equal(classifyResearchEligibility({ ...valid, price_usd: null }, catalog), 'MISSING_PRICE');
});

test('WTB demand requires identity and dial but not an asking price', () => {
  assert.equal(classifyDemandEligibility({ ...valid, price_usd: null }, catalog), null);
  assert.equal(classifyDemandEligibility({ ...valid, dial_color: 'Purple', price_usd: null }, catalog), 'CATALOG_DIAL_MISMATCH');
});

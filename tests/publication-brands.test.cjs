'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  isPublicationBrandAllowed,
  publicationBrandPostgrestFilter,
  publicationBrands,
} = require('../api/_lib/publication-brands.cjs');

test('two-brand release configuration is exact and case-insensitive', () => {
  const configured = 'Rolex|Patek Philippe';
  assert.deepEqual(publicationBrands(configured), ['Rolex', 'Patek Philippe']);
  assert.equal(isPublicationBrandAllowed('rolex', configured), true);
  assert.equal(isPublicationBrandAllowed('Patek Philippe', configured), true);
  assert.equal(isPublicationBrandAllowed('Audemars Piguet', configured), false);
  assert.equal(publicationBrandPostgrestFilter(configured), 'in.("Rolex","Patek Philippe")');
});

test('an unset release configuration preserves the full catalog', () => {
  assert.equal(isPublicationBrandAllowed('Audemars Piguet', ''), true);
  assert.equal(publicationBrandPostgrestFilter(''), null);
});

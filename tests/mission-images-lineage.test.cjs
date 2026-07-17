'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { basename, customerSafe, recordId, validReference } = require('../tools/mission-images/link-images-from-raw-lineage.cjs');

test('maps a raw source row to its imported watch record id', () => {
  assert.equal(recordId('auction_watches', 'abc-123'), 'mysql_auction_watches_abc-123');
});

test('normalizes storage filenames without changing identity', () => {
  assert.equal(basename('watchListings/full/67dcfd9b58d0b_front_image.jpg'), '67dcfd9b58d0b_front_image.jpg');
});

test('rejects years and unknown values as references', () => {
  assert.equal(validReference('2023Y'), false);
  assert.equal(validReference('Unknown'), false);
  assert.equal(validReference('5712/1A'), true);
});

test('only customer-safe watch rows qualify for the showcase', () => {
  assert.equal(customerSafe({ brand: 'Patek Philippe', reference: '5712/1A', listing_type: 'WTS', verdict: 'HUMAN' }), true);
  assert.equal(customerSafe({ brand: 'Unknown', reference: '2023Y', listing_type: 'WTS', verdict: 'HUMAN' }), false);
  assert.equal(customerSafe({ brand: 'Rolex', reference: '116500LN', listing_type: 'MULTI', verdict: 'HUMAN' }), false);
});

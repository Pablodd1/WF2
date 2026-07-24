'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { basename, customerSafe, customerSafeReasons, recordId, requestedBrandMatches, sourceIdentityAgrees, validReference } = require('../tools/mission-images/link-images-from-raw-lineage.cjs');

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
  const source = { brand: 'Patek Philippe', normalized_reference: '5712/1A' };
  assert.equal(customerSafe({ brand: 'Patek Philippe', reference: '5712/1A', listing_type: 'WTS', verdict: 'HUMAN', has_images: false, image_urls: [] }, source), true);
  assert.equal(customerSafe({ brand: 'Unknown', reference: '2023Y', listing_type: 'WTS', verdict: 'HUMAN' }, source), false);
  assert.equal(customerSafe({ brand: 'Rolex', reference: '116500LN', listing_type: 'MULTI', verdict: 'HUMAN' }, source), false);
  assert.equal(customerSafe({ brand: 'Patek Philippe', reference: '5712/1A', listing_type: 'WTS', verdict: 'HUMAN', has_images: true }, source), false);
  assert.deepEqual(customerSafeReasons(null, source), ['WATCH_RECORD_NOT_FOUND']);
  assert.deepEqual(
    customerSafeReasons({ brand: 'Rolex', reference: '116500LN', listing_type: 'MULTI', verdict: 'HUMAN', has_images: true }, source),
    ['SOURCE_IDENTITY_DISAGREES', 'ALREADY_HAS_IMAGES', 'DISALLOWED_LISTING_TYPE'],
  );
});

test('requires exact structured source brand and reference agreement', () => {
  const listing = { brand: 'Patek Philippe', reference: '5712/1A' };
  assert.equal(sourceIdentityAgrees(listing, { brand: 'Patek Philippe', normalized_reference: '5712-1A' }), true);
  assert.equal(sourceIdentityAgrees(listing, { brand: 'Patek Philippe', normalized_reference: '5712/1R' }), false);
  assert.equal(sourceIdentityAgrees(listing, { brand: 'Rolex', normalized_reference: '5712/1A' }), false);
  assert.equal(sourceIdentityAgrees(listing, {}), false);
});

test('does not constrain image lineage unless a brand filter is requested', () => {
  assert.equal(requestedBrandMatches('Patek Philippe'), true);
});

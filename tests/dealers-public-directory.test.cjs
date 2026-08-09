'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildSourceLinks, snapshotDirectory } = require('../api/dealers.js');

test('public directory does not require a dealer session', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'dealers.js'), 'utf8');
  assert.doesNotMatch(source, /authorizeDealer/);
  assert.match(source, /getClient/);
});

test('top-rated snapshot preserves all 25 source cards and their workflow links', () => {
  const result = snapshotDirectory('', 1, 25);
  assert.equal(result.total, 25);
  assert.equal(result.dealers.length, 25);
  const federico = result.dealers[0];
  assert.equal(federico.display_name, 'Federico Maman');
  assert.equal(federico.review_count, 22);
  assert.equal(federico.stats.wts_posts, 3);
  assert.equal(federico.stats.wtb_posts, 1);
  assert.equal(federico.source_links.reviews, 'https://watchfacts.com/user/916/profile#dealer-feedback-div');
  assert.equal(federico.source_links.wts, 'https://watchfacts.com/profile-listings?profileId=916&for=sale');
  assert.equal(federico.source_links.wtb, 'https://watchfacts.com/profile-listings?profileId=916&for=search');
  assert.equal(federico.source_links.whatsapp, 'https://wa.me/13059888263');
});

test('Reference Check snapshot supports case-insensitive name and phone search', () => {
  assert.equal(snapshotDirectory('JAZTIME', 1, 24).dealers[0].display_name, 'Jaztime Watches');
  assert.equal(snapshotDirectory('7869569201', 1, 24).total, 0);
  assert.equal(snapshotDirectory('3059888263', 1, 24).dealers[0].display_name, 'Federico Maman');
});

test('source links follow the original profile, feedback, WTS, WTB and WhatsApp routes', () => {
  const links = buildSourceLinks({ directory_url: 'https://watchfacts.com/user/3435/profile', directory_source_id: '3435' }, '+1 (714) 734-0511');
  assert.deepEqual(links, {
    profile: 'https://watchfacts.com/user/3435/profile',
    reviews: 'https://watchfacts.com/user/3435/profile#dealer-feedback-div',
    wts: 'https://watchfacts.com/profile-listings?profileId=3435&for=sale',
    wtb: 'https://watchfacts.com/profile-listings?profileId=3435&for=search',
    whatsapp: 'https://wa.me/17147340511',
  });
});

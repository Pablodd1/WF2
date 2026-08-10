'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { publicDealer } = require('../api/dealers.js');

test('public directory is database-only and does not require a dealer session', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'dealers.js'), 'utf8');
  assert.doesNotMatch(source, /authorizeDealer/);
  assert.match(source, /getClient/);
  assert.match(source, /\.eq\('status', 'VERIFIED'\)/);
  assert.doesNotMatch(source, /fullDirectoryCrawl|snapshotDirectory|watchfacts_top_rated|directory_url|source_links/i);
});

test('top rated is derived only from verified database ratings', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'dealers.js'), 'utf8');
  assert.match(source, /mode === 'top-rated'/);
  assert.match(source, /query = query\.not\('rating', 'is', null\)/);
  assert.doesNotMatch(source, /snapshotDirectory|watchfacts_top_rated_snapshot|watchfacts_top_rated_crawl/i);
});

test('verified phone is published only when the dealer consent flag is true', () => {
  const base = {
    id: 'dealer-1', display_name: 'Verified Dealer', contact_consent: false,
  };
  const privateResult = publicDealer(base, { wts_posts: 2 }, '+1 305 555 0101', 1);
  assert.equal(privateResult.verified_phone, null);
  assert.equal('contact_consent' in privateResult, false);

  const publicResult = publicDealer({ ...base, contact_consent: true }, null, '+1 305 555 0101', 1);
  assert.equal(publicResult.verified_phone, '+1 305 555 0101');
});

test('customer directory and profile pages contain no legacy source navigation', () => {
  const directory = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DealerDirectory.tsx'), 'utf8');
  const profile = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DealerProfile.tsx'), 'utf8');
  for (const source of [directory, profile]) {
    assert.doesNotMatch(source, /source_links|source_workflow|source_metrics|Source profile|WTS route|WTB route/);
  }
  assert.match(directory, /Full profile/);
  assert.match(profile, /Verified dealer/);
});

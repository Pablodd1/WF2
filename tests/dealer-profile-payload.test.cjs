'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildDealerStats } = require('../api/dealer-profile.js');

test('dealer profile exposes only approved activity metrics and verified contact', () => {
  const stats = buildDealerStats([
    { listing_type: 'WTS', listing_date: '2025-01-02T00:00:00Z' },
    { listing_type: 'WTB', listing_date: '2026-01-03T00:00:00Z' },
  ], { whatsapp_group_count: 4, contact_consent: true }, '+1 (786) 956-9201', {
    wts_posts: 40,
    wtb_posts: 3,
    first_post_at: '2020-01-01T00:00:00Z',
    last_post_at: '2026-08-07T00:00:00Z',
  });

  assert.deepEqual(stats, {
    wts_count: 40,
    wtb_count: 3,
    group_count: 4,
    first_post: '2020-01-01T00:00:00Z',
    latest_post: '2026-08-07T00:00:00Z',
    verified_contact_info: { phone: '+1 (786) 956-9201', verification_status: 'VERIFIED' },
  });
  assert.equal('total_posts' in stats, false);
  assert.equal('active_listings' in stats, false);
});

test('dealer profile keeps raw messages, currency, and normalized prices in its contract', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'dealer-profile.js'), 'utf8');
  assert.match(source, /price_usd,currency,raw_message/);
  assert.match(source, /raw_message_access: true/);
  assert.doesNotMatch(source, /WITHHELD_UNTIL_APPLIED_LINEAGE_AGGREGATE/);
  assert.doesNotMatch(source, /price_usd:\s*null/);
});

test('dealer profile rejects crawl-derived identities and loads verified database dealers only', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'dealer-profile.js'), 'utf8');
  assert.doesNotMatch(source, /fullDirectoryCrawl|sourceProfilePayload|watchfacts_directory_crawl|SOURCE_PUBLISHED/);
  assert.match(source, /dealer\.status !== 'VERIFIED'/);
  assert.match(source, /listing_identity_reviews/);
  assert.match(source, /seller_listing_lineage_staging/);
});

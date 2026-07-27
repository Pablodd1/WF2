'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  rawSupportsExactReference,
  validateDecisionBody,
} = require('../api/identity-review-decision.js');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('full-brand Trading Floor uses a service-only deduplicated keyset source', () => {
  const migration = read('supabase/migrations/20260727190000_full_rolex_patek_release.sql');
  const ingest = read('api/ingest.js');

  assert.match(migration, /CREATE OR REPLACE VIEW public\.two_brand_verified_trading_release/);
  assert.match(migration, /PARTITION BY repost_signature/);
  assert.match(migration, /ORDER BY has_images DESC, created_at DESC NULLS LAST, id DESC/);
  assert.match(migration, /w\.verdict = 'APPROVED'/);
  assert.match(migration, /w\.confidence >= 90/);
  assert.match(migration, /w\.price_usd >= 1000/);
  assert.match(migration, /public\.is_listing_duplicate_eligible\(w\.id\)/);
  assert.doesNotMatch(migration, /FROM public\.trading_floor_market_listings m/);
  assert.match(migration, /SET LOCAL lock_timeout = '30s'/);
  assert.match(migration, /r\.status IN \('CATALOG_CONFIRMED', 'HUMAN_APPROVED'\)/);
  assert.match(migration, /REVOKE ALL ON public\.two_brand_verified_trading_release[\s\S]*PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT ON public\.two_brand_verified_trading_release TO service_role/);
  assert.match(ingest, /isFullReviewedBrandRelease\(\)/);
  assert.match(ingest, /rest\/v1\/two_brand_verified_trading_release/);
  assert.match(ingest, /order: 'created_at\.desc\.nullslast,id\.desc'/);
  assert.match(ingest, /Range: `\$\{start\}-\$\{end\}`/);
  assert.match(ingest, /Prefer: 'count=exact'/);
});

test('identity review is signed, evidence-first, and leaves raw records immutable', () => {
  const migration = read('supabase/migrations/20260727190000_full_rolex_patek_release.sql');
  const queue = read('api/identity-review-queue.js');
  const decision = read('api/identity-review-decision.js');
  const ui = read('src/pages/ReviewQueue.tsx');

  assert.match(migration, /CREATE OR REPLACE VIEW public\.two_brand_identity_review_queue/);
  assert.match(migration, /COALESCE\(r\.status, 'UNVERIFIED'\) IN \('UNVERIFIED', 'CONFLICT'\)/);
  assert.match(migration, /READY_FOR_IDENTITY_REVIEW/);
  assert.match(migration, /MARKET_REVIEW_REQUIRED/);
  assert.match(queue, /authorizeDealer\(req, res, new Set\(\['reviewer', 'admin'\]\)\)/);
  assert.match(queue, /req\.query\?\.bucket \|\| 'release-ready'/);
  assert.match(queue, /\.eq\('review_disposition', reviewDisposition\)/);
  assert.match(decision, /sameOrigin\(req\)/);
  assert.match(decision, /review_disposition !== 'READY_FOR_IDENTITY_REVIEW'/);
  assert.match(decision, /rawSupportsExactReference/);
  assert.match(decision, /confirmCatalogCandidate\(canonical\)/);
  assert.match(decision, /\.rpc\('apply_listing_identity_review'/);
  assert.doesNotMatch(decision, /\.from\('watch_records'\)\.(?:update|upsert|insert|delete)/);
  assert.match(ui, /Rolex and Patek identity review/);
  assert.match(ui, /actionable identities where a signed identity decision is the final release blocker/);
  assert.match(ui, /Human approve identity/);
});

test('identity approval requires complete two-brand canonical evidence', () => {
  assert.equal(rawSupportsExactReference('Rolex 126500LN black dial', '126500LN'), true);
  assert.equal(rawSupportsExactReference('Patek 5712/1A only', '5712/1A-001'), false);

  assert.deepEqual(validateDecisionBody({
    recordId: 'record-1',
    decision: 'APPROVE',
    reason: 'Exact reference and dial are visible in the raw listing.',
    canonical: {
      brand: 'Rolex',
      model: 'Cosmograph Daytona',
      reference: '126500LN',
      dial_color: 'Black',
    },
  }).value?.canonical, {
    brand: 'Rolex',
    model: 'Cosmograph Daytona',
    reference: '126500LN',
    dial_color: 'Black',
  });
  assert.match(validateDecisionBody({
    recordId: 'record-2',
    decision: 'APPROVE',
    reason: 'Complete reviewer reason.',
    canonical: {
      brand: 'Audemars Piguet',
      model: 'Royal Oak',
      reference: '15500ST',
      dial_color: 'Blue',
    },
  }).error, /Rolex and Patek/);
});

test('CTO control center makes the full two-brand release authoritative', () => {
  const control = read('docs/CTO_CONTROL_CENTER.md');
  const release = read('docs/FULL_ROLEX_PATEK_RELEASE_2026-07-27.md');
  assert.match(control, /FULL_ROLEX_PATEK_RELEASE_2026-07-27\.md/);
  assert.match(release, /two_brand_verified_trading_release/);
  assert.match(release, /PUBLICATION_REFERENCES=ALL_REVIEWED/);
  assert.match(release, /no `watch_records` writes/);
});

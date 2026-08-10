'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'api', 'price-research.js'),
  'utf8',
);

test('high-volume Price Research uses one bounded strict-source query', () => {
  assert.match(source, /let sourceTable = !exactReviewedWorkbookRelease/);
  assert.match(source, /\? 'watch_records'\s*: 'price_research_verified_source'/);
  assert.match(source, /const buildRowsQuery = table => client\s*\.from\(table\)/);
  assert.match(source, /\.limit\(pageSize\)/);
  assert.match(source, /const sourceSampleCapped = usingReviewedWorkbook/);
  assert.match(source, /sampleCapped: sourceSampleCapped/);
  assert.doesNotMatch(source, /Array\.from\(\{ length: sampleLimit \/ pageSize \}/);
  assert.doesNotMatch(source, /buildRowsQuery\(from, from \+ pageSize - 1\)/);
});

test('verified workbook preload short-circuits redundant legacy lookups', () => {
  assert.match(source, /if \(exactReviewedWorkbookRelease\) \{/);
  assert.match(source, /preloadedReviewedWorkbookRows[\s\S]*\.map\(row => row\.reference\)/);
  assert.match(source, /else if \(preloadedReviewedWorkbookRows\.length\) \{[\s\S]*rows = preloadedReviewedWorkbookRows;/);
});

test('exact catalog references bypass legacy discovery without admitting prefixes', () => {
  assert.match(source, /requestedCatalogHit\.matchType !== 'partial'/);
  assert.match(source, /exactReviewedReleaseReference = isReviewedReleaseReference\(brand, rawRef\)/);
  assert.match(source, /!exactReviewedWorkbookRelease[\s\S]*exactKnownReference[\s\S]*directWatchRecordBrand[\s\S]*\? 'watch_records'/);
  assert.match(source, /else if \(exactKnownReference\) \{[\s\S]*targetRef = exactCatalogReference \? requestedCatalogHit\.reference : rawRef/);
});

test('legacy fallback remains bounded and WTB demand avoids the unindexed workbook lane', () => {
  assert.match(source, /sourceTable = 'watch_records';\s*result = await buildRowsQuery\(sourceTable\)/);
  assert.match(source, /lookupDemand\(\s*client,\s*'watch_records'/);
  assert.match(source, /selection,\s*null,\s*\)/);
  assert.match(source, /if \(Array\.isArray\(preloadedRows\)\)/);
  assert.doesNotMatch(source, /loadReviewedWorkbookDemandRows/);
  assert.doesNotMatch(source, /executeDemandLaneQuery/);
  assert.match(source, /const DEMAND_SAMPLE_LIMIT = 500/);
  assert.match(source, /loadVerifiedDemandIdentityRows\(client/);
  assert.match(source, /limit: DEMAND_SAMPLE_LIMIT/);
  assert.match(source, /const columns = 'id,brand,model,reference,[^']*listing_status'/);
  assert.doesNotMatch(source, /const columns = '[^']*(?:,phone_number,|,posted_by,|,display_image_url,|,image_url,)[^']*'/);
  assert.doesNotMatch(source, /retainVerifiedIdentityRows/);
  assert.doesNotMatch(source, /\.limit\(5000\)/);
  assert.doesNotMatch(source, /maxWtbCapacity/);
  assert.match(source, /const totalTrackedListings = wtsTrackedListings \+ wtbDemandCount/);
});

test('WTB demand has an exact-reference partial production index', () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260810054000_watch_records_wtb_reference_lookup.sql',
    ),
    'utf8',
  );
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
  assert.match(migration, /idx_watch_records_wtb_reference_lookup/);
  assert.match(migration, /ON public\.watch_records[\s\S]*brand,[\s\S]*reference,[\s\S]*id DESC/);
  assert.match(migration, /WHERE listing_type IN \('WTB', 'NTQ'\)/);
  assert.doesNotMatch(migration, /UPDATE|DELETE|TRUNCATE|DROP TABLE/i);
});

test('review-first WTB demand has an exact canonical-reference index', () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260810060000_listing_identity_wtb_reference_lookup.sql',
    ),
    'utf8',
  );
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
  assert.match(migration, /idx_listing_identity_wtb_reference_lookup/);
  assert.match(migration, /ON public\.listing_identity_reviews[\s\S]*canonical_brand,[\s\S]*canonical_reference,[\s\S]*record_id DESC/);
  assert.match(migration, /WHERE status IN \('CATALOG_CONFIRMED', 'HUMAN_APPROVED'\)/);
  assert.doesNotMatch(migration, /UPDATE|DELETE|TRUNCATE|DROP TABLE/i);
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  LEGACY_WORKBOOK_COLUMNS,
  isMissingColumnError,
  mapWorkbookAnalyticsRow,
} = require('../api/_lib/reviewed-workbook-analytics.cjs');

test('maps only supplied reviewed-workbook evidence into the analytics contract', () => {
  const row = mapWorkbookAnalyticsRow({
    id: 'row-1',
    source_file: 'reviewed.xlsx',
    source_row_number: 42,
    source_record_id: 'source-42',
    posting_date: '2026-07-01',
    raw_message: 'Patek 5712/1A blue USD 120000',
    listing_type: 'WTS',
    brand_scope: 'Patek Philippe',
    supplied_brand: 'Patek Philippe',
    model: 'Nautilus',
    normalized_reference: '5712/1A',
    dial_color: 'Blue',
    source_price_amount: 120000,
    source_currency: 'USD',
    verified_price_usd: 120000,
    has_verified_usd_price: true,
    has_exact_source_image: true,
    user_image_url: 'https://example.test/source.jpg',
  });

  assert.equal(row.brand, 'Patek Philippe');
  assert.equal(row.model, 'Nautilus');
  assert.equal(row.reference, '5712/1A');
  assert.equal(row.dial_color, 'Blue');
  assert.equal(row.price_usd, 120000);
  assert.equal(row.analytics_currency_status, 'VERIFIED');
  assert.equal(row.owner_reviewed_identity, true);
  assert.deepEqual(row.image_urls, ['https://example.test/source.jpg']);
});

test('never promotes an unverified workbook amount into USD analytics', () => {
  const row = mapWorkbookAnalyticsRow({
    id: 'row-unverified',
    brand_scope: 'Patek Philippe',
    model: 'Nautilus',
    normalized_reference: '5712',
    dial_color: 'Blue',
    workbook_price_usd: 100000,
    source_price_amount: 100000,
    source_currency: null,
    has_verified_usd_price: false,
    verified_price_usd: null,
    posted_by: 'Legacy Seller',
    phone_number: '+15551234567',
  });
  assert.equal(row.price_usd, null);
  assert.equal(row.analytics_currency_status, 'CURRENCY_UNVERIFIED');
  assert.equal(row.seller_name, 'Legacy Seller');
  assert.equal(row.seller_phone, '+15551234567');
});

test('requires the verified-price flag even when a USD value is populated', () => {
  const row = mapWorkbookAnalyticsRow({
    verified_price_usd: 120000,
    has_verified_usd_price: false,
  });
  assert.equal(row.price_usd, null);
  assert.equal(row.has_verified_usd_price, false);
  assert.equal(row.analytics_currency_status, 'CURRENCY_UNVERIFIED');
});

test('Price Research prefers verified reviewed-workbook cohorts and keeps legacy fallback', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research.js'), 'utf8');
  assert.match(source, /loadReviewedWorkbookAnalyticsRows/);
  assert.match(source, /const usingReviewedWorkbook = reviewedWorkbookRows\.length > 0/);
  assert.match(source, /const exactReviewedWorkbookRelease = preloadedReviewedWorkbookRows\.length > 0/);
  assert.match(source, /!exactReviewedWorkbookRelease && !isPublicationBrandAllowed\(brand\)/);
  assert.match(source, /!exactReviewedWorkbookRelease && !isPublicationReferenceAllowed\(brand, rawRef\)/);
  assert.match(source, /else if \(usingReviewedWorkbook\) \{\s*rows = reviewedWorkbookRows/);
  assert.match(source, /reviewed workbook analytics unavailable; using legacy cohort/);
  assert.match(source, /analytics_source: usingReviewedWorkbook/);
});

test('reviewed workbook loader requires complete identity and explicit verified USD', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'api', '_lib', 'reviewed-workbook-analytics.cjs'),
    'utf8',
  );
  assert.match(source, /eq\('has_complete_identity', true\)/);
  assert.match(source, /eq\('has_verified_usd_price', true\)/);
  assert.match(source, /eq\('listing_type', 'WTS'\)/);
  assert.doesNotMatch(source, /workbook_price_usd/);
  assert.match(source, /LEGACY_WORKBOOK_COLUMNS/);
  assert.match(source, /posted_by,phone_number/);
});

test('reviewed workbook demand loader keeps WTB separate from verified sales prices', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'api', '_lib', 'reviewed-workbook-analytics.cjs'),
    'utf8',
  );
  const demandStart = source.indexOf('async function executeDemandQuery');
  const demandEnd = source.indexOf('async function loadReviewedWorkbookAnalyticsRows');
  const demandSource = source.slice(demandStart, demandEnd);
  assert.ok(demandStart >= 0 && demandEnd > demandStart);
  assert.match(demandSource, /in\('listing_type', \['WTB', 'NTQ'\]\)/);
  assert.match(demandSource, /eq\('has_complete_identity', true\)/);
  assert.doesNotMatch(demandSource, /has_verified_usd_price/);
});

test('legacy column fallback is narrow and recognizes Postgres missing-column errors', () => {
  assert.match(LEGACY_WORKBOOK_COLUMNS, /posted_by,phone_number/);
  assert.doesNotMatch(LEGACY_WORKBOOK_COLUMNS, /seller_name|seller_phone|,verdict|listing_status/);
  assert.equal(isMissingColumnError({ code: '42703', message: 'column unavailable' }), true);
  assert.equal(isMissingColumnError({ code: 'PGRST204', message: 'column seller_name does not exist' }), true);
  assert.equal(isMissingColumnError({ code: 'PGRST301', message: 'permission denied' }), false);
});

test('Price Research listing detail supports the same reviewed workbook evidence', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research-listing.js'), 'utf8');
  assert.match(source, /loadReviewedWorkbookListing/);
  assert.match(source, /price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH'/);
  assert.match(source, /image_provenance: workbookListing\.has_images \? 'source_supplied' : 'none'/);
});

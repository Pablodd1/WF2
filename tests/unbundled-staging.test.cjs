'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { stagingRow } = require('../tools/multilisting/prepare-unbundled-staging.cjs');

test('creates a stable pending staging UUID while preserving the child audit key', () => {
  const source = {
    listing_id: 'source-parent_000', source_record_id: 'source-parent', child_index: 0,
    raw_line: '116500LN White 283K HKD', brand: 'Rolex', reference: '116500LN',
    dial_color: 'White', condition: 'New', price_raw: 283000, price_usd: 36282,
    price_currency: 'HKD', listing_type: 'WTS', parser_version: 'manual-unbundle-full-v4',
    review_bucket: 'review-ready', exact_raw_lineage: true, catalog_confirmed: true,
    catalog_dial_confirmed: true, blockers: [], review_reasons: [],
  };
  const lineage = { source_created_at: '2026-07-01T00:00:00Z' };
  const first = stagingRow(source, lineage, 'f94506b0-17a9-4656-9b51-9e81ed052ab8');
  const second = stagingRow(source, lineage, 'f94506b0-17a9-4656-9b51-9e81ed052ab8');
  assert.equal(first.id, second.id);
  assert.match(first.id, /^[0-9a-f-]{36}$/i);
  assert.equal(first.field_confidence.source_child_id, source.listing_id);
  assert.equal(first.verdict, 'PENDING');
  assert.equal(first.confidence, 0);
  assert.equal(first.has_images, false);
});

test('marks absent dealer attribution instead of inventing contact data', () => {
  const row = stagingRow({
    listing_id: 'source-parent_001', source_record_id: 'source-parent', child_index: 1,
    raw_line: 'WTB 5712/1A Blue', brand: 'Patek Philippe', reference: '5712/1A',
    listing_type: 'WTB', parser_version: 'manual-unbundle-full-v4', review_bucket: 'review-ready',
    exact_raw_lineage: true, catalog_confirmed: true, blockers: [], review_reasons: [],
  }, {}, 'f94506b0-17a9-4656-9b51-9e81ed052ab8');
  assert.ok(row.flags.includes('DEALER_ATTRIBUTION_MISSING'));
  assert.equal(row.field_confidence.seller_phone, null);
  assert.equal(row.field_confidence.dealer_id, null);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildChildLineageRow,
  childIntent,
  exactLineageReady,
  sellerConfigurationKey,
  sellerRepostKey,
  summarizeRepostClusters,
} = require('../tools/dealer-lineage/reconcile-child-lineage.cjs');

const child = {
  id: 'child-1',
  brand: 'Patek Philippe',
  reference: '5712/1A',
  dial_color: 'Blue',
  condition: 'Used',
  price_usd: 100000,
  currency: 'USD',
  listing_type: 'WTS',
  created_at: '2025-01-08T13:28:49+00:00',
  field_confidence: { source_record_id: 'parent-1', source_child_id: 'parent-1_001' },
};

const lineage = {
  source_system: 'UNBUNDLED_RAW_MESSAGE',
  source_record_id: 'parent-1',
  seller_listing_id: 'seller-row-1',
  seller_phone_normalized: '85260161840',
  observed_names: ['Verified only later'],
  source_intent: 'WTS',
  source_posted_at: '2025-01-08T18:28:49.000Z',
  source_posted_at_raw: 'Wed Jan 08 2025 13:28:49 GMT-0500',
  front_image: 'parent_front.jpg',
  match_status: 'A_AUTO_STAGE',
  match_evidence: {
    exact_raw_message_sha1: true,
    exact_wall_clock_second: true,
    unique_phone_identity: true,
    intent_agreement: true,
  },
};

test('recognizes only customer listing intents', () => {
  assert.equal(childIntent('WTS'), 'WTS');
  assert.equal(childIntent('NTQ'), 'WTB');
  assert.equal(childIntent('trade'), null);
});

test('requires every deterministic parent-lineage gate', () => {
  assert.equal(exactLineageReady(lineage), true);
  assert.equal(exactLineageReady({ ...lineage, match_status: 'B_REVIEW_REQUIRED' }), false);
  assert.equal(exactLineageReady({ ...lineage, match_evidence: { ...lineage.match_evidence, exact_raw_message_sha1: false } }), false);
  assert.equal(exactLineageReady({ ...lineage, source_posted_at: null }), false);
});

test('creates private observed identity without publishing dealer contact or images', () => {
  const result = buildChildLineageRow(child, lineage);
  assert.equal(result.source_posted_at, '2025-01-08T18:28:49.000Z');
  assert.equal(result.observed_seller.identity_value, '85260161840');
  assert.equal(result.observed_seller.verification_status, 'OBSERVED_SOURCE_IDENTITY');
  assert.equal(result.activity_count_eligible, true);
  assert.equal(result.dealer_id, null);
  assert.equal(result.public_contact_eligible, false);
  assert.equal(result.parent_front_image, 'parent_front.jpg');
  assert.equal(result.child_image_publication_eligible, false);
  assert.equal(result.publication_status, 'UNCHANGED');
  assert.equal(result.duplicate_suppression_status, 'NOT_EVALUATED_FOR_SUPPRESSION');
});

test('preserves identity but blocks activity counts when child and parent intent differ', () => {
  const result = buildChildLineageRow({ ...child, listing_type: 'WTB' }, lineage);
  assert.equal(result.observed_seller.identity_value, '85260161840');
  assert.equal(result.child_intent, 'WTB');
  assert.equal(result.source_parent_intent, 'WTS');
  assert.equal(result.activity_count_eligible, false);
  assert.ok(result.review_reasons.includes('CHILD_PARENT_INTENT_MISMATCH'));
});

test('rejects a child linked to a different parent', () => {
  assert.throws(() => buildChildLineageRow(child, { ...lineage, source_record_id: 'parent-2' }), /Parent lineage mismatch/);
});

test('seller-aware repost groups require the same observed seller and multiple parents', () => {
  const privateRow = buildChildLineageRow(child, lineage);
  const key = sellerRepostKey(child, privateRow);
  const groups = new Map([[key, {
    sellerIdentityPseudonym: privateRow.observed_seller.identity_pseudonym,
    listingFingerprint: privateRow.listing_fingerprint,
    count: 2,
    parentIds: new Set(['parent-1', 'parent-2']),
    childIds: ['child-1', 'child-2'],
    sourceDates: new Set(['2025-01-08T18:28:49.000Z', '2025-02-08T18:28:49.000Z']),
  }]]);
  const result = summarizeRepostClusters(groups);
  assert.equal(result.length, 1);
  assert.equal(result[0].parent_count, 2);
  assert.equal(result[0].policy, 'HUMAN_REPOST_REVIEW_REQUIRED');
});

test('configuration review groups ignore condition and price but retain seller and dial', () => {
  const privateRow = buildChildLineageRow(child, lineage);
  const changedConditionAndPrice = { ...child, condition: 'New', price_usd: 110000 };
  assert.equal(sellerConfigurationKey(child, privateRow), sellerConfigurationKey(changedConditionAndPrice, privateRow));
  assert.notEqual(
    sellerConfigurationKey(child, privateRow),
    sellerConfigurationKey({ ...child, dial_color: 'Black' }, privateRow),
  );
});

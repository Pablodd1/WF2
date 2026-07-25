'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { classifyIdentity } = require('../tools/data-quality/stage-identity-review.cjs');
const { auditImageRows } = require('../tools/data-quality/audit-image-backed-listings.cjs');
const { validateLedger } = require('../tools/data-quality/apply-image-review-canary.cjs');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260725023000_identity_image_publication_control.sql'),
  'utf8',
);

test('classifies confirmed, conflicting, and unknown identities without human approval', () => {
  assert.equal(classifyIdentity({
    id: 'patek',
    brand: 'Patek Philippe',
    reference: '5712/1A',
    dial_color: 'Blue',
  }).status, 'CATALOG_CONFIRMED');
  assert.equal(classifyIdentity({
    id: 'conflict',
    brand: 'Audemars Piguet',
    reference: 'RM 17-01',
    dial_color: 'Skeleton',
  }).status, 'CONFLICT');
  assert.equal(classifyIdentity({
    id: 'unknown',
    brand: 'Unknown',
    reference: 'NOT-IN-CATALOG',
  }).status, 'UNVERIFIED');
});

test('image audit rejects structural conflicts and leaves clean lineage for visual review', () => {
  const records = [
    { id: 'clean', brand: 'Patek Philippe', reference: '5712/1A', dial_color: 'Blue' },
    { id: 'wrong', brand: 'Audemars Piguet', reference: 'RM 17-01', dial_color: 'Skeleton' },
    { id: 'missing', brand: 'Rolex', reference: '116500LN', dial_color: 'White' },
  ];
  const manifest = [
    { source_object_key: 'a', public_url: 'https://img/a.jpg', matched_record_id: 'clean' },
    { source_object_key: 'b', public_url: 'https://img/b.jpg', matched_record_id: 'wrong' },
  ];
  const result = auditImageRows(records, manifest);
  assert.equal(result[0].image_status, 'VISUAL_REVIEW_REQUIRED');
  assert.match(result[1].issues, /CATALOG_BRAND_CONFLICT/);
  assert.match(result[2].issues, /MANIFEST_MISSING/);
});

test('image canary requires explicit reviewer evidence', () => {
  assert.throws(() => validateLedger([{
    source_object_key: 'a',
    record_id: '1',
    decision: 'VISUALLY_VERIFIED',
    operator_id: 'reviewer',
    reason: 'Compared against raw listing',
    evidence: {},
  }]), /human review evidence/);
  assert.doesNotThrow(() => validateLedger([{
    source_object_key: 'a',
    record_id: '1',
    decision: 'VISUALLY_VERIFIED',
    operator_id: 'reviewer',
    reason: 'Compared against raw listing',
    evidence: { visual_match: 'MATCH' },
  }]));
});

test('database control plane is private, fail closed, and bundle ordered', () => {
  assert.match(migration, /status IN \('UNVERIFIED', 'CATALOG_CONFIRMED', 'CONFLICT', 'HUMAN_APPROVED'\)/);
  assert.match(migration, /status IN \('SOURCE_LINKED', 'VISUALLY_VERIFIED', 'REJECTED'\)/);
  assert.match(migration, /WHERE public\.is_listing_identity_published\(m\.id\)/);
  assert.match(migration, /r\.status = 'VISUALLY_VERIFIED'/);
  assert.match(migration, /Split and review bundle children before duplicate suppression/);
  assert.match(migration, /status = 'HUMAN_APPROVED'[\s\S]*v_preserved := v_preserved \+ 1/);
  assert.match(migration, /REVOKE ALL ON public\.listing_identity_reviews FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /DELETE FROM public\.watch_records/);
});

test('production verified publication is an explicit rollout switch', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'ingest.js'), 'utf8');
  assert.match(source, /STRICT_VERIFIED_PUBLICATION === 'true'/);
  assert.match(source, /strictVerifiedPublication[\s\S]*trading_floor_verified_listings/);
});

test('dealer contact and profiles use verified identity and consent boundaries', () => {
  const contact = fs.readFileSync(path.join(__dirname, '..', 'api', 'listing-contact.js'), 'utf8');
  const profile = fs.readFileSync(path.join(__dirname, '..', 'api', 'dealer-profile.js'), 'utf8');
  assert.match(contact, /from\('trading_floor_verified_listings'\)/);
  assert.match(contact, /dealer\.status !== 'VERIFIED'/);
  assert.match(contact, /!dealer\.contact_consent/);
  assert.match(contact, /from\('verified_dealer_profile_stats'\)/);
  assert.match(profile, /from\('listing_identity_reviews'\)/);
  assert.match(profile, /verifiedIds\.has\(listing\.id\)/);
});

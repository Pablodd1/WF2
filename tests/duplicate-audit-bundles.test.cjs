'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { auditCandidates } = require('../tools/duplicate-audit/audit-brand.cjs');

test('splits bundle rows into candidate-level records before duplicate analysis', () => {
  const row = {
    id: 'source-1',
    brand: 'Rolex',
    reference: '126500LN',
    dial_color: 'Unknown',
    condition: 'NEW',
    listing_type: 'WTS',
    raw_message: 'Rolex\n126500LN White HKD 283000\n126610LN Black HKD 114000\n126710BLNR Blue HKD 149000',
  };

  const candidates = auditCandidates(row);
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map(candidate => candidate.bundle_parent_id), ['source-1', 'source-1', 'source-1']);
  assert.deepEqual(candidates.map(candidate => candidate.bundle_candidate_index), [1, 2, 3]);
  assert.deepEqual(candidates.map(candidate => candidate.reference), ['126500LN', '126610LN', '126710BLNR']);
});

test('does not present unresolved bundle envelopes as one duplicate candidate', () => {
  const row = {
    id: 'source-2',
    brand: 'Rolex',
    raw_message: 'Inventory\nline one\nline two\nline three\nline four\nline five\nline six\nline seven',
  };
  assert.deepEqual(auditCandidates(row), []);
});

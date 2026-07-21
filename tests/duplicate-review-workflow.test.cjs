'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { parseCsvLine } = require('../tools/duplicate-audit/stage-review-candidates.cjs');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260721170000_duplicate_review_workflow.sql'),
  'utf8'
);

test('duplicate candidate CSV parser preserves quoted raw values', () => {
  assert.deepEqual(parseCsvLine('EXACT_RAW,0.99,"Rolex, 116500LN",candidate'), [
    'EXACT_RAW', '0.99', 'Rolex, 116500LN', 'candidate',
  ]);
});

test('duplicate workflow is reversible and never deletes source records', () => {
  assert.match(migration, /status IN \('PENDING', 'SUPPRESSED', 'KEEP_BOTH', 'DEFERRED'\)/);
  assert.match(migration, /raw_evidence_preserved/);
  assert.match(migration, /watch_records_deleted.*false/);
  assert.doesNotMatch(migration, /DELETE FROM public\.watch_records/);
  assert.match(migration, /suppress_from_analytics = v_decision = 'SUPPRESS'/);
});

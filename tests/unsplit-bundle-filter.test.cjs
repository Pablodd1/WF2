'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bundleCandidateCount,
  deterministicCandidateCount,
  loadShadowBundleParentIds,
} = require('../api/_lib/unsplit-bundle-filter.cjs');

test('detects stored flags and raw multi-reference messages', () => {
  assert.equal(deterministicCandidateCount({ flags: ['BUNDLE_SPLIT_REQUIRED'], raw_message: '5712/1A' }), 2);
  assert.ok(deterministicCandidateCount({ raw_message: '5712/1A Blue\n116500LN White' }) > 1);
});

test('shadow evidence overrides a parser miss', () => {
  assert.equal(bundleCandidateCount({ id: 'parent', raw_message: 'Dealer stock list' }, new Set(['parent'])), 2);
});

test('loads shadow-confirmed parent ids through the service RPC', async () => {
  const client = {
    rpc: async (name, args) => {
      assert.equal(name, 'unsplit_bundle_parent_ids');
      assert.deepEqual(args.p_source_record_ids, ['a', 'b']);
      return { data: [{ source_record_id: 'b' }], error: null };
    },
  };
  assert.deepEqual(await loadShadowBundleParentIds(client, [{ id: 'a' }, { id: 'b' }]), new Set(['b']));
});

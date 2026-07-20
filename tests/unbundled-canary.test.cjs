'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildCanary, buildCanaryRow, explicitChildIntent, resolveIntent } = require('../tools/multilisting/build-unbundled-canary.cjs');

test('inherits WTB parent context when the child line has no explicit intent', () => {
  const result = resolveIntent({ raw_line: '5712/1A blue' }, { listing_type: 'WTB' });
  assert.deepEqual(result, { value: 'WTB', evidence: 'inherited_parent_context', blocker: null });
});

test('explicit child intent overrides parent context', () => {
  assert.equal(explicitChildIntent('WTS 126500LN White 283k HKD'), 'WTS');
  const result = resolveIntent({ raw_line: 'WTS 126500LN White 283k HKD' }, { listing_type: 'WTB' });
  assert.equal(result.value, 'WTS');
  assert.equal(result.evidence, 'explicit_child_text');
});

test('blocks unusable parent context rather than defaulting to WTS', () => {
  const result = resolveIntent({ raw_line: '5712/1A blue' }, { listing_type: 'GARBAGE' });
  assert.equal(result.value, null);
  assert.equal(result.blocker, 'PARENT_INTENT_UNUSABLE');
});

test('prefers explicit adjacent raw dial and requires review on export conflict', () => {
  const row = buildCanaryRow({
    listing_id: 'source-1_000',
    source_record_id: 'source-1',
    candidate_index: '0',
    raw_line: '15202BC salmon 2019 used full set 855k hkd',
    brand: 'Audemars Piguet',
    reference: '15202BC',
    model: '15202BC',
    listing_type: 'WTS',
    dial_color: 'Black',
    price_raw: '855000',
    price_currency: 'HKD',
    price_usd: '109615',
  }, {
    raw_message: 'Audemars Piguet\n15202BC salmon 2019 used full set 855k hkd',
    listing_type: 'WTS',
  });
  assert.equal(row.dial_color, 'Salmon');
  assert.equal(row.exact_raw_lineage, true);
  assert.ok(row.review_reasons.includes('DIAL_RAW_SOURCE_CONFLICT'));
  assert.equal(row.production_approved, false);
});

test('writes review-ready and held artifacts separately', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-unbundle-canary-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const listingsPath = path.join(directory, 'listings.csv');
  const parentsPath = path.join(directory, 'parents.csv');
  const outputDir = path.join(directory, 'output');
  fs.writeFileSync(listingsPath, [
    'listing_id,source_record_id,candidate_index,brand,reference,model,raw_line,listing_type,dial_color',
    'source-1_000,source-1,0,Rolex,116500LN,Daytona,116500LN White,WTS,White',
    'source-2_000,source-2,0,Unknown,NOREF,Unknown,NOREF,WTS,Black',
  ].join('\n'));
  fs.writeFileSync(parentsPath, [
    'source_record_id,raw_message,listing_type,created_at',
    'source-1,116500LN White,WTS,2026-07-01T00:00:00Z',
    'source-2,NOREF,WTS,2026-07-01T00:00:00Z',
  ].join('\n'));

  const { report } = await buildCanary({ listingsPath, parentsPath, outputDir, limit: 2 });
  assert.equal(report.rows, 2);
  assert.ok(fs.existsSync(path.join(outputDir, 'review-ready.jsonl')));
  assert.ok(fs.existsSync(path.join(outputDir, 'held.jsonl')));
  assert.equal(fs.readFileSync(path.join(outputDir, 'held.jsonl'), 'utf8').trim().split('\n').length, 1);
});

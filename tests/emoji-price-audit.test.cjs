'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  codePoints,
  maskPrivateContact,
  pictographs,
  pseudonym,
  summarizeRows,
} = require('../tools/price-quality/audit-emoji-prices.cjs');

test('extracts pictographs but excludes standard numeric keycaps', () => {
  assert.deepEqual(pictographs('HKD 1\uFE0F\u20E32\uFE0F\u20E3K \u{1F4B0}\u{1F525}'), ['\u{1F4B0}', '\u{1F525}']);
  assert.equal(codePoints('\u{1F4B0}'), 'U+1F4B0');
});

test('masks contact details without removing price evidence', () => {
  const masked = maskPrivateContact('Call +852 6236 1307, 125K HKD, a@b.com https://example.com');
  assert.match(masked, /\[PHONE\]/);
  assert.match(masked, /125K HKD/);
  assert.match(masked, /\[EMAIL\]/);
  assert.match(masked, /\[URL\]/);
});

test('summarizes token counts with pseudonymous record identities only', () => {
  const rows = [{
    source_record_id: 'private-source-id',
    source_brand: 'Rolex',
    source_reference: '126500LN',
    source_currency: 'HKD',
    proposed_candidates: [{ raw_line: '126500LN HKD \u{1F4B0}\u{1F525}' }],
  }];
  const result = summarizeRows(rows);
  assert.equal(result.tokens.length, 2);
  assert.equal(result.tokens[0].record_count, 1);
  assert.equal(result.privateSamples[0].source_record_pseudonym, pseudonym('private-source-id'));
  assert.doesNotMatch(JSON.stringify(result.privateSamples), /private-source-id/);
});

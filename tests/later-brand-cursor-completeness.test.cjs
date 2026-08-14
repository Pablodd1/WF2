'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const inventory = require('../api/reviewed-market-inventory.js');
const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260814114000_qnsa_later_brand_stable_pagination.sql'), 'utf8');

function traverseBoundedSource(rows, presentationFilter = () => true, pageSize = 50) {
  let offset = 0;
  const displayed = [];
  const consumed = [];
  while (offset < rows.length) {
    const sourceWindow = rows.slice(offset, offset + pageSize + 1);
    const rawRows = sourceWindow.slice(0, pageSize);
    consumed.push(...rawRows.map(row => row.id));
    displayed.push(...rawRows.filter(presentationFilter).map(row => row.id));
    offset += inventory.sourceCursorAdvance(rawRows);
    if (sourceWindow.length <= pageSize) break;
  }
  return { consumed, displayed };
}

test('cursor advances by the consumed source window rather than the rendered card count', () => {
  const rows = Array.from({ length: 94 }, (_, index) => ({
    id: `rm11-03-${String(index + 1).padStart(3, '0')}`,
    rating: index % 7 === 0 ? 5 : null,
  }));
  const result = traverseBoundedSource(rows, row => row.rating === 5);

  assert.equal(result.consumed.length, 94);
  assert.equal(new Set(result.consumed).size, 94);
  assert.deepEqual(result.displayed, rows.filter(row => row.rating === 5).map(row => row.id));
});

test('RM11-03 and WSSA0018 cursor pages contain no repeated IDs at the 50-row boundary', () => {
  for (const [prefix, count] of [['rm11-03', 94], ['wssa0018', 103]]) {
    const rows = Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index + 1}` }));
    const result = traverseBoundedSource(rows);
    assert.equal(result.displayed.length, count);
    assert.equal(new Set(result.displayed).size, count);
  }
});

test('later-brand SQL applies identity, safety, and reference gates before LIMIT/OFFSET', () => {
  const eligibleCte = migration.match(/WITH eligible_ids AS MATERIALIZED \(([\s\S]*?)\n  \)\n  SELECT/)?.[1] || '';
  assert.match(eligibleCte, /JOIN public\.raw_message_versions/);
  assert.match(eligibleCte, /bundle_child_pending_review/);
  assert.match(eligibleCte, /suppressed_exact_duplicate/);
  assert.match(eligibleCte, /normalized\.reference_key ~ '\^RM/);
  assert.match(eligibleCte, /normalized\.reference_key ~ '\^W/);
  assert.match(eligibleCte, /ORDER BY l\.reference_normalized ASC NULLS LAST, l\.id ASC[\s\S]*LIMIT[\s\S]*OFFSET/);
  assert.doesNotMatch(migration, /INSERT INTO staging\.listings|UPDATE staging\.listings|DELETE FROM staging\.listings/);
});

test('direct-submission merge preserves the non-skipping cursor behavior', () => {
  const rawRows = Array.from({ length: 50 }, (_, index) => ({ id: String(index) }));
  assert.equal(inventory.sourceCursorAdvance(rawRows), 50);
  assert.equal(inventory.sourceCursorAdvance(rawRows, 3, 47), 47);
});

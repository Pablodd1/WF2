'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const inventory = require('../api/reviewed-market-inventory.js');
const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260814114000_qnsa_later_brand_stable_pagination.sql'), 'utf8');
const candidateMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260814114500_qnsa_later_brand_candidate_cursor.sql'), 'utf8');
const inventorySource = fs.readFileSync(path.join(root, 'api', 'reviewed-market-inventory.js'), 'utf8');

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

test('later-brand SQL stays inside one proven bounded source window', () => {
  assert.match(migration, /qnsa_later_brand_page_rows\(\s*p_brand,\s*51,/);
  assert.match(migration, /normalized\.reference_key ~ '\^RM/);
  assert.match(migration, /normalized\.reference_key ~ '\^W/);
  assert.match(migration, /LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 51\), 1\), 51\)/);
  assert.doesNotMatch(migration, /WITH eligible_ids AS MATERIALIZED/);
  assert.doesNotMatch(migration, /CREATE\s+INDEX/i);
  assert.doesNotMatch(migration, /INSERT INTO staging\.listings|UPDATE staging\.listings|DELETE FROM staging\.listings/);
});

test('direct-submission merge preserves the non-skipping cursor behavior', () => {
  const rawRows = Array.from({ length: 50 }, (_, index) => ({ id: String(index) }));
  assert.equal(inventory.sourceCursorAdvance(rawRows), 50);
  assert.equal(inventory.sourceCursorAdvance(rawRows, 3, 47), 47);
});

test('candidate RPC exposes an exact bounded stride and raw lookahead hasMore contract', () => {
  assert.match(candidateMigration, /LIMIT v_scan_limit \+ 1 OFFSET v_offset/);
  assert.match(candidateMigration, /candidate_position <= v_scan_limit/);
  assert.match(candidateMigration, /'next_offset', v_offset \+ CASE/);
  assert.match(candidateMigration, /metrics\.selected_last_position/);
  assert.match(candidateMigration, /'has_more', CASE/);
  assert.match(candidateMigration, /metrics\.candidate_lookahead/);
  assert.match(candidateMigration, /v_scan_limit INTEGER := LEAST\(GREATEST[\s\S]*500\)/);
  assert.match(candidateMigration, /reference_normalized >= 'RM'[\s\S]*reference_normalized < 'RN'/);
  assert.match(candidateMigration, /reference_normalized >= 'W'[\s\S]*reference_normalized < 'X'/);
  assert.doesNotMatch(candidateMigration, /CREATE\s+(?:UNIQUE\s+)?INDEX/i);
});

test('broad later-brand API trusts candidate metadata instead of rendered row count', () => {
  assert.match(inventorySource, /qnsa_later_brand_candidate_page/);
  assert.match(inventorySource, /p_scan_limit: 500/);
  assert.match(inventorySource, /qnsaCandidateCursorMeta\.hasMore/);
  assert.match(inventorySource, /qnsaCandidateCursorMeta\.nextOffset/);
  assert.match(inventorySource, /qnsa_later_brand_page_rows_strict/,
    'the prior publication-safe RPC remains a deploy-order fallback');
});

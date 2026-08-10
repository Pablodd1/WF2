'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'api', 'price-research.js'),
  'utf8',
);

test('high-volume Price Research uses one bounded strict-source query', () => {
  assert.match(source, /let sourceTable = 'price_research_verified_source'/);
  assert.match(source, /const buildRowsQuery = table => client\s*\.from\(table\)/);
  assert.match(source, /\.limit\(pageSize\)/);
  assert.match(source, /const sourceSampleCapped = usingReviewedWorkbook/);
  assert.match(source, /sampleCapped: sourceSampleCapped/);
  assert.doesNotMatch(source, /Array\.from\(\{ length: sampleLimit \/ pageSize \}/);
  assert.doesNotMatch(source, /buildRowsQuery\(from, from \+ pageSize - 1\)/);
});

test('legacy fallback remains bounded and WTB demand is loaded independently', () => {
  assert.match(source, /sourceTable = 'watch_records';\s*result = await buildRowsQuery\(sourceTable\)/);
  assert.match(source, /lookupDemand\(\s*client,\s*'watch_records'/);
  assert.match(source, /selection,\s*\[\],\s*\)/);
});

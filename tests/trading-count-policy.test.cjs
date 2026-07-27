'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ingestSource = fs.readFileSync(path.join(__dirname, '..', 'api', 'ingest.js'), 'utf8');

test('cursor browsing does not count the complete verified view', () => {
  assert.match(ingestSource, /cursorMode[\s\S]*\? 'return=representation'[\s\S]*\? 'count=planned'[\s\S]*: 'count=estimated'/);
  assert.match(ingestSource, /const total = cursorMode[\s\S]*\? null/);
});

test('strict browsing verifies bounded indexed candidates instead of scanning the strict view', () => {
  assert.match(ingestSource, /candidatePageSize = strictVerifiedPublication[\s\S]*Math\.min\(pageSize \* 10, 500\)/);
  assert.match(ingestSource, /const tableName = strictVerifiedPublication[\s\S]*trading_floor_market_listings/);
  assert.match(ingestSource, /candidateRecords\.map\(row => row\.id\)/);
  assert.match(ingestSource, /!strictVerifiedPublication \|\| Boolean\(verified\)/);
  assert.match(ingestSource, /rest\/v1\/listing_identity_reviews/);
  assert.match(ingestSource, /status: 'in\.\(CATALOG_CONFIRMED,HUMAN_APPROVED\)'/);
  assert.match(ingestSource, /Verified media batch unavailable; images remain withheld/);
  assert.match(ingestSource, /strictVerifiedPublication && cursorMode/);
  assert.match(ingestSource, /loadStrictCursorPage/);
  assert.match(ingestSource, /Strict publication requires server-side verification/);
});

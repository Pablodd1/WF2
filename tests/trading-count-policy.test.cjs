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

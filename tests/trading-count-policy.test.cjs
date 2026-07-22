'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ingestSource = fs.readFileSync(path.join(__dirname, '..', 'api', 'ingest.js'), 'utf8');

test('reference search uses a planned count instead of an exact-count fallback', () => {
  assert.match(ingestSource, /'Prefer': search \? 'count=planned' : 'count=estimated'/);
});

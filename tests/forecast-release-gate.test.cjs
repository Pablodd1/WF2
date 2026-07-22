'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('public forecast values require an explicit production release flag', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research.js'), 'utf8');
  assert.match(source, /process\.env\.ENABLE_PRICE_FORECASTS !== 'true'/);
  assert.match(source, /FEATURE_NOT_RELEASED/);
});

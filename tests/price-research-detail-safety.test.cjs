'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('Price Research cancels stale detail requests and validates the returned listing id', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'pages', 'PriceResearch.tsx'), 'utf8');
  assert.match(source, /listingRequestRef\.current\.controller\?\.abort\(\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /payload\.listing\?\.id !== row\.id/);
  assert.match(source, /listingRequestRef\.current\.sequence !== sequence/);
  assert.match(source, /key=\{selectedRow\.id\}/);
});

test('public listing detail routes do not expose raw source messages', () => {
  const trading = fs.readFileSync(path.join(root, 'api', 'trading-listing.js'), 'utf8');
  const research = fs.readFileSync(path.join(root, 'api', 'price-research-listing.js'), 'utf8');
  assert.match(trading, /raw_message: null/);
  assert.match(research, /raw_message: null/);
  assert.doesNotMatch(trading, /redactPublicSource/);
  assert.doesNotMatch(research, /redactPublicSource/);
});

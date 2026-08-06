'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/pages/DealerSubmitListing.tsx'), 'utf8');

test('authenticated form supports item photos, a posting-user photo, and single or bulk publication', () => {
  assert.match(source, /Take or choose item photos/);
  assert.match(source, /Credentialed posting user/);
  assert.match(source, /identity fields cannot be edited here/);
  assert.match(source, /capture="environment"/);
  assert.match(source, /capture="user"/);
  assert.match(source, /Bulk posting/);
  assert.match(source, /MAX_ITEMS = 20/);
  assert.match(source, /Normalize and publish/);
});

test('direct form keeps price optional and sends normalized items to the publication API', () => {
  assert.match(source, /Asking price \(optional\)/);
  assert.match(source, /Price not supplied/);
  assert.match(source, /items: normalizedItems/);
  assert.match(source, /\/api\/dealer-media/);
  assert.match(source, /\/api\/dealer-submissions/);
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('seller lineage maps the rows returned by the REST result wrapper', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'api', 'unbundled-review-queue.js'),
    'utf8',
  );

  assert.match(source, /new Map\(lineageRows\.rows\.map\(/);
  assert.doesNotMatch(source, /new Map\(lineageRows\.map\(/);
});

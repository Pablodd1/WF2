const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalDirectoryFallbackAllowed,
} = require('../api/dealers.js');

test('canonical directory falls back only for deploy gaps and read timeouts', () => {
  assert.equal(canonicalDirectoryFallbackAllowed({ code: '57014', message: 'canceling statement' }), true);
  assert.equal(canonicalDirectoryFallbackAllowed({ message: 'canceling statement due to statement timeout' }), true);
  assert.equal(canonicalDirectoryFallbackAllowed({ message: 'function qnsa_dealer_directory_page does not exist' }), true);
  assert.equal(canonicalDirectoryFallbackAllowed({ message: 'schema cache is stale' }), true);

  assert.equal(canonicalDirectoryFallbackAllowed({ code: '42501', message: 'permission denied' }), false);
  assert.equal(canonicalDirectoryFallbackAllowed({ code: 'PGRST301', message: 'JWT expired' }), false);
  assert.equal(canonicalDirectoryFallbackAllowed({ code: 'XX000', message: 'unexpected database error' }), false);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateAddress } = require('../api/_lib/safe-image-fetch.cjs');
const { redactPublicSource } = require('../api/_lib/source-redaction.cjs');
const { csvCell } = require('../api/_lib/csv-cell.cjs');

test('blocks private and reserved image destinations', () => {
  for (const address of ['127.0.0.1', '10.0.0.8', '172.16.0.2', '192.168.1.5', '169.254.169.254', '::1', 'fd00::1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});

test('redacts dealer contact paths without erasing watch references or prices', () => {
  const raw = '[7/12, 7:19 AM] +852 6236 1307: Rolex 116500LN USD 30,000\nWhatsApp: +1 (305) 555-1212';
  const redacted = redactPublicSource(raw);
  assert.doesNotMatch(redacted, /6236 1307|555-1212/);
  assert.match(redacted, /116500LN/);
  assert.match(redacted, /30,000/);
});

test('redacts WhatsApp links while preserving the surrounding listing evidence', () => {
  const raw = 'Rolex 52506 HKD 380K contact https://wa.me/85262361307';
  const redacted = redactPublicSource(raw);
  assert.doesNotMatch(redacted, /85262361307/);
  assert.match(redacted, /Rolex 52506 HKD 380K/);
});

test('neutralizes spreadsheet formulas and quotes CSV values', () => {
  assert.equal(csvCell('=HYPERLINK("https://bad.example")'), '"\'=HYPERLINK(""https://bad.example"")"');
  assert.equal(csvCell('Rolex, 116500LN'), '"Rolex, 116500LN"');
});

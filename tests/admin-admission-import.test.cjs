'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const endpoint = require('../api/admin-admission-import.js');

function row(overrides = {}) {
  const hash = 'a'.repeat(64);
  return {
    id: `admission_${hash}`, content_hash: hash, brand_scope: 'Blancpain', canonical_brand: 'Blancpain',
    source_file_sha256: 'b'.repeat(64), verification_status: 'APPROVED_SINGLE_CANDIDATE', confidence: 100,
    listing_type: 'WTS', source_record_id: 'source-1', raw_message: 'Blancpain 5000-1110 USD 12000',
    posting_date: '2026-08-11T00:00:00.000Z', posted_by: 'Seller', phone_number: null,
    contact_publication_approved: false, user_image_url: null, catalog_image_url: null,
    final_image_url: null, display_image_url: null, image_evidence_type: null,
    price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH', normalized_reference: '50001110',
    source_currency: 'USD', workbook_price_usd: 12000, ...overrides,
  };
}

test('bounded importer accepts only fail-closed no-image children', () => {
  assert.equal(endpoint.validateRow(row(), 'Blancpain', 'b'.repeat(64)), null);
  assert.equal(endpoint.validateRow(row({ final_image_url: 'https://parent.test/image.jpg' }), 'Blancpain', 'b'.repeat(64)), 'INHERITED_MEDIA_FORBIDDEN');
  assert.equal(endpoint.validateRow(row({ contact_publication_approved: true }), 'Blancpain', 'b'.repeat(64)), 'CONTACT_NOT_FAIL_CLOSED');
});

test('verified price requires a WTS exact-reference USD contract', () => {
  assert.equal(endpoint.validateRow(row({ listing_type: 'WTB' }), 'Blancpain', 'b'.repeat(64)), 'PRICE_RESEARCH_CONTRACT_INVALID');
  assert.equal(endpoint.validateRow(row({ normalized_reference: null }), 'Blancpain', 'b'.repeat(64)), 'PRICE_RESEARCH_CONTRACT_INVALID');
  assert.equal(endpoint.validateRow(row({ source_currency: 'HKD' }), 'Blancpain', 'b'.repeat(64)), 'PRICE_RESEARCH_CONTRACT_INVALID');
});

test('import endpoint is disabled when its temporary token is absent', async () => {
  const previous = process.env.ADMISSION_IMPORT_TOKEN;
  delete process.env.ADMISSION_IMPORT_TOKEN;
  const response = { code: null, payload: null, setHeader() {}, status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await endpoint({ method: 'POST', headers: {}, body: {} }, response);
  assert.equal(response.code, 503);
  assert.equal(response.payload.error, 'Import disabled');
  if (previous !== undefined) process.env.ADMISSION_IMPORT_TOKEN = previous;
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const XLSX = require('xlsx');
const intake = require('../tools/intake/import-approved-admission-workbook.cjs');

function source(overrides = {}) {
  return {
    listing_id: 'tag-1',
    source_platform: 'WHATSAPP',
    source_group_id: 'group-1',
    source_message_id: 'message-1',
    source_posted_at: '2026-08-11T12:00:00Z',
    ingested_at: '2026-08-11T12:01:00Z',
    raw_message: 'TAG Heuer Carrera CBS2210.FC6534 blue dial USD 6500',
    intent: 'WTS',
    category: 'WATCH',
    asking_price_raw: 'USD 6500',
    source_currency: 'USD',
    normalized_price_usd: 6500,
    fx_source: 'SOURCE_USD',
    fx_rate_date: '2026-08-11',
    image_keys: 'image-1',
    image_urls_source: 'https://example.test/image.jpg',
    image_count_source: 1,
    duplicate_status_source: 'UNIQUE',
    seller_source_id: 'seller-1',
    seller_name_source: 'Seller One',
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    listing_id: 'tag-1',
    final_brand: 'TAG Heuer',
    final_model: 'Carrera',
    final_reference: 'CBS2210.FC6534',
    dial_normalized: 'Blue',
    identity_status: 'VERIFIED',
    bundle_status: 'SINGLE_CANDIDATE',
    image_status: 'VERIFIED',
    duplicate_decision: 'COUNT',
    trading_floor_status: 'PUBLISH',
    price_research_status: 'ELIGIBLE',
    review_reason: '',
    reviewed_by: 'owner',
    reviewed_at: '2026-08-16T00:00:00Z',
    ...overrides,
  };
}

test('strict admission mapping preserves lineage and fails contact closed', () => {
  const row = intake.rowForImport({
    source: source(),
    decision: decision(),
    expectedBrand: 'TAG Heuer',
    fileName: 'TAG_Heuer_Trading_Floor_Admission_Master.xlsx',
    fileSha256: 'a'.repeat(64),
    rowNumber: 2,
    runId: 'test',
  });
  assert.equal(row.brand_scope, 'TAG Heuer');
  assert.equal(row.model, 'Carrera');
  assert.equal(row.normalized_reference, 'CBS2210.FC6534');
  assert.equal(row.raw_message, source().raw_message);
  assert.equal(row.source_record_id, 'tag-1');
  assert.equal(row.user_image_url, 'https://example.test/image.jpg');
  assert.equal(row.price_evidence_status, 'SOURCE_EXPLICIT_USD_MATCH');
  assert.equal(row.contact_publication_approved, false);
  assert.equal(row.phone_number, null);
});

test('bundle parents and unresolved identities never produce import rows', () => {
  assert.equal(intake.rowForImport({
    source: source(), decision: decision({ bundle_status: 'BUNDLE_PARENT' }),
    expectedBrand: 'TAG Heuer', fileName: 'input.xlsx', fileSha256: 'b'.repeat(64),
    rowNumber: 2, runId: 'test',
  }), null);
  assert.equal(intake.rowForImport({
    source: source(), decision: decision({ final_model: '' }),
    expectedBrand: 'TAG Heuer', fileName: 'input.xlsx', fileSha256: 'b'.repeat(64),
    rowNumber: 2, runId: 'test',
  }), null);
});

test('Trading Floor admission cannot silently promote a Price Research hold', () => {
  const row = intake.rowForImport({
    source: source({ fx_source: '', fx_rate_date: '' }),
    decision: decision(),
    expectedBrand: 'TAG Heuer',
    fileName: 'input.xlsx',
    fileSha256: 'c'.repeat(64),
    rowNumber: 2,
    runId: 'test',
  });
  assert.ok(row);
  assert.equal(row.price_evidence_status, 'PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE');
  assert.deepEqual(row.review_reasons, ['PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE']);
});

test('non-USD FX remains review evidence but is excluded from current analytics', () => {
  const evidence = intake.sourcePriceEvidence(source({
    raw_message: 'TAG Heuer Carrera CBS2210.FC6534 HKD 50000',
    asking_price_raw: 'HKD 50000',
    source_currency: 'HKD',
    normalized_price_usd: 6410,
    fx_source: 'ECB',
    fx_rate_date: '2026-08-11',
  }));
  assert.equal(evidence.sourceAmount, 50000);
  assert.equal(evidence.workbookPriceUsd, 6410);
  assert.equal(evidence.status, 'DATED_FX_PROVENANCE_REQUIRES_EXISTING_SIDECAR');
});

test('dry-run emits reconciled aggregate canary with zero database writes', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'admission-import-'));
  const file = path.join(temp, 'TAG_Heuer_Trading_Floor_Admission_Master.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    source(),
    source({ listing_id: 'tag-bundle', source_message_id: 'message-2' }),
  ]), 'Trading Floor & Price Research');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    decision(),
    decision({ listing_id: 'tag-bundle', bundle_status: 'BUNDLE_PARENT' }),
  ]), 'TAG Admission Decisions');
  XLSX.writeFile(workbook, file);
  const report = await intake.run([
    '--input', file,
    '--brand', 'TAG Heuer',
    '--output-dir', path.join(temp, 'output'),
    '--max-rows', '25',
  ]);
  assert.equal(report.mode, 'LOCAL_DRY_RUN');
  assert.equal(report.source_rows, 2);
  assert.equal(report.strict_trading_floor_candidates, 1);
  assert.equal(report.selected_rows, 1);
  assert.equal(report.bundle_rows_selected, 0);
  assert.equal(report.contact_publication_approved_rows, 0);
  assert.equal(report.database_writes, 0);
  assert.equal(report.held_reasons.BUNDLE_PENDING_SEPARATION, 1);
});

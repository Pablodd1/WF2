#!/usr/bin/env node
'use strict';

const path = require('node:path');
const intake = require('./import-approved-admission-workbook.cjs');

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function args(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) values[argv[index].replace(/^--/, '')] = argv[index + 1];
  const batchSize = Math.min(50, Math.max(1, Number(values['batch-size'] || 50)));
  if (!values.input || !values.brand || !values.endpoint) throw new Error('--input, --brand, and --endpoint are required');
  return {
    input: path.resolve(values.input),
    brand: text(values.brand),
    endpoint: String(values.endpoint),
    batchSize,
    runId: text(values['run-id']) || `owner_unbundled_${Date.now()}`,
  };
}

function collect(options) {
  if (!intake.OWNER_UNBUNDLED_BRANDS.has(options.brand)) throw new Error(`brand not allowlisted: ${options.brand}`);
  const workbook = intake.readAdmissionWorkbook(options.input);
  const fileName = path.basename(options.input);
  const rows = [];
  workbook.sourceRows.forEach((source, index) => {
    const decision = workbook.decisions.get(text(source.listing_id));
    if (!decision) return;
    const admission = intake.classifyOwnerUnbundledRow(source, decision, options.brand);
    if (!admission.trading_floor_candidate
      || intake.additionalImportReasons(source, { allowNoImage: true }).length) return;
    rows.push(intake.rowForImport({
      source, decision, expectedBrand: options.brand, fileName,
      fileSha256: workbook.fileSha256, rowNumber: index + 2,
      runId: options.runId, ownerUnbundled: true,
    }));
  });
  const unique = [...new Map(rows.map(row => [row.id, row])).values()];
  if (unique.length !== rows.length) throw new Error('candidate IDs are not unique');
  return { fileSha256: workbook.fileSha256, rows: unique };
}

async function publish(options) {
  const token = process.env.ADMISSION_IMPORT_TOKEN;
  if (!token) throw new Error('ADMISSION_IMPORT_TOKEN is required');
  const cohort = collect(options);
  let accepted = 0;
  let reconciledRows = 0;
  for (let offset = 0; offset < cohort.rows.length; offset += options.batchSize) {
    const batch = cohort.rows.slice(offset, offset + options.batchSize);
    const final = offset + batch.length === cohort.rows.length;
    const response = await fetch(options.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ brand: options.brand, source_file_sha256: cohort.fileSha256, rows: batch, final }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`batch ${offset} failed: ${response.status} ${body.error || 'unknown error'}`);
    accepted += Number(body.accepted || 0);
    if (body.reconciled_rows !== null && body.reconciled_rows !== undefined) {
      reconciledRows = Number(body.reconciled_rows);
    }
  }
  if (accepted !== cohort.rows.length || reconciledRows !== cohort.rows.length) {
    throw new Error(`reconciliation failed: ${accepted}/${reconciledRows}/${cohort.rows.length}`);
  }
  return { brand: options.brand, source_sha256: cohort.fileSha256, expected: cohort.rows.length, accepted, reconciled_rows: reconciledRows };
}

async function main(argv = process.argv.slice(2)) {
  const result = await publish(args(argv));
  console.log(JSON.stringify(result));
  return result;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { args, collect, main, publish };

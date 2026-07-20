'use strict';

const fs = require('node:fs');
const path = require('node:path');
const csv = require('csv-parser');
const { adjacentDialClaim, exactLineage } = require('./bundle-cohort.cjs');
const { confirmCatalogCandidate } = require('../shadow-reprocess/catalog-confirmation.cjs');
const { comparisonKey } = require('../../api/_lib/dial-normalization.cjs');

const DEFAULT_LIMIT = 1000;
const VERSION = 'manual-unbundle-canary-v1';

function text(value) {
  return String(value ?? '').trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function explicitChildIntent(rawLine) {
  const source = ` ${text(rawLine).toLowerCase()} `;
  const wtb = /(?:^|\s)(?:wtb|want(?:ed)?\s+to\s+buy|looking\s+for|seeking|buying)(?:\s|:|-|$)/i.test(source);
  const wts = /(?:^|\s)(?:wts|for\s+sale|available\s+for\s+sale|selling)(?:\s|:|-|$)/i.test(source);
  if (wtb && wts) return 'MIXED';
  if (wtb) return 'WTB';
  if (wts) return 'WTS';
  return null;
}

function resolveIntent(row, parent) {
  const parentIntent = upper(parent?.listing_type);
  const childExplicit = explicitChildIntent(row.raw_line);
  if (childExplicit === 'MIXED') {
    return { value: null, evidence: 'child_mixed', blocker: 'CHILD_INTENT_MIXED' };
  }
  if (childExplicit) {
    return { value: childExplicit, evidence: 'explicit_child_text', blocker: null };
  }
  if (parentIntent === 'WTB' || parentIntent === 'WTS') {
    return { value: parentIntent, evidence: 'inherited_parent_context', blocker: null };
  }
  return { value: null, evidence: 'unusable_parent_context', blocker: 'PARENT_INTENT_UNUSABLE' };
}

function buildCanaryRow(row, parent) {
  const blockers = [];
  const reviewReasons = [];
  const lineageConfirmed = Boolean(parent && exactLineage(parent.raw_message, row.raw_line));
  if (!lineageConfirmed) blockers.push(parent ? 'RAW_LINEAGE_MISSING' : 'PARENT_NOT_FOUND');

  const intent = resolveIntent(row, parent);
  if (intent.blocker) blockers.push(intent.blocker);
  if (intent.value && intent.value !== upper(row.listing_type)) reviewReasons.push('INTENT_CORRECTED_FROM_PARENT_CONTEXT');

  const explicitDial = adjacentDialClaim(row.raw_line, row.reference);
  const exportedDial = text(row.dial_color) || null;
  const selectedDial = explicitDial || exportedDial;
  if (explicitDial && exportedDial && comparisonKey(explicitDial) !== comparisonKey(exportedDial)) {
    reviewReasons.push('DIAL_RAW_SOURCE_CONFLICT');
  }

  const catalog = confirmCatalogCandidate({
    brand: text(row.brand) || null,
    reference: text(row.reference) || null,
    dial_color: selectedDial,
  });
  if (!catalog.confirmed) blockers.push(catalog.reason || 'CATALOG_NOT_CONFIRMED');
  if (selectedDial && catalog.confirmed && catalog.dialConfirmed !== true) {
    blockers.push(catalog.dialReason || 'CATALOG_DIAL_UNCONFIRMED');
  }

  let reviewStatus = 'READY_FOR_HUMAN_REVIEW';
  if (blockers.some(flag => flag === 'PARENT_NOT_FOUND' || flag === 'RAW_LINEAGE_MISSING' || flag.includes('INTENT'))) {
    reviewStatus = 'BLOCKED_LINEAGE_CONTEXT';
  } else if (blockers.length) {
    reviewStatus = 'BLOCKED_CATALOG';
  } else if (reviewReasons.length) {
    reviewStatus = 'REQUIRES_HUMAN_CORRECTION';
  }

  return {
    listing_id: text(row.listing_id),
    source_record_id: text(row.source_record_id),
    child_index: Number.parseInt(text(row.candidate_index), 10),
    raw_line: text(row.raw_line),
    source_created_at: text(row.source_created_at) || text(parent?.created_at) || null,
    brand: text(row.brand) || null,
    reference: text(row.reference) || null,
    model: text(row.model) || catalog.match?.model || null,
    listing_type: intent.value,
    listing_type_exported: upper(row.listing_type) || null,
    intent_evidence: intent.evidence,
    dial_color: selectedDial,
    dial_color_exported: exportedDial,
    dial_evidence: explicitDial ? 'exact_raw_adjacent_to_reference' : (exportedDial ? 'manual_export' : null),
    condition: text(row.condition) || null,
    price_raw: numeric(row.price_raw),
    price_currency: upper(row.price_currency) || null,
    price_usd: numeric(row.price_usd),
    price_text: text(row.price_text) || null,
    catalog_confirmed: catalog.confirmed,
    catalog_dial_confirmed: catalog.dialConfirmed,
    catalog: catalog.match || null,
    exact_raw_lineage: lineageConfirmed,
    parser_version: VERSION,
    review_status: reviewStatus,
    blockers: [...new Set(blockers)],
    review_reasons: [...new Set(reviewReasons)],
    production_approved: false,
  };
}

function streamCsv(filePath, onRow) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', onRow)
      .on('end', resolve)
      .on('error', reject);
  });
}

async function buildCanary({ listingsPath, parentsPath, outputDir, limit = DEFAULT_LIMIT }) {
  const parents = new Map();
  await streamCsv(parentsPath, row => {
    parents.set(text(row.source_record_id), row);
  });

  const rows = [];
  await streamCsv(listingsPath, row => {
    if (rows.length >= limit) return;
    rows.push(buildCanaryRow(row, parents.get(text(row.source_record_id))));
  });

  const statusCounts = {};
  const blockerCounts = {};
  const reviewReasonCounts = {};
  const intentCounts = {};
  for (const row of rows) {
    statusCounts[row.review_status] = (statusCounts[row.review_status] || 0) + 1;
    intentCounts[row.listing_type || 'UNRESOLVED'] = (intentCounts[row.listing_type || 'UNRESOLVED'] || 0) + 1;
    for (const blocker of row.blockers) blockerCounts[blocker] = (blockerCounts[blocker] || 0) + 1;
    for (const reason of row.review_reasons) reviewReasonCounts[reason] = (reviewReasonCounts[reason] || 0) + 1;
  }

  const report = {
    generated_at: new Date().toISOString(),
    parser_version: VERSION,
    input: path.resolve(listingsPath),
    parent_input: path.resolve(parentsPath),
    rows: rows.length,
    status_counts: statusCounts,
    intent_counts: intentCounts,
    blocker_counts: blockerCounts,
    review_reason_counts: reviewReasonCounts,
    release_gate: {
      decision: 'HUMAN_REVIEW_REQUIRED',
      production_writes_allowed: false,
      target: 'local_staging_artifact',
      requirements: [
        'Exact raw parent lineage',
        'Usable parent or explicit child intent',
        'Exact catalog identity',
        'Catalog-confirmed dial when a dial is proposed',
        'Individual reviewer approval before publication',
      ],
    },
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'rows.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
  const reviewReady = rows.filter(row => row.review_status === 'READY_FOR_HUMAN_REVIEW');
  const held = rows.filter(row => row.review_status !== 'READY_FOR_HUMAN_REVIEW');
  fs.writeFileSync(path.join(outputDir, 'review-ready.jsonl'), reviewReady.map(row => JSON.stringify(row)).join('\n') + (reviewReady.length ? '\n' : ''));
  fs.writeFileSync(path.join(outputDir, 'held.jsonl'), held.map(row => JSON.stringify(row)).join('\n') + (held.length ? '\n' : ''));
  fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return { rows, report };
}

async function main() {
  const listingsPath = process.env.UNBUNDLED_CSV_PATH || process.argv[2];
  const parentsPath = process.env.UNBUNDLED_PARENT_CSV_PATH || process.argv[3];
  if (!listingsPath || !parentsPath) throw new Error('Provide listings and parent raw-message CSV paths.');
  const outputDir = path.resolve(process.env.UNBUNDLED_CANARY_OUTPUT || 'audit-output/unbundled/batch-001-canary');
  const limit = Math.max(1, Math.min(Number(process.env.UNBUNDLED_CANARY_ROWS || DEFAULT_LIMIT), 10000));
  const { report } = await buildCanary({ listingsPath, parentsPath, outputDir, limit });
  process.stdout.write(`${JSON.stringify({ event: 'unbundled_canary_complete', outputDir, ...report }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'unbundled_canary_error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { buildCanary, buildCanaryRow, explicitChildIntent, resolveIntent };

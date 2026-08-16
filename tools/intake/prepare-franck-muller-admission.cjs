'use strict';

// Franck Muller admission intake is intentionally review-only. It joins an
// immutable source sheet to the supplied decision ledger and produces a
// non-PII manifest. It never writes to QNSA, staging, or public release views.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const SOURCE_SHEET = 'Trading Floor & Price Research';
const DECISION_SHEET = 'TAG Admission Decisions';
const SOURCE_HEADERS = [
  'listing_id', 'source_platform', 'source_group_id', 'source_message_id',
  'source_posted_at', 'ingested_at', 'raw_message', 'intent', 'category',
  'asking_price_raw', 'source_currency', 'normalized_price_usd', 'fx_source',
  'fx_rate_date', 'image_keys', 'image_urls_source', 'image_count_source',
  'duplicate_status_source',
];
const DECISION_HEADERS = [
  'listing_id', 'final_brand', 'final_model', 'final_reference',
  'identity_status', 'bundle_status', 'image_status', 'duplicate_decision',
  'trading_floor_status', 'price_research_status', 'review_reason',
  'reviewed_by', 'reviewed_at',
];
const CURRENCY_SUFFIX = /(?:USD|USDT|HKD|EUR|GBP|JPY|CNY)$/i;

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeReference(value) {
  return text(value).toUpperCase().replace(/[\s-]+/g, '') || null;
}

function invalidReference(value) {
  const reference = normalizeReference(value);
  return !reference || /^UNSPECIFIED$/i.test(reference) || CURRENCY_SUFFIX.test(reference);
}

function requireHeaders(rows, headers, name) {
  const present = Object.keys(rows[0] || {});
  const missing = headers.filter(header => !present.includes(header));
  if (missing.length) throw new Error(`${name} is missing required headers: ${missing.join(', ')}`);
}

function readWorkbook(filePath) {
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sourceSheet = workbook.Sheets[SOURCE_SHEET];
  const decisionSheet = workbook.Sheets[DECISION_SHEET];
  if (!sourceSheet || !decisionSheet) throw new Error('Franck Muller workbook must contain both source and decision worksheets');
  const sourceRows = XLSX.utils.sheet_to_json(sourceSheet, { defval: null, raw: true })
    .filter(row => Object.values(row).some(value => text(value)));
  const decisionRows = XLSX.utils.sheet_to_json(decisionSheet, { defval: null, raw: true })
    .filter(row => Object.values(row).some(value => text(value)));
  requireHeaders(sourceRows, SOURCE_HEADERS, SOURCE_SHEET);
  requireHeaders(decisionRows, DECISION_HEADERS, DECISION_SHEET);
  const decisions = new Map();
  for (const decision of decisionRows) {
    const listingId = text(decision.listing_id);
    if (!listingId || decisions.has(listingId)) throw new Error(`decision ledger has missing or duplicate listing_id: ${listingId || '(blank)'}`);
    decisions.set(listingId, decision);
  }
  return { fileSha256: sha256(buffer), sourceRows, decisions, decisionRows };
}

function classifyRow(source, decision) {
  const reasons = [];
  const finalBrand = text(decision.final_brand);
  const category = text(source.category).toUpperCase();
  const intent = text(source.intent).toUpperCase();
  const reference = normalizeReference(decision.final_reference);
  const requestedPublish = text(decision.trading_floor_status).toUpperCase() === 'PUBLISH';

  if (finalBrand !== 'Franck Muller') reasons.push('NOT_FRANCK_MULLER_SCOPE');
  if (category !== 'WATCH') reasons.push('NON_WATCH_ROUTE_LUXURY_RESEARCH');
  if (text(decision.identity_status) !== 'VERIFIED') reasons.push('IDENTITY_REVIEW_REQUIRED');
  if (text(decision.bundle_status) !== 'SINGLE_CANDIDATE') reasons.push('BUNDLE_PENDING_SEPARATION');
  if (text(decision.image_status) !== 'VERIFIED' || Number(source.image_count_source || 0) < 1) reasons.push('IMAGE_UNVERIFIED_OR_MISSING');
  if (text(decision.duplicate_decision) !== 'COUNT') reasons.push('REPOST_OR_DUPLICATE_EXCLUDED');
  if (invalidReference(decision.final_reference)) reasons.push('REFERENCE_UNRESOLVED_OR_PRICE_TOKEN');
  if (!text(source.listing_id) || !text(source.source_message_id) || !text(source.raw_message)) reasons.push('IMMUTABLE_SOURCE_LINEAGE_MISSING');
  if (!requestedPublish) reasons.push('NOT_APPROVED_FOR_TRADING_FLOOR');

  const tradingFloorCandidate = reasons.length === 0;
  const priceResearchCandidate = Boolean(tradingFloorCandidate
    && intent === 'WTS'
    && text(decision.price_research_status).toUpperCase() === 'ELIGIBLE'
    && Number.isFinite(Number(source.normalized_price_usd))
    && Number(source.normalized_price_usd) > 0
    && text(source.source_currency)
    && text(source.fx_source)
    && text(source.fx_rate_date));

  if (tradingFloorCandidate && !priceResearchCandidate && text(decision.price_research_status).toUpperCase() === 'ELIGIBLE') {
    reasons.push('PRICE_RESEARCH_EVIDENCE_INCOMPLETE');
  }
  return {
    final_brand: tradingFloorCandidate ? finalBrand : null,
    final_reference: tradingFloorCandidate ? reference : null,
    trading_floor_candidate: tradingFloorCandidate,
    price_research_candidate: priceResearchCandidate,
    disposition: tradingFloorCandidate ? 'REVIEW_REQUIRED' : 'HOLD_FOR_REVIEW',
    reasons,
  };
}

function decisionRow(source, decision, rowNumber) {
  const admission = classifyRow(source, decision || {});
  return {
    source_row_number: rowNumber,
    listing_id: text(source.listing_id) || null,
    source_message_id: text(source.source_message_id) || null,
    source_brand: text(source.source_brand_text) || null,
    final_brand: admission.final_brand,
    final_model: text(decision?.final_model) || null,
    final_reference: admission.final_reference,
    source_intent: text(source.intent) || null,
    source_category: text(source.category) || null,
    requested_trading_floor_status: text(decision?.trading_floor_status) || null,
    identity_status: text(decision?.identity_status) || null,
    bundle_status: text(decision?.bundle_status) || null,
    trading_floor_candidate: admission.trading_floor_candidate,
    price_research_candidate: admission.price_research_candidate,
    disposition: admission.disposition,
    review_reasons: admission.reasons.join('|'),
  };
}

function csvCell(value) {
  const content = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(content) ? `"${content.replaceAll('"', '""')}"` : content;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith('--')) {
      options[argv[index].slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  if (!options.input) throw new Error('--input is required');
  return {
    input: path.resolve(options.input),
    outputDir: path.resolve(options['output-dir'] || path.join('audit-output', `franck-muller-admission-${Date.now()}`)),
  };
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const input = readWorkbook(options.input);
  const rows = input.sourceRows.map((source, index) => decisionRow(source, input.decisions.get(text(source.listing_id)), index + 2));
  const missingDecisionCount = rows.filter(row => !input.decisions.has(text(row.listing_id))).length;
  const extraDecisionCount = [...input.decisions.keys()].filter(id => !input.sourceRows.some(row => text(row.listing_id) === id)).length;
  const counts = rows.reduce((totals, row) => {
    totals[row.disposition] = (totals[row.disposition] || 0) + 1;
    if (row.trading_floor_candidate) totals.trading_floor_candidates += 1;
    if (row.price_research_candidate) totals.price_research_candidates += 1;
    for (const reason of row.review_reasons.split('|').filter(Boolean)) totals[`reason:${reason}`] = (totals[`reason:${reason}`] || 0) + 1;
    return totals;
  }, { trading_floor_candidates: 0, price_research_candidates: 0 });
  fs.mkdirSync(options.outputDir, { recursive: true });
  const headers = Object.keys(rows[0] || {});
  fs.writeFileSync(path.join(options.outputDir, 'franck-muller-admission-decisions.csv'), `${[headers.join(','), ...rows.map(row => headers.map(header => csvCell(row[header])).join(','))].join('\n')}\n`);
  const manifest = {
    mode: 'LOCAL_REVIEW_ONLY',
    forbidden_targets: ['watch_records', 'staging.listings', 'public release views'],
    source_file: path.basename(options.input),
    source_sha256: input.fileSha256,
    input_rows: input.sourceRows.length,
    decision_rows: input.decisionRows.length,
    missing_decisions: missingDecisionCount,
    extra_decisions: extraDecisionCount,
    decisions: counts,
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(options.outputDir, 'franck-muller-admission-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'complete', output_dir: options.outputDir, manifest }, null, 2)}\n`);
}

if (require.main === module) {
  try { run(); } catch (error) { process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`); process.exitCode = 1; }
}

module.exports = { SOURCE_HEADERS, DECISION_HEADERS, classifyRow, decisionRow, invalidReference, normalizeReference };

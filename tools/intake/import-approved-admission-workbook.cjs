'use strict';

// Strict admission-workbook importer for the existing service-only reviewed
// workbook inventory. Dry-run is the default. Apply mode is deliberately
// allowlisted, resumable, and never writes to watch_records or staging.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const { explicitIntent, extractPriceObservations } = require('../../api/_lib/normalization-v4.cjs');
const {
  SOURCE_HEADERS,
  DECISION_HEADERS,
  classifyRow,
  normalizeReference,
} = require('./prepare-franck-muller-admission.cjs');

const INVENTORY_TABLE = 'reviewed_workbook_inventory';
const CHECKPOINT_TABLE = 'reviewed_workbook_import_checkpoints';
const SOURCE_SHEET = 'Trading Floor & Price Research';
const OWNER_UNBUNDLED_BRANDS = new Set([
  'Blancpain',
  'Bulgari',
  'Chopard',
  'Girard-Perregaux',
  'Glashütte Original',
  'Grand Seiko',
  'H. Moser & Cie',
  'Jacob & Co',
  'Ulysse Nardin',
  'Zenith',
]);

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isoDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function requireHeaders(rows, required, sheetName) {
  const headers = Object.keys(rows[0] || {});
  const missing = required.filter(header => !headers.includes(header));
  if (missing.length) throw new Error(`${sheetName} is missing required headers: ${missing.join(', ')}`);
}

function readAdmissionWorkbook(filePath) {
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const decisionSheetName = workbook.SheetNames.find(
    name => name !== SOURCE_SHEET && /admission/i.test(name),
  );
  if (!workbook.Sheets[SOURCE_SHEET] || !decisionSheetName) {
    throw new Error(`required admission worksheets missing; found: ${workbook.SheetNames.join(', ')}`);
  }
  const sourceRows = XLSX.utils.sheet_to_json(workbook.Sheets[SOURCE_SHEET], {
    defval: null,
    raw: true,
  }).filter(row => Object.values(row).some(value => text(value)));
  const decisionRows = XLSX.utils.sheet_to_json(workbook.Sheets[decisionSheetName], {
    defval: null,
    raw: true,
  }).filter(row => Object.values(row).some(value => text(value)));
  requireHeaders(sourceRows, SOURCE_HEADERS, SOURCE_SHEET);
  requireHeaders(decisionRows, DECISION_HEADERS, decisionSheetName);
  const decisions = new Map();
  for (const decision of decisionRows) {
    const listingId = text(decision.listing_id);
    if (!listingId || decisions.has(listingId)) {
      throw new Error(`decision ledger has missing or duplicate listing_id: ${listingId || '(blank)'}`);
    }
    decisions.set(listingId, decision);
  }
  if (sourceRows.length !== decisionRows.length) {
    throw new Error(`source/decision row count mismatch: ${sourceRows.length}/${decisionRows.length}`);
  }
  return {
    fileSha256: sha256(buffer),
    sourceRows,
    decisions,
    decisionSheetName,
  };
}

function firstExactImage(value) {
  const candidates = text(value).split(/[\r\n,;|]+/).map(item => item.trim()).filter(Boolean);
  return candidates.find(item => /^https?:\/\/[^\s]+$/i.test(item)) || null;
}

function sourcePriceEvidence(source, options = {}) {
  const currency = text(source.source_currency).toUpperCase() || null;
  const normalizedUsd = Number(source.normalized_price_usd);
  const observations = extractPriceObservations(text(source.raw_message), {});
  const primary = observations.find(item => item.is_primary) || observations[0] || null;
  const sourceAmount = primary && Number(primary.amount_original) > 0
    ? Number(primary.amount_original)
    : null;
  const sourceText = text(source.asking_price_raw) || primary?.raw_price_text || null;
  if (options.rawExplicitUsdOnly) {
    const explicitUsd = observations.find(item => (
      ['USD', 'USDT'].includes(String(item.currency_original || '').toUpperCase())
      && Number(item.amount_original) > 0
      && item.currency_evidence === 'explicit_line_currency'
    )) || observations.find(item => (
      String(item.currency_original || '').toUpperCase() === 'USD'
      && Number(item.amount_original) > 0
      && item.currency_evidence === 'usd_defaulted_by_policy'
    ));
    if (explicitUsd) {
      return {
        workbookPriceUsd: Number(explicitUsd.amount_original),
        sourceAmount: Number(explicitUsd.amount_original),
        sourceText: explicitUsd.raw_price_text || null,
        currency: String(explicitUsd.currency_original).toUpperCase(),
        status: 'SOURCE_EXPLICIT_USD_MATCH',
        reextractedFromRaw: Number(normalizedUsd) !== Number(explicitUsd.amount_original),
      };
    }
    return {
      workbookPriceUsd: null,
      sourceAmount: null,
      sourceText: null,
      currency: null,
      status: 'PRICE_NOT_SUPPLIED',
      reextractedFromRaw: false,
    };
  }
  if (
    ['USD', 'USDT'].includes(currency)
    && sourceAmount !== null
    && Number.isFinite(normalizedUsd)
    && normalizedUsd > 0
    && Math.abs(sourceAmount - normalizedUsd) <= 0.01
    && primary?.currency_evidence === 'explicit_line_currency'
  ) {
    return {
      workbookPriceUsd: normalizedUsd,
      sourceAmount,
      sourceText,
      currency,
      status: 'SOURCE_EXPLICIT_USD_MATCH',
    };
  }
  if (
    currency
    && sourceAmount !== null
    && Number.isFinite(normalizedUsd)
    && normalizedUsd > 0
    && text(source.fx_source)
    && text(source.fx_rate_date)
  ) {
    return {
      workbookPriceUsd: normalizedUsd,
      sourceAmount,
      sourceText,
      currency,
      // The existing inventory schema has no named FX source/date columns.
      // Retain the normalized amount for review, but fail closed for analytics.
      status: 'DATED_FX_PROVENANCE_REQUIRES_EXISTING_SIDECAR',
    };
  }
  return {
    workbookPriceUsd: Number.isFinite(normalizedUsd) && normalizedUsd > 0 ? normalizedUsd : null,
    sourceAmount,
    sourceText,
    currency,
    status: sourceAmount === null ? 'PRICE_NOT_SUPPLIED' : 'PRICE_EVIDENCE_INCOMPLETE',
  };
}

function additionalImportReasons(source, options = {}) {
  const reasons = [];
  if (!isoDate(source.source_posted_at)) reasons.push('SOURCE_POSTING_TIME_INVALID');
  if (!options.allowNoImage && !firstExactImage(source.image_urls_source)) reasons.push('EXACT_SOURCE_IMAGE_URL_MISSING');
  return reasons;
}

function listingType(value) {
  const normalized = text(value).toUpperCase();
  return ['WTS', 'WTB'].includes(normalized) ? normalized : 'OTHER';
}

function strictReferenceFromRaw(rawMessage, brand) {
  const raw = text(rawMessage);
  const patterns = {
    'Glashütte Original': /\b(?:\d-)?\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\b/i,
    'H. Moser & Cie': /\b\d{4}-\d{4}\b/i,
    'Girard-Perregaux': /\b\d{5}-[A-Z0-9]+(?:-[A-Z0-9]+){1,3}\b/i,
    'Ulysse Nardin': /\b\d{3,4}-\d{2,4}(?:[-/][A-Z0-9]+){1,4}\b/i,
    Blancpain: /\b\d{4}(?:[- ][A-Z0-9]{2,6}){2,4}\b/i,
    Zenith: /\b\d{2}\.\d{4}\.\d{3,4}\/[0-9A-Z]+(?:\.[0-9A-Z]+)*\b/i,
    Bulgari: /\b10\d{4}\b/i,
    'Grand Seiko': /\b(?:SBGA|SBGC|SBGE|SBGH|SBGJ|SBGM|SBGP|SBGW|SLGA|SLGC|SLGH|STGF)[A-Z0-9]{2,6}\b/i,
    Chopard: /\b(?:16|17|20|27|83)\d{2,4}(?:-[A-Z0-9]+){0,3}\b/i,
    'Jacob & Co': /\b[A-Z]{1,4}\d{2,4}(?:\.[A-Z0-9]+){2,6}\b/i,
  };
  const match = raw.match(patterns[brand]);
  return match ? normalizeReference(match[0]) : null;
}

function classifyOwnerUnbundledRow(source, decision, expectedBrand) {
  const reasons = [];
  if (text(decision.final_brand) !== expectedBrand) reasons.push('BRAND_SCOPE_MISMATCH');
  if (text(source.category).toUpperCase() !== 'WATCH') reasons.push('NON_WATCH_ROUTE_LUXURY_RESEARCH');
  if (text(decision.identity_status) !== 'VERIFIED') reasons.push('IDENTITY_REVIEW_REQUIRED');
  if (text(decision.bundle_status) !== 'SINGLE_CANDIDATE') reasons.push('BUNDLE_PENDING_SEPARATION');
  if (text(decision.duplicate_decision) !== 'COUNT') reasons.push('REPOST_OR_DUPLICATE_EXCLUDED');
  if (text(decision.trading_floor_status).toUpperCase() !== 'PUBLISH') reasons.push('NOT_APPROVED_FOR_TRADING_FLOOR');
  if (!/\bUNBUNDLED_STANDALONE_PASSED\b/.test(text(decision.review_reason))) reasons.push('OWNER_UNBUNDLE_REVIEW_MISSING');
  if (!text(decision.final_model)) reasons.push('MODEL_UNRESOLVED');
  if (!text(source.listing_id) || !text(source.source_message_id) || !text(source.raw_message)) reasons.push('IMMUTABLE_SOURCE_LINEAGE_MISSING');
  if (!isoDate(source.source_posted_at)) reasons.push('SOURCE_POSTING_TIME_INVALID');
  if (!text(source.seller_source_id) || !text(source.seller_name_source)) reasons.push('SELLER_IDENTITY_MISSING');
  if (!['WTS', 'WTB'].includes(resolvedListingType(source, true))) reasons.push('LISTING_TYPE_UNRESOLVED');
  return { trading_floor_candidate: reasons.length === 0, price_research_candidate: false, reasons };
}

function resolvedListingType(source, ownerUnbundled) {
  if (ownerUnbundled) {
    const rawIntent = explicitIntent(text(source.raw_message));
    if (rawIntent === 'WTS' || rawIntent === 'WTB') return rawIntent;
    if (/\b(?:ISO|LTB|looking\s+for|want(?:ed)?|need)\b/i.test(text(source.raw_message))) return 'WTB';
  }
  return listingType(source.intent);
}

function rowForImport({ source, decision, expectedBrand, fileName, fileSha256, rowNumber, runId, ownerUnbundled = false }) {
  const admission = ownerUnbundled
    ? classifyOwnerUnbundledRow(source, decision, expectedBrand)
    : classifyRow(source, decision, expectedBrand);
  if (!admission.trading_floor_candidate
    || additionalImportReasons(source, { allowNoImage: ownerUnbundled }).length) return null;
  const rawMessage = text(source.raw_message);
  const listingId = text(source.listing_id);
  const sourceMessageId = text(source.source_message_id);
  const reference = ownerUnbundled
    ? strictReferenceFromRaw(rawMessage, expectedBrand)
    : normalizeReference(decision.final_reference);
  const image = ownerUnbundled ? null : firstExactImage(source.image_urls_source);
  const resolvedType = resolvedListingType(source, ownerUnbundled);
  const extractedPrice = sourcePriceEvidence(source, { rawExplicitUsdOnly: ownerUnbundled });
  const priceResearchCandidate = ownerUnbundled
    ? resolvedType === 'WTS' && extractedPrice.status === 'SOURCE_EXPLICIT_USD_MATCH' && Boolean(reference)
    : admission.price_research_candidate;
  const price = priceResearchCandidate
    ? extractedPrice
    : resolvedType !== 'WTS'
      ? {
        workbookPriceUsd: null,
        sourceAmount: null,
        sourceText: null,
        currency: null,
        status: 'PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE',
        reextractedFromRaw: false,
      }
    : {
      ...extractedPrice,
      status: extractedPrice.status === 'PRICE_NOT_SUPPLIED'
        ? extractedPrice.status
        : 'PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE',
    };
  const contentHash = sha256([
    expectedBrand,
    listingId,
    sourceMessageId,
    rawMessage,
    reference,
  ].join('|'));
  return {
    id: `admission_${contentHash}`,
    content_hash: contentHash,
    import_run_id: runId,
    source_file: fileName,
    source_file_sha256: fileSha256,
    source_worksheet: SOURCE_SHEET,
    source_row_number: rowNumber,
    source_record_id: listingId,
    source_payload_sha256: sha256(JSON.stringify({ source, decision })),
    posting_date: isoDate(source.source_posted_at),
    posted_by: text(source.seller_name_source) || null,
    phone_number: null,
    raw_message: rawMessage,
    listing_type: resolvedType,
    brand_scope: expectedBrand,
    supplied_brand: expectedBrand,
    canonical_brand: expectedBrand,
    model: text(decision.final_model),
    raw_reference: text(source.source_reference_text) || reference,
    normalized_reference: reference,
    catalog_reference: reference,
    catalog_model: text(decision.final_model),
    dial_color: text(decision.dial_normalized) || null,
    catalog_dial: text(decision.dial_normalized) || null,
    condition: text(source.source_condition_text) || null,
    workbook_price_usd: price.workbookPriceUsd,
    source_price_amount: price.sourceAmount,
    source_price_text: price.sourceText,
    source_currency: price.currency,
    price_evidence_status: price.status,
    verification_tier: ownerUnbundled ? 'OWNER_UNBUNDLED_ADMISSION_LEDGER' : 'OWNER_ADMISSION_LEDGER',
    confidence: 100,
    verification_status: 'APPROVED_SINGLE_CANDIDATE',
    user_image_url: image,
    catalog_image_url: null,
    final_image_url: image,
    display_image_url: image,
    image_evidence_type: image ? 'SELLER_LISTING_IMAGE' : null,
    review_reasons: [
      ...(ownerUnbundled && !image ? ['UNBUNDLED_CHILD_NO_IMAGE_APPROVED'] : []),
      ...(ownerUnbundled && !reference ? ['EXACT_REFERENCE_NOT_RECOVERED_FROM_CHILD_RAW'] : []),
      ...(price.status === 'SOURCE_EXPLICIT_USD_MATCH' ? [] : [price.status]),
      ...(price.reextractedFromRaw ? ['RAW_USD_REEXTRACTED_OVERRIDES_WORKBOOK_VALUE'] : []),
    ],
    contact_publication_approved: false,
    contact_publication_basis: null,
    updated_at: new Date().toISOString(),
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    values[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!values.input || !values.brand) throw new Error('--input and --brand are required');
  const maxRows = Number.parseInt(values['max-rows'] || '0', 10);
  const batchSize = Number.parseInt(values['batch-size'] || '100', 10);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error('--batch-size must be 1 through 500');
  }
  return {
    input: path.resolve(values.input),
    brand: text(values.brand),
    outputDir: path.resolve(values['output-dir'] || path.join(
      'audit-output', `approved-admission-canary-${Date.now()}`,
    )),
    maxRows: Number.isInteger(maxRows) && maxRows > 0 ? maxRows : null,
    batchSize,
    runId: text(values['run-id']) || `approved_admission_${Date.now()}`,
    ownerUnbundled: values['unbundled-no-image'] === 'true',
    apply: process.env.APPLY_APPROVED_ADMISSION_IMPORT === 'true',
  };
}

async function upsertBatch(client, rows) {
  const { data, error } = await client
    .from(INVENTORY_TABLE)
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    .select('id');
  if (error) throw error;
  return (data || []).length;
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.ownerUnbundled && !OWNER_UNBUNDLED_BRANDS.has(options.brand)) {
    throw new Error(`--unbundled-no-image is not allowlisted for ${options.brand}`);
  }
  const workbook = readAdmissionWorkbook(options.input);
  const fileName = path.basename(options.input);
  const candidates = [];
  const heldReasons = {};
  const analyticsHeldReasons = {};
  let missingDecisions = 0;
  workbook.sourceRows.forEach((source, index) => {
    const decision = workbook.decisions.get(text(source.listing_id));
    if (!decision) {
      missingDecisions += 1;
      return;
    }
    const admission = options.ownerUnbundled
      ? classifyOwnerUnbundledRow(source, decision, options.brand)
      : classifyRow(source, decision, options.brand);
    const priceOnlyReasons = admission.reasons.filter(
      reason => reason === 'PRICE_RESEARCH_EVIDENCE_INCOMPLETE',
    );
    for (const reason of priceOnlyReasons) {
      analyticsHeldReasons[reason] = (analyticsHeldReasons[reason] || 0) + 1;
    }
    const importReasons = [
      ...admission.reasons.filter(reason => reason !== 'PRICE_RESEARCH_EVIDENCE_INCOMPLETE'),
      ...additionalImportReasons(source, { allowNoImage: options.ownerUnbundled }),
    ];
    if (!admission.trading_floor_candidate || importReasons.length) {
      for (const reason of importReasons) heldReasons[reason] = (heldReasons[reason] || 0) + 1;
      return;
    }
    candidates.push(rowForImport({
      source,
      decision,
      expectedBrand: options.brand,
      fileName,
      fileSha256: workbook.fileSha256,
      rowNumber: index + 2,
      runId: options.runId,
      ownerUnbundled: options.ownerUnbundled,
    }));
  });
  const uniqueCandidates = [...new Map(candidates.map(row => [row.id, row])).values()];
  if (uniqueCandidates.length !== candidates.length) {
    throw new Error('strict candidate IDs are not unique');
  }
  const limit = options.maxRows || uniqueCandidates.length;
  const selected = uniqueCandidates.slice(0, limit);
  let resumeAt = 0;
  let inserted = 0;
  let duplicates = 0;
  let client = null;
  if (options.apply) {
    if (process.env.REVIEWED_WORKBOOK_INVENTORY_TABLE !== INVENTORY_TABLE) {
      throw new Error(`REVIEWED_WORKBOOK_INVENTORY_TABLE must equal ${INVENTORY_TABLE}`);
    }
    if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)) {
      throw new Error('Supabase server credentials are required for apply mode');
    }
    client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
      { auth: { persistSession: false } },
    );
    const { data: checkpoint, error } = await client.from(CHECKPOINT_TABLE)
      .select('rows_scanned,rows_inserted,rows_duplicate_held,rows_errors')
      .eq('source_file_sha256', workbook.fileSha256)
      .maybeSingle();
    if (error) throw error;
    resumeAt = Math.min(Number(checkpoint?.rows_scanned || 0), selected.length);
    inserted = Number(checkpoint?.rows_inserted || 0);
    duplicates = Number(checkpoint?.rows_duplicate_held || 0);
  }
  for (let start = resumeAt; start < selected.length; start += options.batchSize) {
    const batch = selected.slice(start, start + options.batchSize);
    if (options.apply) {
      const batchInserted = await upsertBatch(client, batch);
      inserted += batchInserted;
      duplicates += batch.length - batchInserted;
      const scanned = start + batch.length;
      const { error } = await client.from(CHECKPOINT_TABLE).upsert({
        source_file_sha256: workbook.fileSha256,
        import_run_id: options.runId,
        source_file: fileName,
        brand_scope: options.brand,
        expected_rows: uniqueCandidates.length,
        rows_scanned: scanned,
        rows_inserted: inserted,
        rows_duplicate_held: duplicates,
        rows_errors: 0,
        status: scanned === uniqueCandidates.length ? 'COMPLETE' : 'RUNNING',
        started_at: new Date().toISOString(),
        completed_at: scanned === uniqueCandidates.length ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'source_file_sha256' });
      if (error) throw error;
    }
  }
  const priceReady = uniqueCandidates.filter(
    row => row.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH' && row.listing_type === 'WTS',
  ).length;
  const selectedPriceReady = selected.filter(
    row => row.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH' && row.listing_type === 'WTS',
  ).length;
  const report = {
    mode: options.apply ? 'SERVICE_ONLY_APPLY' : 'LOCAL_DRY_RUN',
    source_file: fileName,
    source_sha256: workbook.fileSha256,
    expected_brand: options.brand,
    source_rows: workbook.sourceRows.length,
    strict_trading_floor_candidates: uniqueCandidates.length,
    selected_rows: selected.length,
    strict_price_research_candidates_supported_by_current_schema: priceReady,
    selected_price_research_candidates_supported_by_current_schema: selectedPriceReady,
    held_rows: workbook.sourceRows.length - uniqueCandidates.length,
    held_reasons: heldReasons,
    price_research_held_reasons: analyticsHeldReasons,
    missing_decisions: missingDecisions,
    contact_publication_approved_rows: selected.filter(row => row.contact_publication_approved).length,
    bundle_rows_selected: selected.filter(row => /BUNDLE|MULTI/i.test(row.listing_type)).length,
    unbundled_no_image_policy: options.ownerUnbundled,
    rows_with_images: selected.filter(row => row.final_image_url).length,
    rows_with_exact_raw_usd: selected.filter(row => row.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH').length,
    rows_without_exact_reference: selected.filter(row => !row.normalized_reference).length,
    target_table: options.apply ? INVENTORY_TABLE : null,
    forbidden_targets: ['watch_records', 'staging.listings', 'public release views'],
    database_writes: options.apply ? inserted : 0,
    blockers: [
      'reviewed_workbook_market_source_v2 currently projects staging.listings, not reviewed_workbook_inventory',
      'reviewed_workbook_inventory has no named FX source/date columns; non-USD rows fail closed for analytics',
    ],
  };
  fs.mkdirSync(options.outputDir, { recursive: true });
  fs.writeFileSync(path.join(options.outputDir, 'canary-manifest.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CHECKPOINT_TABLE,
  INVENTORY_TABLE,
  OWNER_UNBUNDLED_BRANDS,
  firstExactImage,
  additionalImportReasons,
  classifyOwnerUnbundledRow,
  listingType,
  readAdmissionWorkbook,
  rowForImport,
  run,
  sourcePriceEvidence,
  strictReferenceFromRaw,
};

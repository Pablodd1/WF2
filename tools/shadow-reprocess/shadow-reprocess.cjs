'use strict';

const { segmentDealerMessage } = require('../../api/_lib/normalization-v4.cjs');

const VERSION = 'v4.0-context';

function normalizeText(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s.-]/g, '');
}

function sourcePriceObservation(record) {
  const amount = Number(record.price_raw);
  const currency = String(record.currency || '').trim().toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0 || !currency) return null;
  const amountUsd = Number(record.price_usd);
  return {
    price_type: 'ASK_PRICE',
    amount_original: amount,
    currency_original: currency,
    amount_usd: Number.isFinite(amountUsd) && amountUsd > 0 ? amountUsd : null,
    is_primary: true,
    raw_price_text: null,
    confidence: null,
    // This preserves an already structured source value. It is intentionally
    // not parser evidence and cannot unlock automatic promotion by itself.
    currency_evidence: 'source_record',
  };
}

function analyzeRecord(record) {
  const candidates = segmentDealerMessage(record.raw_message || '');
  const proposed = candidates.map(candidate => {
    const parsedPrices = candidate.prices || [];
    const retainedSourcePrice = parsedPrices.length ? null : sourcePriceObservation(record);
    const prices = retainedSourcePrice ? [retainedSourcePrice] : parsedPrices;
    const primary = prices.find(price => price.is_primary) || prices[0] || null;
    return {
      raw_line: candidate.rawLine,
      brand: candidate.context.brand_context || null,
      reference: candidate.reference || null,
      listing_type: candidate.context.intent_context || 'WTS',
      condition: candidate.context.condition_context || null,
      set_status: candidate.context.set_status_context || null,
      listing_status: candidate.context.listing_status_context || null,
      price_raw: primary?.amount_original || null,
      price_usd: primary?.amount_usd || null,
      currency: primary?.currency_original || null,
      currency_evidence: primary?.currency_evidence || null,
      prices,
    };
  });

  const flags = new Set();
  if (proposed.length === 0) flags.add('NO_CANDIDATE');
  if (proposed.length > 1) flags.add('BUNDLE_SPLIT_REQUIRED');
  if (proposed.length === 1) {
    const next = proposed[0];
    if (next.brand && normalizeText(next.brand) !== normalizeText(record.brand)) flags.add('BRAND_CHANGED');
    if (next.reference && normalizeText(next.reference) !== normalizeText(record.reference)) flags.add('REFERENCE_CHANGED');
    if (next.currency && normalizeText(next.currency) !== normalizeText(record.currency)) flags.add('CURRENCY_CHANGED');
    if (next.listing_type && normalizeText(next.listing_type) !== normalizeText(record.listing_type)) flags.add('INTENT_CHANGED');
    if (next.price_raw && Number(next.price_raw) !== Number(record.price_raw || 0)) flags.add('PRICE_CHANGED');

    // A bare dollar amount without message or section currency context is not
    // safe to preserve as USD. Keep it out of automatic approval even when an
    // older parser already supplied a numeric price or currency.
    const priceCameFromText = next.prices.some(price => price.currency_evidence !== 'source_record');
    if (!priceCameFromText && /\$\s*\d/.test(next.raw_line) && !/(?:US\$|U\$|HK\$)/i.test(next.raw_line)) {
      flags.add('CURRENCY_AMBIGUOUS');
    }
    if (!next.price_raw && record.price_raw != null) flags.add('PRICE_PARSE_FAILED');
  }
  const changeFlags = [...flags];

  return {
    source_record_id: record.id,
    normalization_version: VERSION,
    source_parser_version: record.parser_version || null,
    source_brand: record.brand || null,
    source_reference: record.reference || null,
    source_price_raw: record.price_raw || null,
    source_price_usd: record.price_usd || null,
    source_currency: record.currency || null,
    source_listing_type: record.listing_type || null,
    candidate_count: proposed.length,
    proposed_candidates: proposed,
    change_flags: changeFlags,
    review_status: changeFlags.length ? 'PENDING' : 'NO_CHANGE',
    analyzed_at: new Date().toISOString(),
  };
}

async function apiFetch(baseUrl, key, path, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function run() {
  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) throw new Error('SUPABASE_URL and a server key are required');

  const jobName = process.env.JOB_NAME || 'normalization-v4-production';
  const batchSize = Math.max(10, Math.min(Number(process.env.BATCH_SIZE || 250), 1000));
  const maxRows = Math.max(1, Number(process.env.MAX_ROWS || 10000));
  const dryRun = String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';

  const checkpoints = await apiFetch(baseUrl, key,
    `normalization_shadow_checkpoints?job_name=eq.${encodeURIComponent(jobName)}&select=last_source_record_id,rows_analyzed&limit=1`);
  let lastId = checkpoints?.[0]?.last_source_record_id || '';
  let total = 0;

  while (total < maxRows) {
    const limit = Math.min(batchSize, maxRows - total);
    const params = new URLSearchParams({
      select: 'id,raw_message,brand,reference,price_raw,price_usd,currency,listing_type,parser_version',
      raw_message: 'not.is.null',
      order: 'id.asc',
      limit: String(limit),
    });
    if (lastId) params.set('id', `gt.${lastId}`);

    const records = await apiFetch(baseUrl, key, `watch_records?${params.toString()}`);
    if (!records?.length) break;
    const shadowRows = records.map(analyzeRecord);
    lastId = records[records.length - 1].id;
    total += records.length;

    if (!dryRun) {
      await apiFetch(baseUrl, key, 'normalization_shadow_v4?on_conflict=source_record_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(shadowRows),
      });
      await apiFetch(baseUrl, key, 'normalization_shadow_checkpoints?on_conflict=job_name', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{
          job_name: jobName,
          last_source_record_id: lastId,
          rows_analyzed: (checkpoints?.[0]?.rows_analyzed || 0) + total,
          updated_at: new Date().toISOString(),
        }]),
      });
    }

    const changed = shadowRows.filter(row => row.change_flags.length > 0).length;
    console.log(JSON.stringify({ total, batch: records.length, changed, lastId, dryRun }));
  }
}

if (require.main === module) {
  run().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { analyzeRecord };


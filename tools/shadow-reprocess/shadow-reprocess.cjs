'use strict';

const { segmentDealerMessage } = require('../../api/_lib/normalization-v4.cjs');

const VERSION = 'v4.0-context';

function normalizeText(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s.-]/g, '');
}

function analyzeRecord(record) {
  const candidates = segmentDealerMessage(record.raw_message || '');
  const proposed = candidates.map(candidate => {
    const primary = candidate.prices.find(price => price.is_primary) || candidate.prices[0] || null;
    return {
      raw_line: candidate.rawLine,
      brand: candidate.context.brand_context || null,
      reference: candidate.reference || null,
      listing_type: candidate.context.intent_context || 'WTS',
      price_raw: primary?.amount_original || null,
      price_usd: primary?.amount_usd || null,
      currency: primary?.currency_original || null,
      currency_evidence: primary?.currency_evidence || null,
      prices: candidate.prices,
    };
  });

  const flags = [];
  if (proposed.length === 0) flags.push('NO_CANDIDATE');
  if (proposed.length > 1) flags.push('BUNDLE_SPLIT_REQUIRED');
  if (proposed.length === 1) {
    const next = proposed[0];
    if (next.brand && normalizeText(next.brand) !== normalizeText(record.brand)) flags.push('BRAND_CHANGED');
    if (next.reference && normalizeText(next.reference) !== normalizeText(record.reference)) flags.push('REFERENCE_CHANGED');
    if (next.currency && normalizeText(next.currency) !== normalizeText(record.currency)) flags.push('CURRENCY_CHANGED');
    if (next.listing_type && normalizeText(next.listing_type) !== normalizeText(record.listing_type)) flags.push('INTENT_CHANGED');
    if (next.price_raw && Number(next.price_raw) !== Number(record.price_raw || 0)) flags.push('PRICE_CHANGED');
  }

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
    change_flags: flags,
    review_status: flags.length ? 'PENDING' : 'NO_CHANGE',
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


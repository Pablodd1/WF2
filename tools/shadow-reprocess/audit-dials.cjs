'use strict';

const { analyzeRecord } = require('./shadow-reprocess.cjs');

const baseUrl = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const maxRows = Math.max(1, Math.min(Number(process.env.DIAL_AUDIT_MAX_ROWS || 5000), 25000));
const batchSize = Math.max(50, Math.min(Number(process.env.DIAL_AUDIT_BATCH_SIZE || 500), 1000));

if (!baseUrl || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

async function rest(path) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

async function run() {
  let lastId = '';
  let processed = 0;
  const evidence = {};
  const flags = {};
  const examples = [];

  while (processed < maxRows) {
    const params = new URLSearchParams({
      select: 'id,raw_message,brand,reference,price_raw,price_usd,currency,listing_type,dial_color,parser_version',
      raw_message: 'not.is.null',
      or: '(dial_color.is.null,dial_color.eq.Unknown,dial_color.eq.UNKNOWN,dial_color.eq.Unspecified,dial_color.eq.N/A,dial_color.eq.NA)',
      order: 'id.asc',
      limit: String(Math.min(batchSize, maxRows - processed)),
    });
    if (lastId) params.set('id', `gt.${lastId}`);
    const rows = await rest(`watch_records?${params.toString()}`);
    if (!rows.length) break;

    for (const row of rows) {
      const result = analyzeRecord(row);
      const candidate = result.candidate_count === 1 ? result.proposed_candidates[0] : null;
      const evidenceKey = candidate?.dial_evidence || 'unresolved';
      evidence[evidenceKey] = (evidence[evidenceKey] || 0) + 1;
      for (const flag of result.change_flags) flags[flag] = (flags[flag] || 0) + 1;
      if (examples.length < 25 && (candidate?.dial_color || candidate?.dial_ambiguous)) {
        examples.push({
          id: row.id,
          brand: row.brand,
          reference: row.reference,
          source_dial: row.dial_color,
          proposed_dial: candidate?.dial_color || null,
          evidence: candidate?.dial_evidence || null,
          reason: candidate?.dial_reason || null,
          flags: result.change_flags.filter(flag => flag.startsWith('DIAL_')),
        });
      }
    }
    processed += rows.length;
    lastId = rows[rows.length - 1].id;
    console.log(JSON.stringify({ event: 'dial_audit_batch', processed, lastId }));
  }

  console.log(JSON.stringify({
    event: 'dial_audit_complete',
    sampled: processed,
    evidence,
    dialChanged: flags.DIAL_CHANGED || 0,
    dialAmbiguous: flags.DIAL_AMBIGUOUS || 0,
    examples,
  }, null, 2));
}

run().catch(error => {
  console.error(JSON.stringify({ event: 'dial_audit_error', error: error.message }));
  process.exitCode = 1;
});

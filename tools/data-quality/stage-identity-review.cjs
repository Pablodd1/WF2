'use strict';

const { confirmCatalogCandidate } = require('../../api/_lib/catalog-confirmation.cjs');
const { boundedInt, supabaseFetch } = require('./recovery-control.cjs');

const APPLY = process.env.APPLY_IDENTITY_STAGE === 'true';
const SCOPE = String(process.env.IDENTITY_SCOPE || 'RM_CONFLICTS').toUpperCase();
if (!['RM_CONFLICTS', 'ALL'].includes(SCOPE)) {
  throw new Error('IDENTITY_SCOPE must be RM_CONFLICTS or ALL');
}
const LIMIT = boundedInt(process.env.IDENTITY_BATCH_SIZE, 100, 1, 1000);
const MAX_BATCHES = boundedInt(process.env.IDENTITY_MAX_BATCHES, 1, 1, 100);
const JOB_NAME = `identity-stage:${SCOPE.toLowerCase()}`;

function classifyIdentity(record) {
  const confirmation = confirmCatalogCandidate(record);
  const brandConflict = confirmation.reason === 'CATALOG_BRAND_CONFLICT';
  const dialConflict = confirmation.confirmed && confirmation.dialConfirmed === false;
  let status = 'UNVERIFIED';
  if (brandConflict || dialConflict) status = 'CONFLICT';
  else if (confirmation.confirmed) status = 'CATALOG_CONFIRMED';

  return {
    record_id: record.record_id || record.id,
    status,
    canonical_brand: confirmation.match?.brand || null,
    canonical_model: confirmation.match?.model || null,
    canonical_reference: confirmation.match?.reference || null,
    canonical_dial_color: confirmation.dialConfirmed ? record.dial_color || null : null,
    evidence: {
      source: 'deterministic_catalog_confirmation',
      reason: confirmation.reason || null,
      dial_confirmed: confirmation.dialConfirmed ?? null,
      source_brand: record.brand || null,
      source_model: record.model || null,
      source_reference: record.reference || null,
      source_dial_color: record.dial_color || null,
    },
  };
}

async function checkpoint() {
  const query = new URLSearchParams({
    select: 'last_record_id,rows_scanned,rows_written',
    job_name: `eq.${JOB_NAME}`,
    limit: '1',
  });
  const rows = await supabaseFetch(`/rest/v1/data_quality_remediation_checkpoints?${query}`);
  return rows?.[0] || { last_record_id: null, rows_scanned: 0, rows_written: 0 };
}

async function sourceRows(lastRecordId) {
  const table = SCOPE === 'RM_CONFLICTS' ? 'rm_identity_review_queue' : 'watch_records';
  const select = SCOPE === 'RM_CONFLICTS'
    ? 'record_id,brand,model,reference,dial_color'
    : 'id,brand,model,reference,dial_color';
  const query = new URLSearchParams({
    select,
    order: SCOPE === 'RM_CONFLICTS' ? 'record_id.asc' : 'id.asc',
    limit: String(LIMIT),
  });
  if (lastRecordId) query.set(SCOPE === 'RM_CONFLICTS' ? 'record_id' : 'id', `gt.${lastRecordId}`);
  return supabaseFetch(`/rest/v1/${table}?${query}`);
}

async function applyRows(rows, previous) {
  let result = { written: 0, human_decisions_preserved: 0 };
  if (rows.length) {
    result = await supabaseFetch('/rest/v1/rpc/stage_listing_identity_classifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_rows: rows }),
    });
  }
  const lastRecordId = rows.at(-1)?.record_id || previous.last_record_id;
  await supabaseFetch('/rest/v1/data_quality_remediation_checkpoints?on_conflict=job_name', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      job_name: JOB_NAME,
      last_record_id: lastRecordId,
      rows_scanned: Number(previous.rows_scanned || 0) + rows.length,
      rows_written: Number(previous.rows_written || 0) + Number(result?.written || 0),
      metadata: {
        scope: SCOPE,
        batch_size: LIMIT,
        last_batch_ids: rows.map(row => row.record_id),
        human_decisions_preserved: Number(result?.human_decisions_preserved || 0),
      },
      updated_at: new Date().toISOString(),
    }),
  });
  return result;
}

async function run() {
  let previous = await checkpoint();
  let processed = 0;
  let firstRecordId = null;
  let lastRecordId = null;
  const counts = {};
  const batches = APPLY ? MAX_BATCHES : 1;
  for (let batch = 0; batch < batches; batch += 1) {
    const source = await sourceRows(previous.last_record_id);
    const classified = source.map(classifyIdentity);
    if (!classified.length) break;
    firstRecordId ||= classified[0].record_id;
    lastRecordId = classified.at(-1).record_id;
    processed += classified.length;
    for (const row of classified) counts[row.status] = (counts[row.status] || 0) + 1;
    if (APPLY) {
      const result = await applyRows(classified, previous);
      previous = {
        last_record_id: lastRecordId,
        rows_scanned: Number(previous.rows_scanned || 0) + classified.length,
        rows_written: Number(previous.rows_written || 0) + Number(result?.written || 0),
      };
    }
    if (classified.length < LIMIT) break;
  }
  process.stdout.write(`${JSON.stringify({
    event: 'identity_review_batch',
    dry_run: !APPLY,
    scope: SCOPE,
    processed,
    batches: APPLY ? MAX_BATCHES : 1,
    counts,
    first_record_id: firstRecordId,
    last_record_id: lastRecordId,
    checkpoint: previous,
  }, null, 2)}\n`);
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'identity_review_batch_error',
      scope: SCOPE,
      error: error.message,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { classifyIdentity };

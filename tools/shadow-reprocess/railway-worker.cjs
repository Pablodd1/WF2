'use strict';

// Long-running, single-concurrency worker for Railway/Render. It processes
// only shadow proposals and uses a Postgres lease so it cannot race Vercel.

const { randomUUID } = require('node:crypto');
const { analyzeRecord } = require('./shadow-reprocess.cjs');

const baseUrl = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const jobName = process.env.SHADOW_JOB_NAME || 'normalization-v4-production';
const batchSize = Math.max(100, Math.min(Number(process.env.SHADOW_BATCH_SIZE || 1000), 5000));
const rowsPerLease = Math.max(batchSize, Number(process.env.SHADOW_ROWS_PER_LEASE || 10000));
const idleDelayMs = Math.max(1000, Number(process.env.SHADOW_IDLE_DELAY_MS || 15000));
const workerMode = String(process.env.SHADOW_WORKER_MODE || 'cursor').trim().toLowerCase();
const holder = `railway:${process.env.RAILWAY_DEPLOYMENT_ID || process.env.HOSTNAME || 'worker'}:${process.pid}:${randomUUID()}`;

if (!baseUrl || !key) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

if (!['cursor', 'queue'].includes(workerMode)) {
  throw new Error('SHADOW_WORKER_MODE must be cursor or queue');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function rest(path, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function callRpc(name, payload) {
  return rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(payload) });
}

async function acquireLease() {
  return callRpc('acquire_normalization_worker_lease', {
    p_job_name: jobName,
    p_holder: holder,
    p_lease_seconds: 900,
  });
}

async function releaseLease() {
  try {
    await callRpc('release_normalization_worker_lease', { p_job_name: jobName, p_holder: holder });
  } catch (error) {
    console.error(JSON.stringify({ event: 'lease_release_failed', error: error.message }));
  }
}

async function releaseQueueWork(sourceRecordIds, error) {
  if (!sourceRecordIds.length) return;
  try {
    await callRpc('release_normalization_shadow_work', {
      p_holder: holder,
      p_source_record_ids: sourceRecordIds,
      p_error: error.message || String(error),
      p_retry_seconds: 60,
      p_max_attempts: 8,
    });
  } catch (releaseError) {
    console.error(JSON.stringify({ event: 'queue_release_failed', error: releaseError.message }));
  }
}

async function runQueueLease() {
  let processed = 0;
  let changed = 0;

  while (processed < rowsPerLease) {
    const limit = Math.min(batchSize, rowsPerLease - processed);
    const records = await callRpc('claim_normalization_shadow_work', {
      p_holder: holder,
      p_limit: limit,
      p_lease_seconds: 900,
    });
    if (!records?.length) return { processed, changed, complete: true, queue: true };

    const sourceRecordIds = records.map(record => record.id);
    try {
      const shadowRows = records.map(analyzeRecord);
      await rest('normalization_shadow_v4?on_conflict=source_record_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(shadowRows),
      });
      const completed = await callRpc('complete_normalization_shadow_work', {
        p_holder: holder,
        p_source_record_ids: sourceRecordIds,
      });
      if (Number(completed) !== sourceRecordIds.length) {
        throw new Error(`Queue completion mismatch: expected ${sourceRecordIds.length}, completed ${completed}`);
      }
      processed += records.length;
      changed += shadowRows.filter(row => row.change_flags.length > 0).length;
    } catch (error) {
      await releaseQueueWork(sourceRecordIds, error);
      throw error;
    }
  }

  return { processed, changed, complete: false, queue: true };
}

async function runLease() {
  const checkpoints = await rest(
    `normalization_shadow_checkpoints?job_name=eq.${encodeURIComponent(jobName)}&select=last_source_record_id,rows_analyzed&limit=1`,
  );
  const checkpoint = checkpoints?.[0] || {};
  let lastId = checkpoint.last_source_record_id || '';
  let processed = 0;
  let changed = 0;

  while (processed < rowsPerLease) {
    const limit = Math.min(batchSize, rowsPerLease - processed);
    const params = new URLSearchParams({
      select: 'id,raw_message,brand,reference,price_raw,price_usd,currency,listing_type,dial_color,parser_version',
      raw_message: 'not.is.null',
      order: 'id.asc',
      limit: String(limit),
    });
    if (lastId) params.set('id', `gt.${lastId}`);
    const records = await rest(`watch_records?${params.toString()}`);
    if (!records?.length) return { processed, changed, complete: true, lastId };

    const shadowRows = records.map(analyzeRecord);
    lastId = records[records.length - 1].id;
    processed += records.length;
    changed += shadowRows.filter(row => row.change_flags.length > 0).length;

    await rest('normalization_shadow_v4?on_conflict=source_record_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(shadowRows),
    });
    await rest('normalization_shadow_checkpoints?on_conflict=job_name', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{
        job_name: jobName,
        last_source_record_id: lastId,
        rows_analyzed: Number(checkpoint.rows_analyzed || 0) + processed,
        updated_at: new Date().toISOString(),
      }]),
    });
  }

  return { processed, changed, complete: false, lastId };
}

async function main() {
  console.log(JSON.stringify({ event: 'worker_started', jobName, workerMode, batchSize, rowsPerLease, holder }));
  do {
    try {
      const acquired = await acquireLease();
      if (!acquired) {
        console.log(JSON.stringify({ event: 'lease_busy', jobName }));
        await sleep(idleDelayMs);
        continue;
      }
      try {
        const result = workerMode === 'queue' ? await runQueueLease() : await runLease();
        console.log(JSON.stringify({ event: 'lease_complete', jobName, workerMode, ...result }));
        await sleep(result.complete ? idleDelayMs : 250);
      } finally {
        await releaseLease();
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'worker_error', jobName, error: error.message }));
      await sleep(idleDelayMs);
    }
  } while (String(process.env.SHADOW_WORKER_ONCE || '').toLowerCase() !== 'true');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

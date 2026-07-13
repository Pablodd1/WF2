'use strict';

const { analyzeRecord } = require('../tools/shadow-reprocess/shadow-reprocess.cjs');

const DEFAULT_JOB_NAME = 'normalization-v4-production';
// A bounded batch keeps the archive scan resumable within Vercel's function
// budget while making enough progress for a production cron schedule.
const BATCH_SIZE = 1000;

function getJobName(req, operatorAuthorized) {
  const requested = operatorAuthorized ? String(req.query?.job || '').trim() : '';
  // Run names only control an additive checkpoint. They cannot alter tables,
  // SQL, or the source query.
  if (requested && /^normalization-v4-[a-z0-9-]{1,60}$/.test(requested)) return requested;
  return DEFAULT_JOB_NAME;
}

async function rest(baseUrl, key, path, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const cronSecret = process.env.CRON_SECRET;
  const runToken = process.env.SHADOW_RUN_TOKEN;
  const cronAuthorized = Boolean(cronSecret) && req.headers.authorization === `Bearer ${cronSecret}`;
  const operatorAuthorized = Boolean(runToken) && req.headers['x-shadow-token'] === runToken;
  if (!cronAuthorized && !operatorAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) return res.status(503).json({ error: 'Supabase server configuration missing' });
  const jobName = getJobName(req, operatorAuthorized);

  try {
    let schemaReady = true;
    try {
      // The additive migration is the only supported schema owner. Probe it
      // through Supabase REST; never run DDL from a production request.
      await rest(baseUrl, key, 'normalization_shadow_checkpoints?select=job_name&limit=1');
    } catch (error) {
      schemaReady = false;
      console.warn('[shadow-normalize] shadow schema unavailable; running read-only sample', error.message);
    }
    const checkpoints = schemaReady
      ? await rest(
        baseUrl,
        key,
        `normalization_shadow_checkpoints?job_name=eq.${encodeURIComponent(jobName)}&select=last_source_record_id,rows_analyzed&limit=1`,
      )
      : [];
    const checkpoint = checkpoints?.[0] || {};
    const params = new URLSearchParams({
      select: 'id,raw_message,brand,reference,price_raw,price_usd,currency,listing_type,parser_version',
      raw_message: 'not.is.null',
      order: 'id.asc',
      limit: String(BATCH_SIZE),
    });
    const requestedAfter = operatorAuthorized ? String(req.query?.after || '').trim() : '';
    const afterId = requestedAfter || checkpoint.last_source_record_id;
    if (afterId) params.set('id', `gt.${afterId}`);

    const records = await rest(baseUrl, key, `watch_records?${params.toString()}`);
    if (!records?.length) {
      return res.status(200).json({ status: 'complete', rowsAnalyzed: checkpoint.rows_analyzed || 0 });
    }

    const shadowRows = records.map(analyzeRecord);
    const lastId = records[records.length - 1].id;
    if (!schemaReady) {
      const flagCounts = {};
      for (const row of shadowRows) {
        for (const flag of row.change_flags) flagCounts[flag] = (flagCounts[flag] || 0) + 1;
      }
      return res.status(200).json({
        status: 'dry_run_only',
        batch: records.length,
        changed: shadowRows.filter(row => row.change_flags.length > 0).length,
        flagCounts,
        nextAfter: lastId,
        persisted: false,
      });
    }
    await rest(baseUrl, key, 'normalization_shadow_v4?on_conflict=source_record_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(shadowRows),
    });
    const rowsAnalyzed = Number(checkpoint.rows_analyzed || 0) + records.length;
    await rest(baseUrl, key, 'normalization_shadow_checkpoints?on_conflict=job_name', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{
        job_name: jobName,
        last_source_record_id: lastId,
        rows_analyzed: rowsAnalyzed,
        updated_at: new Date().toISOString(),
      }]),
    });

    const changed = shadowRows.filter(row => row.change_flags.length > 0).length;
    return res.status(200).json({ status: 'ok', jobName, batch: records.length, changed, rowsAnalyzed, lastId });
  } catch (error) {
    console.error('[shadow-normalize]', error);
    return res.status(500).json({ error: 'Shadow normalization failed' });
  }
};

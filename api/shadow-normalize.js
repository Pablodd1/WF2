'use strict';

const { analyzeRecord } = require('../tools/shadow-reprocess/shadow-reprocess.cjs');

const JOB_NAME = 'normalization-v4-production';
const BATCH_SIZE = 200;

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
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) return res.status(503).json({ error: 'Supabase server configuration missing' });

  try {
    const checkpoints = await rest(
      baseUrl,
      key,
      `normalization_shadow_checkpoints?job_name=eq.${JOB_NAME}&select=last_source_record_id,rows_analyzed&limit=1`,
    );
    const checkpoint = checkpoints?.[0] || {};
    const params = new URLSearchParams({
      select: 'id,raw_message,brand,reference,price_raw,price_usd,currency,listing_type,parser_version',
      raw_message: 'not.is.null',
      order: 'id.asc',
      limit: String(BATCH_SIZE),
    });
    if (checkpoint.last_source_record_id) params.set('id', `gt.${checkpoint.last_source_record_id}`);

    const records = await rest(baseUrl, key, `watch_records?${params.toString()}`);
    if (!records?.length) {
      return res.status(200).json({ status: 'complete', rowsAnalyzed: checkpoint.rows_analyzed || 0 });
    }

    const shadowRows = records.map(analyzeRecord);
    const lastId = records[records.length - 1].id;
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
        job_name: JOB_NAME,
        last_source_record_id: lastId,
        rows_analyzed: rowsAnalyzed,
        updated_at: new Date().toISOString(),
      }]),
    });

    const changed = shadowRows.filter(row => row.change_flags.length > 0).length;
    return res.status(200).json({ status: 'ok', batch: records.length, changed, rowsAnalyzed, lastId });
  } catch (error) {
    console.error('[shadow-normalize]', error);
    return res.status(500).json({ error: 'Shadow normalization failed' });
  }
};

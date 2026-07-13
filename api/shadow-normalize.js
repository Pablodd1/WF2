'use strict';

const { analyzeRecord } = require('../tools/shadow-reprocess/shadow-reprocess.cjs');
const { Client } = require('pg');

const JOB_NAME = 'normalization-v4-production';
const BATCH_SIZE = 200;

async function ensureShadowSchema() {
  if (!process.env.DATABASE_URL) return;
  const directUrl = new URL(process.env.DATABASE_URL);
  const projectRef = directUrl.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1];
  const candidates = [directUrl.toString()];
  for (const region of ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2']) {
    if (!projectRef) break;
    const poolerUrl = new URL(directUrl.toString());
    poolerUrl.hostname = `aws-0-${region}.pooler.supabase.com`;
    poolerUrl.port = '6543';
    poolerUrl.username = `postgres.${projectRef}`;
    poolerUrl.search = '';
    candidates.push(poolerUrl.toString());
  }

  let client;
  let lastError;
  for (const connectionString of candidates) {
    const candidate = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 4000,
    });
    try {
      await candidate.connect();
      client = candidate;
      break;
    } catch (error) {
      lastError = error;
      await candidate.end().catch(() => {});
    }
  }
  if (!client) throw lastError || new Error('No Supabase database connection available');
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.normalization_shadow_v4 (
        source_record_id TEXT PRIMARY KEY,
        normalization_version TEXT NOT NULL,
        source_parser_version TEXT,
        source_brand TEXT,
        source_reference TEXT,
        source_price_raw NUMERIC,
        source_price_usd NUMERIC,
        source_currency TEXT,
        source_listing_type TEXT,
        candidate_count INTEGER NOT NULL DEFAULT 0,
        proposed_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
        change_flags TEXT[] NOT NULL DEFAULT '{}',
        review_status TEXT NOT NULL DEFAULT 'PENDING',
        analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_normalization_shadow_v4_review_status
        ON public.normalization_shadow_v4 (review_status, analyzed_at);
      CREATE INDEX IF NOT EXISTS idx_normalization_shadow_v4_change_flags
        ON public.normalization_shadow_v4 USING GIN (change_flags);
      CREATE TABLE IF NOT EXISTS public.normalization_shadow_checkpoints (
        job_name TEXT PRIMARY KEY,
        last_source_record_id TEXT,
        rows_analyzed BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE public.normalization_shadow_v4 ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.normalization_shadow_checkpoints ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON public.normalization_shadow_v4 FROM anon, authenticated;
      REVOKE ALL ON public.normalization_shadow_checkpoints FROM anon, authenticated;
      GRANT ALL ON public.normalization_shadow_v4 TO service_role;
      GRANT ALL ON public.normalization_shadow_checkpoints TO service_role;
    `);
  } finally {
    await client.end();
  }
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

  try {
    await ensureShadowSchema();
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

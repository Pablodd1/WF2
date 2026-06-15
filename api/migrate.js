/**
 * ONE-TIME MIGRATION — POST /api/migrate
 * Creates WatchFacts tables via Supabase REST API.
 * Uses service_role to bypass RLS.
 * DELETE after running.
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (req.headers['x-migrate-secret'] !== 'wf-migrate-2026') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ error: 'Missing env vars' });

  const h = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=minimal',
  };

  const results = [];

  // ── helper: run SQL via Supabase's pg endpoint (tries multiple paths) ──
  async function sql(query, label) {
    // Try Supabase pg/query (v2.40+)
    const endpoints = [
      { url: `${url}/pg/query`, body: JSON.stringify({ query }) },
      { url: `${url}/rest/v1/rpc/exec_sql`, body: JSON.stringify({ sql: query }) },
    ];
    for (const ep of endpoints) {
      try {
        const r = await fetch(ep.url, { method: 'POST', headers: h, body: ep.body });
        const body = await r.text();
        if (r.ok) {
          results.push({ ok: true, label, status: r.status });
          return { ok: true };
        }
        if (r.status !== 404) {
          results.push({ ok: false, label, status: r.status, error: body.slice(0, 100) });
          return { ok: false, error: body };
        }
      } catch (e) {
        // continue to next endpoint
      }
    }
    results.push({ ok: false, label, error: 'No working SQL endpoint found' });
    return { ok: false };
  }

  // ── Create tables via INSERT test (PostgREST auto-detects schema) ──
  // Actually: seed the tables by trying to insert a test row then delete it.
  // This only works if the table already exists.
  // 
  // The ONLY way to CREATE tables via PostgREST without a SQL endpoint is
  // to use the Supabase Management API (which requires a personal access token, not service_role).
  //
  // REAL SOLUTION: Use the Supabase Dashboard SQL editor OR 
  // the supabase-js admin client which has a .sql() method.
  //
  // Let's try the supabase-js approach via dynamic import
  let supabaseAdmin;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    supabaseAdmin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch {
    return res.status(500).json({ error: '@supabase/supabase-js not installed in api/' });
  }

  // Test connection
  const { data: testData, error: testErr } = await supabaseAdmin
    .from('watch_records')
    .select('id')
    .limit(1);

  if (!testErr) {
    // Tables already exist!
    return res.status(200).json({
      message: 'Tables already exist',
      watch_records: 'EXISTS',
      live_ingest: 'EXISTS',
    });
  }

  if (testErr.code === 'PGRST205') {
    // Table doesn't exist — need to create it
    // supabase-js doesn't expose raw SQL. Return instructions.
    return res.status(200).json({
      message: 'Tables need to be created. Run the SQL below in Supabase SQL Editor.',
      sql_editor_url: `https://supabase.com/dashboard/project/bptrvfncppbjnchsaxtb/sql/new`,
      sql: `
CREATE TABLE IF NOT EXISTS public.watch_records (
  id TEXT PRIMARY KEY,
  brand TEXT,
  reference TEXT,
  dial_color TEXT,
  condition TEXT,
  year INT,
  price_raw NUMERIC,
  price_usd NUMERIC,
  currency TEXT,
  confidence INT,
  verdict TEXT CHECK (verdict IN ('APPROVED','HUMAN','RECYCLE')),
  source TEXT,
  raw_message TEXT,
  flags JSONB DEFAULT '[]',
  reprocessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.live_ingest (
  id TEXT PRIMARY KEY,
  raw_message TEXT,
  brand TEXT,
  reference TEXT,
  dial_color TEXT,
  condition TEXT,
  year INT,
  price_raw NUMERIC,
  price_usd NUMERIC,
  currency TEXT,
  confidence INT,
  verdict TEXT CHECK (verdict IN ('APPROVED','HUMAN','RECYCLE')),
  source TEXT,
  channel_id TEXT,
  llm_used BOOLEAN DEFAULT FALSE,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wr_verdict   ON public.watch_records(verdict);
CREATE INDEX IF NOT EXISTS idx_wr_brand     ON public.watch_records(brand);
CREATE INDEX IF NOT EXISTS idx_wr_reference ON public.watch_records(reference);
CREATE INDEX IF NOT EXISTS idx_li_received  ON public.live_ingest(received_at DESC);

ALTER TABLE public.watch_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_ingest   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.watch_records
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.live_ingest
  FOR ALL TO service_role USING (true) WITH CHECK (true);
      `.trim(),
    });
  }

  return res.status(500).json({ error: testErr.message });
}

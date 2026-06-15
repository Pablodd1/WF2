/**
 * ONE-TIME MIGRATION ENDPOINT — POST /api/migrate
 * Runs the WatchFacts schema on Supabase.
 * DELETE THIS FILE after running once.
 *
 * Usage: curl -X POST https://watchfacts-poc.vercel.app/api/migrate \
 *   -H "x-migrate-secret: wf-migrate-2026"
 */

const SCHEMA_SQL = `
-- watch_records: normalized, re-processed watch listings
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

-- live_ingest: real-time incoming dealer messages
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_watch_records_verdict   ON public.watch_records(verdict);
CREATE INDEX IF NOT EXISTS idx_watch_records_brand     ON public.watch_records(brand);
CREATE INDEX IF NOT EXISTS idx_watch_records_reference ON public.watch_records(reference);
CREATE INDEX IF NOT EXISTS idx_watch_records_conf      ON public.watch_records(confidence);
CREATE INDEX IF NOT EXISTS idx_live_ingest_received    ON public.live_ingest(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_ingest_verdict     ON public.live_ingest(verdict);

-- RLS
ALTER TABLE public.watch_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_ingest   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_watch" ON public.watch_records;
CREATE POLICY "service_role_all_watch" ON public.watch_records
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_ingest" ON public.live_ingest;
CREATE POLICY "service_role_all_ingest" ON public.live_ingest
  FOR ALL TO service_role USING (true) WITH CHECK (true);
`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Simple secret to prevent accidental runs
  if (req.headers['x-migrate-secret'] !== 'wf-migrate-2026') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required' });
  }

  // Run each statement via Supabase RPC — create exec helper first
  // Split schema into individual statements
  const statements = SCHEMA_SQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 10 && !s.startsWith('--'));

  const results = [];
  let errors = 0;

  for (const stmt of statements) {
    const sql = stmt + ';';
    try {
      // Use Supabase's PostgREST RPC to run raw SQL via a helper
      // First try: use pg module if available (Vercel Edge has node-postgres)
      const { Pool } = await import('pg');
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 1,
        connectionTimeoutMillis: 10000,
      });
      const client = await pool.connect();
      try {
        await client.query(sql);
        results.push({ ok: true, stmt: sql.slice(0, 60) });
      } finally {
        client.release();
        await pool.end();
      }
    } catch (e) {
      // Fallback: try Supabase REST API rpc endpoint
      results.push({ ok: false, stmt: sql.slice(0, 60), error: e.message });
      errors++;
    }
  }

  return res.status(200).json({
    total: statements.length,
    ok: statements.length - errors,
    errors,
    results: results.slice(0, 20),
  });
}

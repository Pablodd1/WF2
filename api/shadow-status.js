'use strict';

async function countRows(baseUrl, key, query) {
  const response = await fetch(`${baseUrl}/rest/v1/${query}`, {
    method: 'HEAD',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      // The shadow table is intentionally bounded during review, so exact
      // counts are cheap and avoid misleading progress totals.
      Prefer: 'count=exact',
    },
  });
  if (!response.ok) throw new Error(`Supabase returned ${response.status}`);
  return Number.parseInt((response.headers.get('content-range') || '').split('/')[1] || '0', 10) || 0;
}

async function fetchRows(baseUrl, key, query) {
  const response = await fetch(`${baseUrl}/rest/v1/${query}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!response.ok) throw new Error(`Supabase returned ${response.status}`);
  return response.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) return res.status(503).json({ status: 'not_configured' });
  const requestedJob = String(req.query?.job || '').trim();
  const jobName = /^normalization-v4-[a-z0-9-]{1,60}$/.test(requestedJob)
    ? requestedJob
    : 'normalization-v4-production';

  try {
    const flags = [
      'BUNDLE_SPLIT_REQUIRED',
      'NO_CANDIDATE',
      'REFERENCE_CHANGED',
      'INTENT_CHANGED',
      'PRICE_CHANGED',
      'BRAND_CHANGED',
      'CURRENCY_CHANGED',
      'CURRENCY_AMBIGUOUS',
      'PRICE_PARSE_FAILED',
    ];
    const [total, changed, pending, bundles, ...flagValues] = await Promise.all([
      countRows(baseUrl, key, 'normalization_shadow_v4?select=source_record_id'),
      countRows(baseUrl, key, 'normalization_shadow_v4?select=source_record_id&change_flags=not.eq.{}'),
      countRows(baseUrl, key, 'normalization_shadow_v4?select=source_record_id&review_status=eq.PENDING'),
      countRows(baseUrl, key, 'normalization_shadow_v4?select=source_record_id&change_flags=cs.{BUNDLE_SPLIT_REQUIRED}'),
      ...flags.map(flag => countRows(
        baseUrl,
        key,
        `normalization_shadow_v4?select=source_record_id&change_flags=cs.{${flag}}`,
      )),
    ]);
    const flagCounts = Object.fromEntries(flags.map((flag, index) => [flag, flagValues[index]]));
    const checkpoints = await fetchRows(
      baseUrl,
      key,
      `normalization_shadow_checkpoints?job_name=eq.${encodeURIComponent(jobName)}&select=rows_analyzed,updated_at&limit=1`,
    );
    const checkpoint = checkpoints?.[0] || null;
    const rowsAnalyzed = Number(checkpoint?.rows_analyzed || 0);
    return res.status(200).json({
      status: 'ok',
      jobName,
      total,
      rowsAnalyzed,
      deduplicatedSourceRows: Math.max(0, rowsAnalyzed - total),
      lastUpdatedAt: checkpoint?.updated_at || null,
      changed,
      pending,
      bundles,
      flagCounts,
    });
  } catch (error) {
    console.error('[shadow-status]', error);
    if (String(error.message).includes('404')) {
      return res.status(200).json({
        status: 'schema_pending',
        total: 0,
        changed: 0,
        pending: 0,
        bundles: 0,
        flagCounts: {},
      });
    }
    return res.status(500).json({ status: 'unavailable' });
  }
};

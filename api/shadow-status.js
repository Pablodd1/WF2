'use strict';

async function countRows(baseUrl, key, query) {
  const response = await fetch(`${baseUrl}/rest/v1/${query}`, {
    method: 'HEAD',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=estimated',
    },
  });
  if (!response.ok) throw new Error(`Supabase returned ${response.status}`);
  return Number.parseInt((response.headers.get('content-range') || '').split('/')[1] || '0', 10) || 0;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) return res.status(503).json({ status: 'not_configured' });

  try {
    const [total, changed, pending, bundles] = await Promise.all([
      countRows(baseUrl, key, 'normalization_shadow_v4?select=source_record_id'),
      countRows(baseUrl, key, 'normalization_shadow_v4?select=source_record_id&change_flags=not.eq.{}'),
      countRows(baseUrl, key, 'normalization_shadow_v4?select=source_record_id&review_status=eq.PENDING'),
      countRows(baseUrl, key, 'normalization_shadow_v4?select=source_record_id&change_flags=cs.{BUNDLE_SPLIT_REQUIRED}'),
    ]);
    return res.status(200).json({ status: 'ok', total, changed, pending, bundles });
  } catch (error) {
    console.error('[shadow-status]', error);
    return res.status(500).json({ status: 'unavailable' });
  }
};

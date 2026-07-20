'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

const DEFAULT_BATCH_ID = 'f94506b0-17a9-4656-9b51-9e81ed052ab8';

async function rest(baseUrl, key, path) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 250)}`);
  return {
    rows: body ? JSON.parse(body) : [],
    total: Number(response.headers.get('content-range')?.split('/')[1] || 0),
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const dealerAuth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (dealerAuth.error) return res.status(dealerAuth.status).json({ error: dealerAuth.error });

  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) return res.status(503).json({ status: 'not_configured', items: [] });

  const batchId = String(req.query?.batchId || DEFAULT_BATCH_ID).trim();
  const page = Math.max(1, Number(req.query?.page || 1));
  const limit = Math.max(1, Math.min(Number(req.query?.limit || 50), 100));
  const offset = (page - 1) * limit;
  const requestedBucket = String(req.query?.bucket || 'review-ready').trim().toLowerCase();
  const bucket = requestedBucket === 'human-correction' ? 'human-correction' : 'review-ready';
  const search = String(req.query?.search || '').trim().replace(/[(),]/g, ' ').slice(0, 80);

  try {
    const params = new URLSearchParams({
      select: 'id,batch_id,raw_message,brand,reference,dial_color,condition,year,price_raw,price_usd,currency,source,created_at,listing_type,flags,field_confidence,verdict,confidence,human_edited',
      batch_id: `eq.${batchId}`,
      verdict: 'eq.PENDING',
      order: 'created_at.desc,id.asc',
      offset: String(offset),
      limit: String(limit),
    });
    params.set('field_confidence->>review_bucket', `eq.${bucket}`);
    if (search) params.set('or', `(brand.ilike.*${search}*,reference.ilike.*${search}*,raw_message.ilike.*${search}*)`);
    const result = await rest(baseUrl, key, `watch_staging?${params.toString()}`);
    const items = result.rows.map(row => ({
      ...row,
      reviewBucket: row.field_confidence?.review_bucket || null,
      dealerAttributionMissing: !row.field_confidence?.dealer_id && !row.field_confidence?.seller_phone,
      sourceRecordId: row.field_confidence?.source_record_id || null,
      sourceChildId: row.field_confidence?.source_child_id || null,
      catalogConfirmed: row.field_confidence?.catalog_confirmed === true,
      exactRawLineage: row.field_confidence?.exact_raw_lineage === true,
    }));
    return res.status(200).json({ status: 'ok', batchId, page, limit, total: result.total, bucket, items });
  } catch (error) {
    console.error('[unbundled-review-queue]', error);
    return res.status(500).json({ status: 'unavailable', error: 'Unbundled review queue is unavailable', items: [] });
  }
};

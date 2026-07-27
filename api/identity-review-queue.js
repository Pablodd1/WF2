'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

const ALLOWED_BRANDS = new Set(['Rolex', 'Patek Philippe']);
const SELECT_FIELDS = [
  'record_id',
  'identity_status',
  'brand',
  'model',
  'reference',
  'dial_color',
  'condition',
  'year',
  'price_raw',
  'price_usd',
  'currency',
  'listing_type',
  'verdict',
  'confidence',
  'raw_message',
  'source',
  'source_type',
  'listing_date',
  'created_at',
  'seller_name',
  'seller_phone',
  'dealer_id',
  'thumbnail_url',
  'image_urls',
  'has_images',
  'prior_identity_evidence',
  'release_blockers',
].join(',');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const page = Math.max(1, Number.parseInt(req.query?.page || '1', 10) || 1);
  const limit = Math.max(1, Math.min(Number.parseInt(req.query?.limit || '50', 10) || 50, 100));
  const brand = String(req.query?.brand || '').trim();
  const reference = String(req.query?.reference || '').trim().slice(0, 80);
  const identityStatus = String(req.query?.status || '').trim().toUpperCase();
  if (brand && !ALLOWED_BRANDS.has(brand)) {
    return res.status(400).json({ error: 'Brand must be Rolex or Patek Philippe' });
  }
  if (identityStatus && !['UNVERIFIED', 'CONFLICT'].includes(identityStatus)) {
    return res.status(400).json({ error: 'Status must be UNVERIFIED or CONFLICT' });
  }

  try {
    let query = auth.client
      .from('two_brand_identity_review_queue')
      .select(SELECT_FIELDS, { count: 'exact' })
      .order('created_at', { ascending: false, nullsFirst: false })
      .order('record_id', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (brand) query = query.eq('brand', brand);
    if (reference) query = query.eq('reference', reference);
    if (identityStatus) query = query.eq('identity_status', identityStatus);
    const { data, error, count } = await query;
    if (error) throw error;
    return res.status(200).json({
      status: 'ok',
      page,
      limit,
      total: Number(count || 0),
      count: data?.length || 0,
      items: data || [],
      scope: ['Rolex', 'Patek Philippe'],
      decisionContract: 'A signed reviewer decision changes only listing_identity_reviews. Raw evidence remains immutable.',
    });
  } catch (error) {
    console.error('[identity-review-queue]', error);
    return res.status(500).json({ error: 'Identity review queue is unavailable' });
  }
};

module.exports.ALLOWED_BRANDS = ALLOWED_BRANDS;
module.exports.SELECT_FIELDS = SELECT_FIELDS;

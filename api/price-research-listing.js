/**
 * PRICE RESEARCH LISTING DETAIL — /api/price-research-listing?id=...
 * Loads source evidence on demand so raw dealer messages and media metadata do
 * not make the main analytics response unnecessarily large.
 */
const { getClient } = require('./_lib/supabase');
const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

function collectUrls(value, found = []) {
  if (Array.isArray(value)) {
    value.forEach(item => collectUrls(item, found));
    return found;
  }
  if (value && typeof value === 'object') {
    ['url', 'src', 'image_url', 'thumbnail_url'].forEach(key => collectUrls(value[key], found));
    return found;
  }
  if (typeof value !== 'string') return found;
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'https:') found.push(url.toString());
  } catch { /* Ignore malformed or non-URL media values. */ }
  return found;
}

function normalizeAccessories(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean).slice(0, 20);
  if (typeof value === 'string') return value.split(/[,;|]/).map(item => item.trim()).filter(Boolean).slice(0, 20);
  return [];
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const id = String(req.query.id || '').trim();
  if (!id || id.length > 250) return res.status(400).json({ error: 'Valid listing id required' });

  try {
    // General listing facts remain available to the beta Price Research gate.
    // The original dealer message is returned only for a credentialed dealer,
    // reviewer, or admin session because it can contain private source context.
    if (!req.headers) req.headers = {};
    const authorization = await authorizeDealer(req, res);
    const rawMessageAllowed = !authorization.error;
    const client = rawMessageAllowed ? authorization.client : getClient();
    const columns = 'id,brand,reference,price_raw,price_usd,currency,raw_message,created_at,listing_date,condition,source,dial_color,year,listing_type,accessories,image_urls,thumbnail_url,has_images,dealer_photos,region,source_type,listing_status,confidence';
    const { data, error } = await client
      .from('watch_records')
      .select(columns)
      .eq('id', id)
      .eq('verdict', 'APPROVED')
      .eq('listing_type', 'WTS')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Listing not found' });

    const imageUrls = [...new Set([
      ...collectUrls(data.thumbnail_url),
      ...collectUrls(data.image_urls),
      ...collectUrls(data.dealer_photos),
    ])].slice(0, 20);

    return res.status(200).json({
      success: true,
      listing: {
        id: data.id,
        brand: data.brand,
        reference: data.reference,
        price_raw: data.price_raw,
        price_usd: data.price_usd,
        currency: data.currency,
        raw_message: rawMessageAllowed ? String(data.raw_message || '') : '',
        raw_message_restricted: !rawMessageAllowed && Boolean(data.raw_message),
        created_at: data.created_at,
        listing_date: data.listing_date,
        condition: data.condition,
        source: data.source,
        dial_color: data.dial_color,
        year: data.year,
        listing_type: data.listing_type,
        accessories: normalizeAccessories(data.accessories),
        image_urls: imageUrls,
        has_images: imageUrls.length > 0,
        region: data.region,
        source_type: data.source_type,
        listing_status: data.listing_status,
        confidence: data.confidence,
      },
    });
  } catch (error) {
    console.error('[price-research-listing] error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch listing detail' });
  }
};

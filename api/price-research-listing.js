/**
 * PRICE RESEARCH LISTING DETAIL — /api/price-research-listing?id=...
 * Loads source evidence on demand so raw dealer messages and media metadata do
 * not make the main analytics response unnecessarily large.
 */
const { getClient } = require('./_lib/supabase');

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

async function resolveRawSource(client, listing) {
  const flags = listing.flags && !Array.isArray(listing.flags) ? listing.flags : {};
  const rawMessageId = typeof flags.raw_message_id === 'string' ? flags.raw_message_id : null;
  if (rawMessageId) {
    const { data, error } = await client
      .from('raw_messages')
      .select('id,raw_text')
      .eq('id', rawMessageId)
      .maybeSingle();
    if (!error && data?.raw_text) {
      return { text: String(data.raw_text), scope: 'original_post', lineage_id: data.id };
    }
  }
  return {
    text: String(listing.raw_message || ''),
    scope: listing.raw_message ? 'stored_source_message' : 'unavailable',
    lineage_id: null,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const id = String(req.query.id || '').trim();
  if (!id || id.length > 250) return res.status(400).json({ error: 'Valid listing id required' });

  try {
    const client = getClient();
    const columns = 'id,brand,reference,price_raw,price_usd,currency,raw_message,flags,created_at,listing_date,condition,source,dial_color,year,listing_type,accessories,image_urls,thumbnail_url,has_images,dealer_photos,region,source_type,listing_status,confidence';
    const { data, error } = await client
      .from('watch_records')
      .select(columns)
      .eq('id', id)
      .eq('verdict', 'APPROVED')
      .eq('listing_type', 'WTS')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Listing not found' });
    const rawSource = await resolveRawSource(client, data);

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
        raw_message: rawSource.text,
        raw_message_scope: rawSource.scope,
        raw_message_lineage_id: rawSource.lineage_id,
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

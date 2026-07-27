/**
 * PRICE RESEARCH LISTING DETAIL — /api/price-research-listing?id=...
 * Loads source evidence on demand so raw dealer messages and media metadata do
 * not make the main analytics response unnecessarily large.
 */
const { getClient } = require('./_lib/supabase');
const { normalizeMarketRow } = require('./_lib/market-row-normalization.cjs');
const { isCustomerIdentitySafe, sanitizeTradingRecord } = require('./_lib/trading-record-safety.cjs');
const { isPublicationBrandAllowed } = require('./_lib/publication-brands.cjs');
const { loadVerifiedListingRows } = require('./_lib/verified-listing-media.cjs');

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
    if (process.env.STRICT_VERIFIED_PUBLICATION === 'true') {
      const strictGate = await client
        .from('price_research_verified_source')
        .select('id')
        .eq('id', id)
        .maybeSingle();
      if (strictGate.error) throw strictGate.error;
      if (!strictGate.data) return res.status(404).json({ error: 'Listing not found' });
    }
    const columns = 'id,brand,reference,price_raw,price_usd,currency,raw_message,flags,created_at,listing_date,condition,source,dial_color,year,listing_type,accessories,image_urls,thumbnail_url,has_images,dealer_photos,region,source_type,listing_status,confidence';
    const { data, error } = await client
      .from('watch_records')
      .select(columns)
      .eq('id', id)
      .eq('verdict', 'APPROVED')
      .eq('listing_type', 'WTS')
      .or('listing_status.is.null,listing_status.not.in.(HIDDEN,REJECTED,DELETED)')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Listing not found' });
    let verifiedById = new Map();
    try {
      verifiedById = await loadVerifiedListingRows(client, [id]);
    } catch (verifiedError) {
      console.warn('[price-research-listing] verified media unavailable; image withheld:', verifiedError.message);
    }
    const verified = verifiedById.get(id);
    const resolvedData = verified
      ? {
          ...data,
          brand: verified.brand,
          reference: verified.reference,
          dial_color: verified.dial_color,
          has_images: verified.has_images,
          thumbnail_url: verified.thumbnail_url,
          image_urls: verified.image_urls,
        }
      : data;
    if (!isPublicationBrandAllowed(resolvedData.brand)) {
      return res.status(404).json({ error: 'Listing not included in this release' });
    }
    if (!isCustomerIdentitySafe(resolvedData)) return res.status(404).json({ error: 'Listing under identity review' });
    const customerListing = sanitizeTradingRecord(resolvedData, { verifiedImages: Boolean(verified?.has_images) });
    const rawSource = await resolveRawSource(client, data);
    const normalized = normalizeMarketRow(
      { ...customerListing, raw_message: rawSource.text },
      customerListing.reference,
    );

    return res.status(200).json({
      success: true,
      listing: {
        id: customerListing.id,
        brand: customerListing.brand,
        reference: customerListing.reference,
        price_raw: customerListing.price_raw,
        price_usd: normalized.analytics_price_usd,
        stored_price_usd: customerListing.price_usd,
        price_normalization: normalized.price_normalization,
        currency: customerListing.currency,
        raw_message: null,
        raw_message_scope: 'unavailable',
        raw_message_lineage_id: null,
        source_message_available_to_reviewers: Boolean(rawSource.text),
        created_at: customerListing.created_at,
        listing_date: customerListing.listing_date,
        condition: customerListing.condition,
        source: customerListing.source,
        dial_color: customerListing.dial_color,
        year: customerListing.year,
        listing_type: customerListing.listing_type,
        accessories: normalizeAccessories(customerListing.accessories),
        image_urls: customerListing.image_urls,
        has_images: customerListing.has_images,
        region: customerListing.region,
        source_type: customerListing.source_type,
        listing_status: customerListing.listing_status,
        confidence: customerListing.confidence,
      },
    });
  } catch (error) {
    console.error('[price-research-listing] error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch listing detail' });
  }
};

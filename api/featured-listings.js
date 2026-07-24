/** Customer-safe featured inventory with reference-line currency proof. */
const { getClient } = require('./_lib/supabase');
const { lookupCatalog } = require('./_lib/catalog');
const { normalizeMarketRow } = require('./_lib/market-row-normalization.cjs');
const { classifyResearchEligibility } = require('./_lib/price-research-eligibility.cjs');
const { deduplicateReposts } = require('./_lib/repost-deduplication.cjs');
const { sanitizeTradingRecord } = require('./_lib/trading-record-safety.cjs');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const limit = Math.max(1, Math.min(Number(req.query.limit || 18), 36));
  try {
    const { data, error } = await getClient()
      .from('watch_records')
      .select('id,brand,reference,dial_color,condition,price_usd,currency,raw_message,flags,created_at,listing_date,year,confidence,thumbnail_url,image_urls,has_images,listing_type,verdict,listing_status')
      .eq('verdict', 'APPROVED')
      .eq('listing_type', 'WTS')
      .eq('has_images', true)
      .or('listing_status.is.null,listing_status.not.in.(HIDDEN,REJECTED,DELETED)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;

    const candidates = (data || []).map(row => {
      const normalized = normalizeMarketRow(row, row.reference);
      return sanitizeTradingRecord({
        ...row,
        price_usd: normalized.analytics_price_usd,
        analytics_currency_status: normalized.analytics_currency_status,
      });
    }).filter(row => {
      const catalog = lookupCatalog(row.reference, row.brand);
      return !classifyResearchEligibility(row, catalog)
        && Number(row.price_usd) >= 1000
        && Number(row.price_usd) <= 2500000
        && Number(row.confidence) >= 85
        && row.thumbnail_url;
    });
    const { uniqueRows } = deduplicateReposts(candidates);
    const records = uniqueRows.slice(0, limit).map(row => ({
      id: row.id, brand: row.brand, reference: row.reference, dial_color: row.dial_color,
      condition: row.condition, price_usd: row.price_usd, currency: row.currency,
      created_at: row.created_at, listing_date: row.listing_date, year: row.year,
      confidence: row.confidence, thumbnail_url: row.thumbnail_url, image_urls: row.image_urls,
      has_images: row.has_images, listing_type: row.listing_type, verdict: row.verdict,
    }));
    return res.status(200).json({ status: 'ok', records, source: 'currency_verified_listing_evidence' });
  } catch (error) {
    console.error('[featured-listings] error:', error.message);
    return res.status(500).json({ error: 'Featured listings are temporarily unavailable' });
  }
};

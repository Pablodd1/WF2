'use strict';

const { getClient } = require('./_lib/supabase');
const { normalizeMarketRow } = require('./_lib/market-row-normalization.cjs');
const { redactPublicSource } = require('./_lib/source-redaction.cjs');
const { sanitizeTradingRecord } = require('./_lib/trading-record-safety.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const id = String(req.query?.id || '').trim().slice(0, 250);
  if (!id) return res.status(400).json({ error: 'Listing id required' });

  try {
    const client = getClient();
    const { data: publicListing, error: publicError } = await client
      .from('trading_floor_listings')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (publicError) throw publicError;
    if (!publicListing) return res.status(404).json({ error: 'Listing not found' });

    const { data, error } = await client.from('watch_records')
      .select('id,brand,reference,price_usd,price_raw,currency,dial_color,condition,year,listing_type,verdict,source,source_type,listing_date,listing_status,created_at,confidence,has_images,thumbnail_url,image_urls,region,raw_message')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Listing not found' });
    const normalized = normalizeMarketRow(data, data.reference);
    const listing = sanitizeTradingRecord(data);
    if (normalized.analytics_currency_status === 'VERIFIED') {
      listing.price_usd = normalized.analytics_price_usd;
    }
    return res.status(200).json({
      success: true,
      listing: {
        id: data.id,
        brand: data.brand,
        reference: data.reference,
        price_usd: listing.price_usd,
        price_raw: listing.price_raw,
        currency: data.currency,
        dial_color: data.dial_color,
        condition: data.condition,
        year: data.year,
        listing_type: data.listing_type,
        verdict: data.verdict,
        source: data.source,
        source_type: data.source_type,
        raw_message: redactPublicSource(data.raw_message),
        listing_date: data.listing_date,
        listing_status: data.listing_status,
        created_at: data.created_at,
        confidence: data.confidence,
        has_images: data.has_images,
        thumbnail_url: data.thumbnail_url,
        image_urls: data.image_urls,
        region: data.region,
        data_quality_issues: listing.data_quality_issues,
        source_message_is_redacted: true,
      },
    });
  } catch (error) {
    console.error('[trading-listing]', error.message);
    return res.status(500).json({ error: 'Unable to load source evidence' });
  }
};

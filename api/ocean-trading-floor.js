'use strict';

// GET /api/ocean/trading-floor
// Thin, isolated endpoint that reads the LIVE Ocean Digital Trading Floor view.
// Returns paginated parsed cards. Does NOT touch Supabase or any other prod data.
// Proof-of-live: cards render directly from Ocean Digital PG.

const { query } = require('./_lib/ocean-digital.cjs');

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

module.exports = async function oceanTradingFloor(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const page = Math.max(1, parseInt(req.query.page || String(DEFAULT_PAGE), 10) || DEFAULT_PAGE);
    let pageSize = parseInt(req.query.page_size || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
    pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize));
    const offset = (page - 1) * pageSize;

    // Count all published trading-floor cards
    const { rows: [{ n: total }] } = await query(
      'SELECT count(*)::int AS n FROM public.reviewed_workbook_market_source_v2'
    );

    // Read page
    const { rows } = await query(
      `SELECT
         id, brand, model, reference, dial_color, condition,
         listing_type, price, price_usd, seller_name, location,
         dealer_rating, image_url, raw_message_text, posted_at
       FROM public.reviewed_workbook_market_source_v2
       ORDER BY posted_at DESC NULLS LAST
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      page,
      page_size: pageSize,
      total,
      has_more: offset + rows.length < total,
      cards: rows,
    });
  } catch (err) {
    console.error('[ocean-digital] trading-floor error:', err.message);
    return res.status(500).json({ error: 'ocean_read_failed', detail: err.message });
  }
};

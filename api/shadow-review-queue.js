'use strict';

const { buildPromotionDecision } = require('../tools/shadow-reprocess/promotion-policy.cjs');
const { confirmCatalogCandidate } = require('../tools/shadow-reprocess/catalog-confirmation.cjs');

async function rest(baseUrl, key, path) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}`);
  return response.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) return res.status(503).json({ status: 'not_configured', items: [] });

  const limit = Math.max(1, Math.min(Number(req.query?.limit || 50), 100));
  try {
    const params = new URLSearchParams({
      select: 'source_record_id,source_brand,source_reference,source_price_raw,source_currency,source_listing_type,candidate_count,proposed_candidates,change_flags,analyzed_at',
      review_status: 'eq.PENDING',
      order: 'analyzed_at.desc',
      limit: String(limit),
    });
    const rows = await rest(baseUrl, key, `normalization_shadow_v4?${params.toString()}`);
    const items = rows.map(row => {
      const candidate = row.candidate_count === 1 ? row.proposed_candidates?.[0] : null;
      const catalogConfirmation = candidate ? confirmCatalogCandidate(candidate) : null;
      const decision = buildPromotionDecision(row, catalogConfirmation);
      return {
        id: row.source_record_id,
        source: {
          brand: row.source_brand,
          reference: row.source_reference,
          priceRaw: row.source_price_raw,
          currency: row.source_currency,
          listingType: row.source_listing_type,
        },
        candidate,
        changeFlags: row.change_flags,
        analyzedAt: row.analyzed_at,
        decision,
      };
    });
    return res.status(200).json({ status: 'ok', count: items.length, items });
  } catch (error) {
    console.error('[shadow-review-queue]', error);
    return res.status(500).json({ status: 'unavailable', items: [] });
  }
};

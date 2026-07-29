/**
 * Customer-safe release counts for Price Research discovery.
 * Counts only the same reviewed, globally deduplicated cache used by Trading
 * Floor. It deliberately does not count the narrower Price Research cohort.
 */
const { getClient } = require('./_lib/supabase');

const BRANDS = ['Rolex', 'Patek Philippe', 'Audemars Piguet'];
const CACHE_TTL_MS = 5 * 60 * 1000;
let cached = null;

async function loadSummary() {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.payload;
  const client = getClient();
  const results = await Promise.all(BRANDS.map(async brand => {
    const { count, error } = await client
      .from('two_brand_verified_trading_release_cache')
      .select('id', { count: 'exact', head: true })
      .eq('brand', brand);
    if (error) throw error;
    return { brand, listing_count: Number(count || 0) };
  }));
  const payload = {
    success: true,
    surface: 'Trading Floor',
    brands: results,
    total_listing_count: results.reduce((total, brand) => total + brand.listing_count, 0),
  };
  cached = { at: Date.now(), payload };
  return payload;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    return res.status(200).json(await loadSummary());
  } catch (error) {
    console.error('[live-release-summary] error:', error.message);
    return res.status(503).json({ error: 'Live release counts are temporarily unavailable' });
  }
};

module.exports.loadSummary = loadSummary;

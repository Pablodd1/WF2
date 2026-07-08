/**
 * PRICE RESEARCH API — /api/price-research
 * Returns per-reference market analytics from the production DB.
 * Query: GET /api/price-research?reference=52506&brand=Rolex
 *        GET /api/price-research?reference=52506           (brand auto-resolved)
 */
const { getClient } = require('./_lib/supabase');
const { normRef, inferBrand: sharedInferBrand } = require('./_lib/resolve');
const { lookupCatalog } = require('./_lib/catalog');

// Look up a human model name for a reference from the PROVEN file catalog
// (catalog.json + enriched_refs.json via _lib/catalog.js) — same path used live
// by /api/catalog-lookup. The Supabase cached_price_guide_watches table is empty
// for most brands, so we do NOT use it. Decoration only — never affects existence.
function lookupModel(reference) {
  try {
    const hit = lookupCatalog(reference);
    return hit && hit.found ? (hit.model || null) : null;
  } catch { return null; }
}

// Pull real liquidity indicators for a reference. Wrapped in try/catch because
// market_reference_indicators_current has never been queried by live code — if
// column names differ, we fall back to a live-derived count. REAL DATA ONLY:
// no invented seller/buyer numbers.
async function lookupLiquidity(client, reference, listingCount) {
  try {
    const { data, error } = await client
      .from('market_reference_indicators_current')
      .select('liquidity_score, sale_count, search_count, demand_score, supply_score, wtb_fs_ratio')
      .eq('normalized_reference', normRef(reference))
      .eq('region', 'global')
      .limit(1);
    if (!error && data && data.length) {
      const d = data[0];
      return {
        source: 'indicators',
        liquidity_score: d.liquidity_score,
        sale_count: d.sale_count,
        search_count: d.search_count,
        demand_score: d.demand_score,
        supply_score: d.supply_score,
        wtb_fs_ratio: d.wtb_fs_ratio,
        listing_count: listingCount,
      };
    }
  } catch { /* fall through to live count */ }
  return { source: 'live_fallback', listing_count: listingCount };
}

function inferBrand(ref) {
  return sharedInferBrand(ref);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const rawRef = (req.query.reference || '').trim();
  let brand = (req.query.brand || '').trim();

  if (!rawRef) return res.status(400).json({ error: 'reference required' });

  // Auto-resolve brand if not provided
  if (!brand) {
    brand = inferBrand(rawRef);
    if (!brand) {
      return res.status(400).json({
        error: 'brand not found. Provide ?reference=52506&brand=Rolex',
        hint: 'Brand auto-resolve failed. Provide &brand= explicitly.'
      });
    }
  }

  try {
    const client = getClient();

    // Resolve reference — support prefix matching (3712 -> 3712/1A)
    let targetRef = rawRef;
    if (rawRef.length >= 3) {
      const { data: refs, error: refError } = await client
        .from('watch_records')
        .select('reference')
        .eq('brand', brand)
        .eq('verdict', 'APPROVED')
        .ilike('reference', `${rawRef}%`)
        .limit(50);

      if (!refError && refs && refs.length > 0) {
        const foundRefs = [...new Set(refs.map(r => r.reference))];
        const exact = foundRefs.find(r => r === rawRef);
        targetRef = exact || foundRefs[0];
      }
    }

    // Pull all APPROVED records
    const { data: rows, error } = await client
      .from('watch_records')
      .select('price_usd, created_at, condition, source, dial_color, raw_message, year')
      .eq('brand', brand)
      .eq('reference', targetRef)
      .eq('verdict', 'APPROVED')
      .order('created_at', { ascending: false })
      .limit(5000);

    if (error) throw error;

    if (!rows || rows.length === 0) {
      return res.status(200).json({
        success: true, brand, reference: rawRef,
        resolvedRef: targetRef !== rawRef ? targetRef : null,
        model: null, dialColors: null,
        dial_analysis: [],
        totalListings: 0, count: 0,
        analytics_ready: false, listing_count: 0,
        stats: null, liquidity: null, monthly: [], prices: [], rows: []
      });
    }

    // Filter: exclude test sources + WTB/WTB-like messages
    const excludedSources = new Set(['bulk_test_100', 'test_run', 'mysql_market_refs', 'mysql_auction_watches']);
    const marketRows = rows.filter(r => !excludedSources.has(r.source));

    // Also remove obvious WTB/want/looking messages from price analysis
    const listedRows = marketRows.filter(r => {
      if (!r.raw_message) return true;
      const lower = r.raw_message.toLowerCase();
      // Skip messages that are primarily WTB/want/looking (not listings)
      if (/^wtb\b/i.test(r.raw_message.trim())) return false;
      return true;
    });

    const rawPrices = listedRows
      .filter(r => r.price_usd > 0)
      .map(r => r.price_usd);

    function iqrFilter(arr) {
      if (arr.length < 4) return arr;
      const s = [...arr].sort((a, b) => a - b);
      const q1 = s[Math.floor(s.length * 0.25)];
      const q3 = s[Math.floor(s.length * 0.75)];
      const iqr = q3 - q1;
      const lo = q1 - 1.0 * iqr;
      const hi = q3 + 1.0 * iqr;
      return arr.filter(p => p >= lo && p <= hi);
    }

    const prices = iqrFilter(rawPrices);
    const avg = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
    const sorted = [...prices].sort((a, b) => a - b);
    const min = sorted[0] || 0;
    const max = sorted[sorted.length - 1] || 0;
    const median = sorted[Math.floor(sorted.length / 2)] || 0;

    // Monthly aggregation
    const monthlyMap = {};
    listedRows.forEach(r => {
      if (!r.created_at || !r.price_usd || excludedSources.has(r.source)) return;
      const d = new Date(r.created_at);
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap[key]) monthlyMap[key] = { month: key, count: 0, sum: 0, min: Infinity, max: 0 };
      monthlyMap[key].count++;
      monthlyMap[key].sum += r.price_usd;
      monthlyMap[key].min = Math.min(monthlyMap[key].min, r.price_usd);
      monthlyMap[key].max = Math.max(monthlyMap[key].max, r.price_usd);
    });

    const monthly = Object.values(monthlyMap)
      .map(m => ({ month: m.month, count: m.count, avg_price: Math.round(m.sum / m.count), min_price: m.min, max_price: m.max }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // ── Dial analysis: EVERY dial color found in real listings (rule: all must show) ──
    const dialMap = {};
    listedRows.forEach(r => {
      if (!(r.price_usd > 0)) return;
      const dial = r.dial_color || 'Unspecified';
      if (!dialMap[dial]) dialMap[dial] = { dial_color: dial, count: 0, sum: 0, min: Infinity, max: 0 };
      const d = dialMap[dial];
      d.count++; d.sum += r.price_usd;
      d.min = Math.min(d.min, r.price_usd);
      d.max = Math.max(d.max, r.price_usd);
    });
    const dial_analysis = Object.values(dialMap)
      .map(d => ({ dial_color: d.dial_color, count: d.count, avg_price: Math.round(d.sum / d.count), min_price: d.min, max_price: d.max }))
      .sort((a, b) => b.count - a.count);
    const dialColors = dial_analysis.map(d => d.dial_color);

    // ── Real model name (catalog decoration) + real liquidity (indicators, no phantom numbers) ──
    const model = lookupModel(targetRef);
    const liquidity = await lookupLiquidity(client, targetRef, listedRows.length);

    res.status(200).json({
      success: true, brand, reference: rawRef,
      resolvedRef: targetRef !== rawRef ? targetRef : null,
      model, dialColors,
      dial_analysis,
      totalListings: rows.length,
      listing_count: listedRows.length,
      count: prices.length,
      rawCount: listedRows.length,
      outliersRemoved: rawPrices.length - prices.length,
      analytics_ready: prices.length >= 4,
      stats: { avg, median, min, max, range: max - min },
      liquidity,
      monthly, prices,
      rows: listedRows.map(r => ({
        price_usd: r.price_usd, created_at: r.created_at,
        dial_color: r.dial_color, condition: r.condition,
        source: r.source, year: r.year, raw_message: r.raw_message || '',
      })),
    });
  } catch (err) {
    console.error('[price-research] error:', err.message, err.stack?.split('\n').slice(0, 3).join(' '));
    res.status(500).json({ error: 'Failed to fetch from database', detail: err.message });
  }
};

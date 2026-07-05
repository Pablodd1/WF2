/**
 * PRICE RESEARCH API — /api/price-research
 * Returns per-reference market analytics from the production DB.
 * Query: GET /api/price-research?reference=52506&brand=Rolex
 *        GET /api/price-research?reference=52506           (brand auto-resolved)
 */
const { getClient } = require('./_lib/supabase');

// Inline brand inference — no catalog dependency needed
function inferBrand(ref) {
  const r = String(ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!r) return null;
  if (/^[3-7]\d{3}\//.test(ref)) return 'Patek Philippe';
  if (/^RM\d{2}/.test(r)) return 'Richard Mille';
  if (/^IW\d{4,6}$/.test(r)) return 'IWC';
  if (/^(WSSA|WSNM|WGNM|WJSA|CRWS|CRWG)/.test(r)) return 'Cartier';
  if (/^(15|26|77)\d{3}[A-Z]{2,4}$/.test(r)) return 'Audemars Piguet';
  if (/^(33\d{4}|47\d{4}|85\d{4}|81180|85180|4500V|4300V|6000V)/.test(r)) return 'Vacheron Constantin';
  if (/^\d{5,6}[A-Z]{0,4}$/.test(r)) return 'Rolex';
  if (/^(79\d{4}|70\d{4})[A-Z]*$/.test(r)) return 'Tudor';
  if (/^3\d{4}\.\d/.test(String(ref || ''))) return 'Omega';
  return null;
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
        totalListings: 0, count: 0,
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

    res.status(200).json({
      success: true, brand, reference: rawRef,
      resolvedRef: targetRef !== rawRef ? targetRef : null,
      model: null, dialColors: null,
      totalListings: rows.length,
      count: prices.length,
      rawCount: listedRows.length,
      outliersRemoved: rawPrices.length - prices.length,
      stats: { avg, median, min, max, range: max - min },
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

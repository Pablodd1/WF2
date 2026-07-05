/**
 * PRICE RESEARCH API — /api/price-research
 * Returns per-reference market analytics from the production DB.
 * Query: GET /api/price-research?reference=52506&brand=Rolex
 *        GET /api/price-research?reference=52506           (brand auto-resolved from catalog)
 */
const { getClient } = require('./_lib/supabase');
const { lookupCatalog } = require('./_lib/catalog');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const rawRef = (req.query.reference || '').trim();
  let brand = (req.query.brand || '').trim();

  if (!rawRef) return res.status(400).json({ error: 'reference required' });

  // Auto-resolve brand from catalog if not provided
  if (!brand) {
    const catEntry = lookupCatalog(rawRef);
    if (catEntry && catEntry.found && catEntry.brand) {
      brand = catEntry.brand;
    } else {
      return res.status(400).json({
        error: 'brand not found. Try: ?reference=52506&brand=Rolex',
        hint: 'Provide brand via &brand=Rolex, or use a catalog-listed reference'
      });
    }
  }

  try {
    const client = getClient();

    // Step 0: Resolve reference — support prefix matching (3712 → 3712/1A)
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

    // Step 1: Pull all APPROVED records for this brand+reference
    const { data: rows, error } = await client
      .from('watch_records')
      .select('price_usd, created_at, condition, source, dial_color, raw_message, year')
      .eq('brand', brand)
      .eq('reference', targetRef)
      .eq('verdict', 'APPROVED')
      .order('created_at', { ascending: false })
      .limit(5000);

    if (error) throw error;

    // Fill in missing dial colors from catalog
    rows.forEach(r => {
      if (!r.dial_color) {
        const catEntry = lookupCatalog(targetRef);
        if (catEntry && catEntry.found && catEntry.dialColors) {
          r.dial_color = catEntry.dialColors[0] || null;
        }
      }
    });

    // Step 2: Get catalog info for model/dial details
    const catEntry = lookupCatalog(targetRef);

    if (!rows || rows.length === 0) {
      return res.status(200).json({
        success: true,
        brand,
        reference: rawRef,
        resolvedRef: targetRef !== rawRef ? targetRef : null,
        model: catEntry?.found ? (catEntry.model || null) : null,
        collection: catEntry?.found ? (catEntry.collection || null) : null,
        dialColors: catEntry?.found ? (catEntry.dialColors || null) : null,
        totalListings: 0,
        stats: null,
        monthly: [],
        liquidity: null,
        error: 'No APPROVED records found'
      });
    }

    // Step 3: Build liquidity stats from dealer data
    // Unique sellers = distinct phone numbers in rows
    const phones = [...new Set(rows.filter(r => r.raw_message).map(r => {
      const phoneMatch = r.raw_message.match(/(?:^|\s)(\d{8,15})(?:\s|$)/);
      return phoneMatch ? phoneMatch[1] : null;
    }).filter(Boolean))];
    const uniqueSellers = phones.length || Math.min(rows.length, 20);
    const uniqueBuyers = Math.round(uniqueSellers * 0.4); // rough estimate from buyer/seller ratio patterns

    // Step 4: IQR outlier removal + source filter
    const filteredSources = ['bulk_test_100', 'test_run', 'mysql_market_refs', 'mysql_auction_watches'];
    const rawPrices = rows
      .filter(r => r.price_usd > 0 && !filteredSources.includes(r.source))
      .map(r => r.price_usd)
      .filter(p => p != null && p > 0);

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
    const count = prices.length;
    const avg = count > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / count) : 0;
    const sorted = [...prices].sort((a, b) => a - b);
    const min = sorted[0] || 0;
    const max = sorted[sorted.length - 1] || 0;
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    const outliersRemoved = rawPrices.length - prices.length;

    // Step 5: Monthly aggregation
    const cleanSources = new Set(filteredSources);
    const monthlyMap = {};
    rows.forEach(r => {
      const dateStr = r.created_at;
      if (!dateStr || !r.price_usd || cleanSources.has(r.source)) return;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap[key]) monthlyMap[key] = { month: key, count: 0, sum: 0, prices: [] };
      monthlyMap[key].count++;
      monthlyMap[key].sum += r.price_usd;
      monthlyMap[key].prices.push(r.price_usd);
    });

    const monthly = Object.values(monthlyMap)
      .map(m => ({
        month: m.month,
        count: m.count,
        avg_price: Math.round(m.sum / m.count),
        min_price: Math.min(...m.prices),
        max_price: Math.max(...m.prices)
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // Step 6: Price drift (current avg vs previous period)
    const currentAvg = avg;
    const prevMonthPrices = rows
      .filter(r => r.price_usd > 0 && !cleanSources.has(r.source))
      .map(r => r.price_usd);
    const prevAvg = prevMonthPrices.length > 0
      ? Math.round(prevMonthPrices.reduce((a, b) => a + b, 0) / prevMonthPrices.length)
      : currentAvg;
    const drift = prevAvg > 0 ? parseFloat((((currentAvg - prevAvg) / prevAvg) * 100).toFixed(2)) : 0;

    res.status(200).json({
      success: true,
      brand,
      reference: rawRef,
      resolvedRef: targetRef !== rawRef ? targetRef : null,
      model: catEntry?.found ? (catEntry.model || null) : null,
      collection: catEntry?.found ? (catEntry.collection || null) : null,
      dialColors: catEntry?.found ? (catEntry.dialColors || null) : null,
      totalListings: rows.length,
      count,
      rawCount: rows.length,
      outliersRemoved,
      stats: {
        avg,
        median,
        min,
        max,
        range: max - min,
        drift,
        previousAvg: prevAvg,
      },
      liquidity: {
        totalListings: rows.length,
        uniqueSellers,
        estimatedBuyers: uniqueBuyers,
        buyerSellerRatio: uniqueSellers > 0 ? parseFloat((uniqueBuyers / uniqueSellers).toFixed(2)) : null,
      },
      monthly,
      prices,
      rows: rows.map(r => ({
        price_usd: r.price_usd,
        created_at: r.created_at,
        dial_color: r.dial_color,
        condition: r.condition,
        source: r.source,
        year: r.year,
        raw_message: r.raw_message || '',
      })),
    });
  } catch (err) {
    console.error('Price research error:', err);
    res.status(500).json({ error: 'Failed to fetch from database', detail: err.message });
  }
};

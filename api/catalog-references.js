/**
 * CATALOG REFERENCES — /api/catalog-references?brand=Rolex&model=Submariner
 *
 * Returns the REFERENCES under a (brand, model) that have >=1 real approved
 * listing. Existence is derived from watch_records. Each reference carries a
 * derived avg price, real listing count, and the FULL set of dial colors that
 * actually appear in listings (rule: every dial color found must show).
 *
 * Anti-phantom rule: reference appears iff real approved listings >= 1.
 * The returned `reference` is the RAW DB string (not normalized) so it feeds
 * price-research.js's resolver cleanly — no drift.
 */
const { getClient } = require('./_lib/supabase');
const { normRef } = require('./_lib/resolve');
const { lookupCatalog } = require('./_lib/catalog');

const _cache = new Map(); // `${brand}|${model}` -> { at, payload }
const CACHE_TTL = 5 * 60 * 1000;
const SCAN_CAP = 400_000; // hard ceiling to stay under Vercel timeout

// Memoized model resolver via the proven file catalog (same as catalog-models).
const _modelMemo = new Map();
function modelForRef(reference) {
  const key = normRef(reference);
  if (_modelMemo.has(key)) return _modelMemo.get(key);
  const hit = lookupCatalog(reference);
  const model = hit && hit.found ? (hit.model || null) : null;
  _modelMemo.set(key, model);
  return model;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const brand = (req.query.brand || '').trim();
  const model = (req.query.model || '').trim();
  if (!brand || !model) return res.status(400).json({ error: 'brand and model required' });

  const cacheKey = `${brand}|${model}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return res.status(200).json({ ...cached.payload, cached: true });
  }

  try {
    const client = getClient();

    const batch = 5000;
    let lastId = null;
    let scanned = 0;
    // raw reference -> { count, sum, dials:Map<dial,count> }
    const refs = new Map();

    while (true) {
      let q = client
        .from('watch_records')
        .select('id, reference, price_usd, dial_color')
        .eq('brand', brand)
        .eq('verdict', 'APPROVED')
        .gt('price_usd', 0)
        .order('id', { ascending: true })
        .limit(batch);
      if (lastId) q = q.gt('id', lastId);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) break;

      for (const r of data) {
        scanned++;
        if (!r.reference) continue;
        const modelName = modelForRef(r.reference) || 'Other / Uncatalogued';
        if (modelName !== model) continue; // only this model's refs
        if (!refs.has(r.reference)) refs.set(r.reference, { count: 0, sum: 0, dials: new Map() });
        const e = refs.get(r.reference);
        e.count++;
        e.sum += r.price_usd;
        const dial = r.dial_color || 'Unspecified';
        e.dials.set(dial, (e.dials.get(dial) || 0) + 1);
      }
      lastId = data[data.length - 1].id;
      if (scanned > SCAN_CAP) break;
    }

    const out = [...refs.entries()]
      .map(([reference, v]) => ({
        reference, // RAW string — feeds price-research resolver directly
        listing_count: v.count,
        avg_price: Math.round(v.sum / v.count),
        dial_colors: [...v.dials.entries()]
          .map(([dial_color, count]) => ({ dial_color, count }))
          .sort((a, b) => b.count - a.count),
      }))
      .filter(r => r.listing_count >= 1)
      .sort((a, b) => b.listing_count - a.listing_count);

    const payload = {
      success: true, brand, model,
      reference_count: out.length,
      references: out,
    };
    _cache.set(cacheKey, { at: Date.now(), payload });
    return res.status(200).json(payload);
  } catch (err) {
    console.error('[catalog-references] error:', err.message);
    return res.status(500).json({ error: 'Failed to load references', detail: err.message });
  }
};

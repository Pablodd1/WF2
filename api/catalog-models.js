/**
 * CATALOG MODELS — /api/catalog-models?brand=Rolex
 *
 * Returns the list of MODELS for a brand that have at least one REAL approved
 * listing behind them. Existence is derived from watch_records (the real
 * listings) — NEVER from a static catalog. The catalog (cached_price_guide_watches)
 * is used ONLY to attach a human model name to a reference. A reference with no
 * catalog entry still appears (grouped under its reference); a catalog model with
 * zero real listings NEVER appears.
 *
 * Anti-phantom rule: a model shows up iff SUM(real approved listings) >= 1.
 */
const { getClient } = require('./_lib/supabase');
const { normRef } = require('./_lib/resolve');
const { lookupCatalog } = require('./_lib/catalog');

// Per-brand response cache (5 min) — first load scans, subsequent loads are instant.
const _cache = new Map(); // brand -> { at, payload }
const CACHE_TTL = 5 * 60 * 1000;
const SCAN_CAP = 400_000; // hard ceiling to stay under Vercel timeout

// Memoized model-name resolver backed by the file catalog (catalog.json +
// enriched_refs.json via _lib/catalog.js). This is the PROVEN path used live by
// /api/catalog-lookup. Cloud-editable Supabase catalog can replace this later
// behind the same interface. Returns a model name or null.
const _modelMemo = new Map(); // brand|normRef -> modelName|null
function modelForRef(reference, brand) {
  const key = `${brand || ''}|${normRef(reference)}`;
  if (_modelMemo.has(key)) return _modelMemo.get(key);
  const hit = lookupCatalog(reference, brand || null);
  const model = hit && hit.found ? (hit.model || null) : null;
  _modelMemo.set(key, model);
  return model;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const brand = (req.query.brand || '').trim();
  if (!brand) return res.status(400).json({ error: 'brand required' });

  // Return cached payload if fresh
  const cached = _cache.get(brand);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return res.status(200).json({ ...cached.payload, cached: true });
  }

  try {
    const client = getClient();

    // 1. REAL listings drive existence. Cursor through approved rows for the brand.
    const batch = 5000;
    let lastId = null;
    // model name -> { listing_count, refs:Set }
    const models = new Map();
    // references with no catalog model -> grouped under "(Uncatalogued)" but still real
    let scanned = 0;

    while (true) {
      let q = client
        .from('watch_records')
        .select('id, reference, price_usd')
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
        const modelName = modelForRef(r.reference, brand) || 'Other / Uncatalogued';
        if (!models.has(modelName)) models.set(modelName, { listing_count: 0, refs: new Set() });
        const m = models.get(modelName);
        m.listing_count++;
        m.refs.add(r.reference);
      }
      lastId = data[data.length - 1].id;
      if (scanned > SCAN_CAP) break; // Vercel safety
    }

    // 3. Emit — HAVING listing_count >= 1 is guaranteed by construction.
    const out = [...models.entries()]
      .map(([model, v]) => ({ model, listing_count: v.listing_count, reference_count: v.refs.size }))
      .filter(m => m.listing_count >= 1)
      .sort((a, b) => b.listing_count - a.listing_count);

    const payload = {
      success: true, brand,
      model_count: out.length,
      total_listings_scanned: scanned,
      models: out,
    };
    _cache.set(brand, { at: Date.now(), payload });
    return res.status(200).json(payload);
  } catch (err) {
    console.error('[catalog-models] error:', err.message);
    return res.status(500).json({ error: 'Failed to load models', detail: err.message });
  }
};

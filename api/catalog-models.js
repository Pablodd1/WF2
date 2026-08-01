/**
 * CATALOG MODELS — /api/catalog-models?brand=Rolex
 *
 * Returns catalog-confirmed models without scanning the multi-million-row live
 * listing table. The references endpoint verifies real listing evidence before
 * showing a reference. Uncatalogued references remain directly searchable and
 * are never presented as model names.
 */
const { listCatalogReferences, lookupCatalog } = require('./_lib/catalog');
const { getClient } = require('./_lib/supabase');
const { isPublicationBrandAllowed } = require('./_lib/publication-brands.cjs');
const {
  REVIEWED_PANERAI_RECORD_IDS,
  REVIEWED_PANERAI_SOURCE,
  REVIEWED_ZENITH_RECORD_END,
  REVIEWED_ZENITH_RECORD_START,
  REVIEWED_ZENITH_SOURCE,
  isPublicationReferenceAllowed,
  isReleaseListingEligible,
} = require('./_lib/publication-references.cjs');

const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const REFERENCE_ONLY_MODEL = 'Reference-only listings';
const FOREIGN_BRAND_NAMES = [
  'Audemars Piguet',
  'Cartier',
  'IWC',
  'Omega',
  'Patek Philippe',
  'Piaget',
  'Rolex',
  'Tudor',
  'Vacheron Constantin',
];

function reviewedWorkbookModel(row, brand) {
  const catalog = lookupCatalog(row.reference, brand);
  if (catalog?.found && catalog.model) return String(catalog.model).trim();
  const claimed = String(row.model || '').trim();
  const foreignBrand = FOREIGN_BRAND_NAMES.some(name =>
    name.toLowerCase() !== brand.toLowerCase()
    && claimed.toLowerCase().includes(name.toLowerCase()));
  return claimed && !foreignBrand ? claimed : REFERENCE_ONLY_MODEL;
}

function summarizeReviewedModels(rows, brand) {
  const models = new Map();
  for (const row of rows) {
    if (!row.reference) continue;
    const model = reviewedWorkbookModel(row, brand);
    const current = models.get(model) || { references: new Set(), listing_count: 0 };
    current.references.add(row.reference);
    current.listing_count += 1;
    models.set(model, current);
  }
  return [...models.entries()]
    .map(([model, value]) => ({
      model,
      reference_count: value.references.size,
      listing_count: value.listing_count,
    }))
    .sort((a, b) => b.listing_count - a.listing_count || a.model.localeCompare(b.model));
}

async function loadReviewedPaneraiModels() {
  const client = getClient();
  const { data, error } = await client
    .from('price_research_verified_source')
    .select('id,brand,model,reference,source,verdict,confidence,listing_type,listing_status')
    .in('id', REVIEWED_PANERAI_RECORD_IDS)
    .eq('brand', 'Panerai')
    .eq('source', REVIEWED_PANERAI_SOURCE)
    .eq('verdict', 'APPROVED')
    .gte('confidence', 90)
    .eq('listing_type', 'WTS');
  if (error) throw error;
  return summarizeReviewedModels((data || []).filter(isReleaseListingEligible), 'Panerai');
}

async function loadReviewedZenithModels() {
  const client = getClient();
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('price_research_verified_source')
      .select('id,model,reference')
      .gte('id', REVIEWED_ZENITH_RECORD_START)
      .lt('id', REVIEWED_ZENITH_RECORD_END)
      .eq('brand', 'Zenith')
      .eq('source', REVIEWED_ZENITH_SOURCE)
      .eq('verdict', 'APPROVED')
      .gte('confidence', 90)
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return summarizeReviewedModels(rows, 'Zenith');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const brand = (req.query.brand || '').trim();
  if (!brand) return res.status(400).json({ error: 'brand required' });
  if (!isPublicationBrandAllowed(brand)) {
    return res.status(404).json({ error: 'Brand is not included in this release' });
  }

  const cached = _cache.get(brand);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return res.status(200).json({ ...cached.payload, cached: true });
  }

  try {
    if (brand.toLowerCase() === 'panerai') {
      const out = await loadReviewedPaneraiModels();
      const payload = {
        success: true,
        brand: 'Panerai',
        model_count: out.length,
        catalog_reference_count: out.reduce((sum, item) => sum + item.reference_count, 0),
        models: out,
        identity_source: 'OWNER_REVIEWED_WORKBOOK',
      };
      _cache.set(brand, { at: Date.now(), payload });
      return res.status(200).json(payload);
    }
    if (brand.toLowerCase() === 'zenith') {
      const out = await loadReviewedZenithModels();
      const payload = {
        success: true,
        brand: 'Zenith',
        model_count: out.length,
        catalog_reference_count: out.reduce((sum, item) => sum + item.reference_count, 0),
        models: out,
        identity_source: 'OWNER_REVIEWED_WORKBOOK',
      };
      _cache.set(brand, { at: Date.now(), payload });
      return res.status(200).json(payload);
    }
    const catalogReferences = listCatalogReferences(brand)
      .filter(entry => isPublicationReferenceAllowed(brand, entry.reference));
    const models = new Map();
    for (const entry of catalogReferences) {
      if (!models.has(entry.model)) models.set(entry.model, new Set());
      models.get(entry.model).add(entry.reference);
    }

    const out = [...models.entries()]
      .map(([model, refs]) => ({ model, reference_count: refs.size }))
      .sort((a, b) => b.reference_count - a.reference_count || a.model.localeCompare(b.model));
    const payload = {
      success: true,
      brand,
      model_count: out.length,
      catalog_reference_count: catalogReferences.length,
      models: out,
    };
    _cache.set(brand, { at: Date.now(), payload });
    return res.status(200).json(payload);
  } catch (err) {
    console.error('[catalog-models] error:', err.message);
    return res.status(500).json({ error: 'Failed to load models', detail: err.message });
  }
};
// force recompile Sat Aug  1 19:01:51 EDT 2026

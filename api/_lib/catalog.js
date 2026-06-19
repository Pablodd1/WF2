/**
 * Shared in-process catalog lookup for the live pipeline.  (CommonJS — matches
 * api/package.json "type":"commonjs"; imported from clean-analyze.js via default
 * import, which Vercel's bundler and Node both handle as ESM<-CJS interop.)
 *
 * Loads catalog.json (177 curated refs) + enriched_refs.json (3,379 dealer
 * refs) ONCE at module scope, normalizes references, and infers a brand for
 * the ~581 null-brand entries so the catalog never falsely defaults a
 * Rolex/AP ref to "Patek Philippe".
 *
 * Replaces the HTTP self-call to /api/catalog-lookup — same data, zero network
 * hop, safe to call 120× inside one batched function.
 */

const { readFileSync } = require('fs');
const { resolve } = require('path');

const PUBLIC_DIR = resolve(process.cwd(), 'public');

let _catalog = null;   // Map<normRef, entry>
let _enriched = null;  // Map<normRef, entry>

function normalizeRef(ref) {
  return String(ref || '').toUpperCase().replace(/[^A-Z0-9\/\-]/g, '');
}
function collapseRef(ref) {
  return String(ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Infer brand from a reference pattern. Used only for entries whose brand
 * field is null/empty — NEVER guesses Patek as a blanket default. Mirrors the
 * brand-prefix rules in src/utils/parseEngine.ts so catalog and parser agree.
 */
function inferBrand(rawRef) {
  const r = collapseRef(rawRef);
  if (!r) return null;
  if (/^[3-7]\d{3}\//.test(normalizeRef(rawRef))) return 'Patek Philippe'; // 5711/1A, 7118/1200A
  if (/^RM\d{2}/.test(r)) return 'Richard Mille';
  if (/^IW\d{4,6}$/.test(r)) return 'IWC';
  if (/^(WSSA|WSNM|WGNM|WJSA|CRWS|CRWG)/.test(r)) return 'Cartier';
  if (/^(15|26|77)\d{3}[A-Z]{2,4}$/.test(r)) return 'Audemars Piguet';     // 15500ST, 26579CE
  if (/^(33\d{4}|47\d{4}|85\d{4}|81180|85180|4500V|4300V|6000V)/.test(r)) return 'Vacheron Constantin';
  if (/^\d{6}[A-Z]{0,4}$/.test(r)) return 'Rolex';                          // 116610LN, 126331
  if (/^(79\d{4}|70\d{4})[A-Z]*$/.test(r)) return 'Tudor';
  if (/^3\d{4}\.\d/.test(String(rawRef))) return 'Omega';
  return null;
}

function loadCatalogs() {
  if (_catalog && _enriched) return;
  _catalog = new Map();
  _enriched = new Map();

  try {
    const catalog = JSON.parse(readFileSync(resolve(PUBLIC_DIR, 'catalog.json'), 'utf8'));
    for (const item of catalog) {
      const ref = normalizeRef(item.reference);
      if (!ref) continue;
      const brand = item.brand || inferBrand(item.reference) || 'Patek Philippe';
      _catalog.set(ref, {
        brand,
        collection: item.collection || null,
        model: item.model || null,
        caseMetal: item.case_metal || null,
        productionYears: item.production_years || null,
        status: item.status || null,
        dialColors: item.dial_colors || null,
        source: 'catalog',
      });
    }
  } catch (e) {
    console.error('[catalog] failed to load catalog.json:', e.message);
  }

  try {
    const enriched = JSON.parse(readFileSync(resolve(PUBLIC_DIR, 'enriched_refs.json'), 'utf8'));
    for (const item of enriched) {
      const ref = normalizeRef(item.reference);
      if (!ref || _enriched.has(ref)) continue;
      const brand = item.brand || inferBrand(item.reference) || null;
      _enriched.set(ref, {
        brand,
        collection: item.collection && item.collection !== 'Unknown' ? item.collection : null,
        model: item.model && item.model !== 'Unknown' ? item.model : null,
        caseMetal: item.case_metal && item.case_metal !== 'Unknown' ? item.case_metal : null,
        productionYears: item.production_years && item.production_years !== 'Unknown' ? item.production_years : null,
        liquidityScore: item.liquidity_score != null ? item.liquidity_score : null,
        totalMentions: item.total_mentions != null ? item.total_mentions : null,
        avgPrice: item.avg_price != null ? item.avg_price : null,
        source: 'enriched',
      });
    }
  } catch (e) {
    console.error('[catalog] failed to load enriched_refs.json:', e.message);
  }
}

/**
 * Look up a reference across both catalogs.
 * Returns { found, brand, collection, model, caseMetal, dialColors,
 *           productionYears, liquidityScore, source, matchType }.
 */
function lookupCatalog(reference) {
  loadCatalogs();
  const empty = { found: false, brand: null, source: null, matchType: null };
  if (!reference) return empty;

  const ref = normalizeRef(reference);
  if (!ref) return empty;

  // Tier 1 — exact normalized (catalog wins over enriched: it's curated).
  let hit = _catalog.get(ref) || _enriched.get(ref);
  if (hit) return Object.assign({ found: true, matchType: 'exact' }, hit);

  // Tier 2 — whitespace/slash-collapsed variant (126331 G -> 126331G).
  const collapsed = collapseRef(reference);
  for (const map of [_catalog, _enriched]) {
    for (const [key, val] of map) {
      if (collapseRef(key) === collapsed) return Object.assign({ found: true, matchType: 'collapsed' }, val);
    }
  }

  // Tier 3 — prefix/partial (7118/1 -> 7118/1200A). Require >= 4 chars.
  for (const map of [_catalog, _enriched]) {
    for (const [key, val] of map) {
      const shorter = ref.length <= key.length ? ref : key;
      if (shorter.length >= 4 && (key.startsWith(ref) || ref.startsWith(key))) {
        return Object.assign({ found: true, matchType: 'partial' }, val);
      }
    }
  }

  return Object.assign({}, empty, { brand: inferBrand(reference) });
}

module.exports = { lookupCatalog, inferBrand, normalizeRef };

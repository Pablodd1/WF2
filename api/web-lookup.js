/**
 * Web lookup for watch verification — searches local enriched reference
 * catalog (enriched_refs.json) + DuckDuckGo web search fallback.
 * Returns enrichment data (model, case metal, price hints, etc.)
 * CommonJS for Vercel serverless — maxDuration: 30
 */

const fs = require('fs');
const path = require('path');

// Load enriched refs catalog at startup (included in deployment)
let REFS_CATALOG = [];
try {
  const catalogPath = path.join(__dirname, '..', 'dist', 'enriched_refs.json');
  if (fs.existsSync(catalogPath)) {
    REFS_CATALOG = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  }
} catch (e) {
  console.error('Failed to load enriched_refs.json:', e.message);
}

// Build lookup index
const REF_INDEX = {};
for (const entry of REFS_CATALOG) {
  const ref = (entry.reference || '').toUpperCase().replace(/[-\s]/g, '');
  REF_INDEX[ref] = entry;
  // Also index without space variants
  const alt = (entry.reference || '').toUpperCase().replace(/\s+/g, '');
  if (alt !== ref) REF_INDEX[alt] = entry;
}

function normalizeRef(r) {
  return r.toUpperCase().replace(/[-\s]/g, '');
}

async function searchDuckDuckGo(query) {
  const params = new URLSearchParams({ q: query });
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body: params.toString(),
  });
  if (!res.ok) return [];
  const html = await res.text();
  const results = [];
  const regex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    results.push({ url: m[1], title: m[2].replace(/<[^>]+>/g, '').trim() });
    if (results.length >= 5) break;
  }
  const snippets = [];
  const sRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  while ((m = sRegex.exec(html)) !== null) {
    snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
  }
  for (let i = 0; i < results.length && i < snippets.length; i++) {
    results[i].snippet = snippets[i];
  }
  return results;
}

function extractPrice(text) {
  const prices = {};
  const usdM = text.match(/\$[\s,]*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:USD|usd)?/);
  const hkdM = text.match(/(?:HK\$|HKD)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
  const kM = text.match(/(\d{1,4}(?:\.\d)?)\s*[kK]\s*(USD|HKD|usd|hkd)/);
  if (usdM) prices.usd = parseFloat(usdM[1].replace(/,/g, ''));
  if (hkdM) prices.hkd = parseFloat(hkdM[1].replace(/,/g, ''));
  if (kM) {
    const val = parseFloat(kM[1]) * 1000;
    const cur = kM[2].toUpperCase();
    if (cur === 'USD') prices.usd = val;
    else if (cur === 'HKD') prices.hkd = val;
  }
  return prices;
}

function extractYear(text) {
  const m = text.match(/\b(20[0-2]\d)\b/);
  return m ? parseInt(m[1]) : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { reference, brand, year, raw } = req.query;
    if (!reference && !raw) {
      return res.status(400).json({ success: false, error: 'Need reference or raw text' });
    }

    // 1. Local catalog lookup (instant, always available)
    let catalogMatch = null;
    let lookupRef = null;
    if (reference) {
      const nRef = normalizeRef(reference);
      catalogMatch = REF_INDEX[nRef] || null;
      lookupRef = reference;
    } else if (raw) {
      // Try to extract reference from raw text
      const m = raw.match(/(\d{3,4}\/[A-Z0-9]+[A-Za-z]?|\b[A-Z]{1,2}\d{3,4}[A-Z]?\b)/i);
      if (m) {
        lookupRef = m[1];
        const nRef = normalizeRef(lookupRef);
        catalogMatch = REF_INDEX[nRef] || null;
      }
    }

    // Build enrichment from catalog
    const catalogEnrichment = catalogMatch ? {
      model: catalogMatch.model || null,
      collection: catalogMatch.collection || null,
      caseMetal: catalogMatch.case_metal || null,
      productionYears: catalogMatch.production_years || null,
      status: catalogMatch.status || null,
      totalMentions: catalogMatch.total_mentions || 0,
      buyerRatio: catalogMatch.buyer_ratio || null,
      sellerRatio: catalogMatch.seller_ratio || null,
      liquidityScore: catalogMatch.liquidity_score || null,
      inCatalog: true,
    } : null;

    // 2. Web search (best-effort, may fail from serverless IPs)
    let webResults = [];
    let webSnippets = '';
    const queries = [];
    if (lookupRef) {
      if (brand) queries.push(`${lookupRef} ${brand} watch for sale price`);
      queries.push(`${lookupRef} watch`);
    }
    if (raw && (!queries.length || queries[0].length < 15)) {
      const words = raw.replace(/[^\w\s]/g, ' ').trim().split(/\s+/).filter(w => w.length > 2);
      const keyTerms = words.slice(0, 6).join(' ');
      if (keyTerms.length > 10) queries.push(`${keyTerms} watch`);
    }
    if (queries.length) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        webResults = await searchDuckDuckGo(queries[0]);
        clearTimeout(timeoutId);
        webSnippets = webResults.map(r => r.snippet || '').filter(Boolean).join(' ');
      } catch (e) {
        // Web search failed silently — catalog data is still returned
      }
    }

    // 3. Combined enrichment
    const priceFromWeb = extractPrice(webSnippets);
    const yearFromWeb = extractYear(webSnippets);

    // Confidence boost
    let confidenceBoost = 0;
    if (catalogMatch) confidenceBoost += 15;
    if (webResults.length >= 2) confidenceBoost += 5;
    if (priceFromWeb.usd || priceFromWeb.hkd) confidenceBoost += 5;

    return res.status(200).json({
      success: true,
      reference: lookupRef,
      catalogEnrichment,
      webEnrichment: {
        price: priceFromWeb,
        year: yearFromWeb,
        resultCount: webResults.length,
        topResult: webResults[0] ? {
          title: webResults[0].title,
          url: webResults[0].url,
          snippet: (webResults[0].snippet || '').slice(0, 200),
        } : null,
      },
      confidenceBoost: Math.min(confidenceBoost, 25),
      results: webResults.slice(0, 3).map(r => ({
        title: r.title, url: r.url, snippet: (r.snippet || '').slice(0, 200),
      })),
    });
  } catch (err) {
    console.error('web-lookup error:', err.message);
    return res.status(200).json({
      success: true,
      reference: null,
      catalogEnrichment: null,
      webEnrichment: null,
      confidenceBoost: 0,
      results: [],
    });
  }
};

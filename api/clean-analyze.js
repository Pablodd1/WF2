/**
 * CLEAN ANALYSIS ORCHESTRATOR  —  /api/clean-analyze
 *
 * Purpose: individualized, fully-visible analysis of a pasted watch description.
 * You paste 1..N watches (text, text+URL, text+image, several watches with
 * several images/texts). We split into individual watches and run EACH one
 * through the same cascade, returning every stage so the full workflow is
 * visible — not just a final verdict.
 *
 * CASCADE (stop at first confident hit):
 *   1. PARSE        regex/normalize -> brand, reference, dial, condition, price
 *   2. CATALOG      fuzzy match against known references (code-first, free)
 *   3. AI TEXT      Kimi K2.6 parse when code can't resolve cleanly
 *   4. ONLINE       web cross-reference of the reference (text-only)
 *   5. IMAGE/URL    if a link/image is present, vision reads it BLIND and we
 *                   compare picture-vs-text (MATCH / MISMATCH / UNVERIFIED)
 *
 * VERDICT GATE (single 85% gate, per user spec):
 *   confidence >= 85            -> APPROVED
 *   not enough info to identify  -> RECYCLE  (recycle bin)
 *   otherwise                    -> HUMAN    (human-in-the-loop)
 *   image MISMATCH               -> HUMAN (forced, CRITICAL)
 */

const KIMI_API_URL = 'https://api.moonshot.ai/v1/chat/completions';
const APPROVE_THRESHOLD = 85;   // >= this => auto approve
const RECYCLE_FLOOR = 35;       // below this AND unidentified => recycle bin

// ───────────────────────── helpers ─────────────────────────

function normRef(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const URL_RE = /(https?:\/\/[^\s"'<>)\]]+)/gi;
const IMG_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|avif)(\?|#|$)/i;

function extractUrls(text) {
  const urls = (text.match(URL_RE) || []).map(u => u.replace(/[.,;]+$/, ''));
  return [...new Set(urls)];
}
function isImageUrl(u) { return IMG_EXT_RE.test(u); }

/**
 * Split a pasted block into individual watch chunks.
 * Heuristics tuned for WhatsApp dealer messages:
 *  - blank lines separate watches
 *  - emoji/bullet separators (• ▪ ✅ 🔹 -, numbered "1." "2)")
 *  - each line that starts a new reference-looking token
 */
function splitWatches(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  // 1) Double-newline blocks first
  let blocks = text.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);

  // 2) If it came as one block, try per-line splitting when MULTIPLE lines
  //    each look like a standalone listing (have a price or a reference).
  if (blocks.length === 1) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const listingLike = lines.filter(l =>
      /\b\d{3,4}[\/\-]?\d?[A-Z]{1,4}\b/i.test(l) ||         // reference-ish
      /\b(\d{2,3}\s?k|\$|usd|hkd|eur|usdt|€)\b/i.test(l)    // price-ish
    );
    if (lines.length >= 2 && listingLike.length >= 2) blocks = lines;
  }

  // 3) Strip leading bullet/emoji/number separators
  return blocks
    .map(b => b.replace(/^\s*([0-9]+[.)]|[•▪◦‣·\-–—✅🔹🔸▶►*]+)\s*/u, '').trim())
    .filter(Boolean);
}

// Lightweight code-first parse (mirrors the dataset normalization intent)
function regexParse(chunk) {
  const text = chunk;
  const out = { reference: null, brand: 'Unknown', dialColor: null, condition: 'Unknown', year: null, price: null, currency: null };

  // Brand
  const bl = text.toLowerCase();
  if (/\bpatek|philippe|\bpp\b/.test(bl)) out.brand = 'Patek Philippe';
  else if (/audemars|piguet|\bap\b/.test(bl)) out.brand = 'Audemars Piguet';
  else if (/richard\s*mille|\brm\s?\d/.test(bl)) out.brand = 'Richard Mille';
  else if (/rolex/.test(bl)) out.brand = 'Rolex';

  // Reference (brand-aware patterns)
  let ref =
    (text.match(/\bRM\s?\d{2}[-\s]?\d{2}\b/i) || [])[0] ||
    (text.match(/\b\d{4}\/\d{1,4}[A-Z]{0,2}(?:-\d{3})?\b/i) || [])[0] ||
    (text.match(/\b\d{4}[\/\s-]?\d?[A-Z]{1,3}\b/i) || [])[0] ||
    (text.match(/\b\d{6}[A-Z]{0,4}\b/i) || [])[0] ||
    (text.match(/\b\d{4,5}[A-Z]{1,4}\b/i) || [])[0];
  if (ref) out.reference = ref.trim().toUpperCase();

  // Condition
  if (/\bnew\b|unworn|\bbnib\b|sealed|full\s*set/i.test(text)) out.condition = 'New';
  else if (/\bused\b|pre[\s-]?owned|worn/i.test(text)) out.condition = 'Used';

  // Year
  const y = (text.match(/\b(20[12]\d)\b/) || [])[1];
  if (y) out.year = parseInt(y, 10);

  // Price + currency
  const priceM = text.match(/\b(\d{2,3})\s?[kK]\b/) || text.match(/([\d.,]{3,})\s?(usd|hkd|eur|usdt|\$|€)/i);
  if (priceM) {
    if (/k/i.test(priceM[0]) && priceM[1]) out.price = parseInt(priceM[1], 10) * 1000;
    else out.price = parseInt(String(priceM[1]).replace(/[.,]/g, ''), 10) || null;
  }
  const cur = (text.match(/\b(hkd|usdt|usd|eur)\b/i) || [])[1] || (/€/.test(text) ? 'EUR' : (/\$/.test(text) ? 'USD' : null));
  if (cur) out.currency = cur.toUpperCase();

  return out;
}

// confidence from a code parse alone (how completely did we identify it?)
function codeConfidence(p) {
  let c = 0;
  if (p.reference) c += 45;
  if (p.brand && p.brand !== 'Unknown') c += 25;
  if (p.dialColor) c += 12;
  if (p.condition && p.condition !== 'Unknown') c += 8;
  if (p.price) c += 6;
  if (p.year) c += 4;
  return Math.min(c, 100);
}

// ───────────────────── external calls ─────────────────────

// fetch with a hard timeout so no single call can hang the function
async function fetchT(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function kimiTextParse(kimiKey, rawMessage, currentGuess) {
  const systemPrompt = `You are a luxury watch expert parsing WhatsApp dealer listings.
Return ONLY valid JSON with: reference, dialColor, brand (Patek Philippe|Audemars Piguet|Rolex|Richard Mille|Unknown), condition (New|Used|Unknown), year (4-digit or null), price (number), currency (HKD|USD|USDT|EUR), confidence (0-100).
Reference suffix -> dial: LN=Black LB=Blue LV=Green CHNR=Brown R=Brown G=Blue J=Champagne ST=Blue. No markdown.`;
  const userPrompt = `Regex guess: ${JSON.stringify(currentGuess || {})}\nRaw:\n"""\n${rawMessage}\n"""\nReturn ONLY JSON:`;
  const r = await fetchT(KIMI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kimiKey}` },
    body: JSON.stringify({
      model: 'kimi-k2.6', temperature: 1, max_tokens: 2048,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    }),
  }, 18000);
  if (!r.ok) throw new Error(`Kimi ${r.status}`);
  const d = await r.json();
  const choice = d.choices?.[0]?.message;
  const content = choice?.content || choice?.reasoning_content || '';
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Kimi: no JSON');
  return JSON.parse(m[0]);
}

// Online cross-reference: confirm the reference exists / is real.
// Uses DuckDuckGo Instant Answer (keyless, fast, serverless-safe).
async function onlineCrossRef(brand, reference) {
  if (!reference) return { checked: false, found: false, note: 'no reference to look up' };
  const q = `${brand && brand !== 'Unknown' ? brand + ' ' : ''}${reference} watch`;
  try {
    const r = await fetchT(`https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WatchFactsBot/1.0)' },
    }, 8000);
    if (!r.ok) return { checked: true, found: false, note: `search ${r.status}` };
    const html = (await r.text()).toLowerCase();
    const refTokens = normRef(reference);
    // Count how many result snippets reference the same ref core
    const core = (refTokens.match(/\d{4,6}/) || [refTokens])[0];
    const hits = core ? (html.split(core).length - 1) : 0;
    const found = hits >= 2;
    return { checked: true, found, hits, query: q, note: found ? `corroborated online (${hits} matches)` : 'weak/no online corroboration' };
  } catch (e) {
    return { checked: true, found: false, note: `online lookup ${e.name === 'AbortError' ? 'timed out' : 'failed'}` };
  }
}

// Vision verify (reused logic from verify-image): reads image blind, compares to text.
async function visionVerify(origin, imageUrl, reference, brand) {
  const r = await fetchT(`${origin}/api/verify-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl, reference: reference || 'UNKNOWN', brand }),
  }, 25000);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { verdict: 'UNVERIFIED', reason: data.error || `verify-image ${r.status}`, error: true };
  return data;
}

// ───────────────────── per-watch pipeline ─────────────────────

async function analyzeOne(chunk, ctx) {
  const stages = [];
  const urls = extractUrls(chunk);
  const imageUrls = urls.filter(isImageUrl);
  const pageUrls = urls.filter(u => !isImageUrl(u));
  const textOnly = chunk.replace(URL_RE, '').trim();

  // 1) PARSE (code)
  let parsed = regexParse(textOnly || chunk);
  let confidence = codeConfidence(parsed);
  stages.push({ stage: 'PARSE', engine: 'regex/code', confidence, data: { ...parsed }, note: 'code-first field extraction' });

  // 2) AI TEXT (only if code couldn't resolve a clean brand+reference)
  const needsAi = !parsed.reference || parsed.brand === 'Unknown' || confidence < APPROVE_THRESHOLD;
  if (needsAi && ctx.kimiKey) {
    try {
      const ai = await kimiTextParse(ctx.kimiKey, textOnly || chunk, parsed);
      // Merge: prefer AI values where code was empty/unknown
      parsed = {
        reference: ai.reference || parsed.reference,
        brand: (ai.brand && ai.brand !== 'Unknown') ? ai.brand : parsed.brand,
        dialColor: ai.dialColor || parsed.dialColor,
        condition: (ai.condition && ai.condition !== 'Unknown') ? ai.condition : parsed.condition,
        year: ai.year ?? parsed.year,
        price: ai.price ?? parsed.price,
        currency: ai.currency || parsed.currency,
      };
      confidence = Math.max(confidence, Math.min(ai.confidence ?? codeConfidence(parsed), 100));
      stages.push({ stage: 'AI_TEXT', engine: 'kimi-k2.6', confidence, data: { ...parsed }, note: 'AI parsed messy text' });
    } catch (e) {
      stages.push({ stage: 'AI_TEXT', engine: 'kimi-k2.6', confidence, error: e.message, note: 'AI parse failed, kept code result' });
    }
  }

  // 3) ONLINE cross-reference (text-only first, per cascade order)
  let online = { checked: false, found: false };
  if (parsed.reference) {
    online = await onlineCrossRef(parsed.brand, parsed.reference);
    if (online.found) confidence = Math.min(100, confidence + 10);
    stages.push({ stage: 'ONLINE', engine: 'web', confidence, data: online, note: online.note });
  }

  // 4) IMAGE / URL verification (online + picture)
  let imageVerdict = null;
  const targetImage = imageUrls[0] || null;
  if (targetImage) {
    const v = await visionVerify(ctx.origin, targetImage, parsed.reference, parsed.brand);
    imageVerdict = v.verdict;
    if (v.verdict === 'MATCH') confidence = Math.min(100, confidence + 12);
    else if (v.verdict === 'MISMATCH') confidence = Math.min(confidence, 40); // force down
    stages.push({ stage: 'IMAGE', engine: v.source || 'vision', confidence, data: v.image || {}, verdict: v.verdict, note: v.reason });
  } else if (pageUrls.length) {
    // Link present but not a direct image — note it (page scrape would go here)
    stages.push({ stage: 'IMAGE', engine: 'link', confidence, data: { pageUrl: pageUrls[0] }, note: 'link present (not a direct image URL); text-vs-link compare requires page scrape' });
  }

  // ───────── VERDICT GATE ─────────
  const identified = !!parsed.reference && parsed.brand !== 'Unknown';
  let verdict, reason;
  if (imageVerdict === 'MISMATCH') {
    verdict = 'HUMAN';
    reason = 'Image disagrees with text (CRITICAL mismatch) — needs human review.';
  } else if (!identified && confidence < RECYCLE_FLOOR) {
    verdict = 'RECYCLE';
    reason = 'Not enough information to identify the watch (no clear brand/reference).';
  } else if (confidence >= APPROVE_THRESHOLD) {
    verdict = 'APPROVED';
    reason = `High confidence (${Math.round(confidence)}%) — auto-approved.`;
  } else {
    verdict = 'HUMAN';
    reason = `Confidence ${Math.round(confidence)}% is below ${APPROVE_THRESHOLD}% — route to human review.`;
  }

  return {
    input: chunk,
    parsed,
    confidence: Math.round(confidence),
    verdict,                       // APPROVED | HUMAN | RECYCLE
    reason,
    hasImage: !!targetImage,
    hasLink: urls.length > 0,
    imageUrl: targetImage,
    pageUrl: pageUrls[0] || null,
    stages,                        // full per-stage workflow (visibility)
  };
}

// ───────────────────────── handler ─────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }

  const { text, imageUrls: bodyImages } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text (string) required — paste one or more watch descriptions' });
  }

  const kimiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
  const proto = (req.headers['x-forwarded-proto'] || 'https');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = `${proto}://${host}`;

  const ctx = { kimiKey, origin };

  let chunks = splitWatches(text);
  if (chunks.length === 0) chunks = [text.trim()];

  // Attach any explicitly-uploaded image URLs to the first chunk that has none
  if (Array.isArray(bodyImages) && bodyImages.length) {
    chunks = chunks.map((c, i) => (i === 0 && !extractUrls(c).some(isImageUrl)) ? `${c}\n${bodyImages.join('\n')}` : c);
  }

  try {
    // Run watches in PARALLEL (each is independent) to stay under the 60s limit.
    // Cap at 8 watches per request so we never fan out too wide.
    const capped = chunks.slice(0, 8);
    const results = await Promise.all(capped.map(chunk => analyzeOne(chunk, ctx)));

    const summary = {
      total: results.length,
      approved: results.filter(r => r.verdict === 'APPROVED').length,
      human: results.filter(r => r.verdict === 'HUMAN').length,
      recycle: results.filter(r => r.verdict === 'RECYCLE').length,
      threshold: APPROVE_THRESHOLD,
    };

    return res.status(200).json({ success: true, summary, watches: results });
  } catch (e) {
    console.error('[clean-analyze]', e.message);
    return res.status(500).json({ error: e.message });
  }
}

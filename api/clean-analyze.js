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
 *   3. AI TEXT      DeepSeek primary -> Gemini fallback -> Kimi last resort
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
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const APPROVE_THRESHOLD = 85;   // >= this => auto approve
const RECYCLE_FLOOR = 35;       // below this AND unidentified => recycle bin
const BATCH_SIZE = 15;          // watches per parallel batch
const BATCH_CONCURRENCY = 8;    // batches in flight at once (15×8 = 120 watches/request)

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

const SYSTEM_PROMPT = `You are a luxury watch expert parsing WhatsApp dealer listings.
Return ONLY valid JSON with: reference, dialColor, brand (Patek Philippe|Audemars Piguet|Rolex|Richard Mille|Unknown), condition (New|Used|Unknown), year (4-digit or null), price (number), currency (HKD|USD|USDT|EUR), confidence (0-100).
Reference suffix -> dial: LN=Black LB=Blue LV=Green CHNR=Brown R=Brown G=Blue J=Champagne ST=Blue. No markdown.`;

function buildUserPrompt(rawMessage, currentGuess) {
  return `Regex guess: ${JSON.stringify(currentGuess || {})}\nRaw:\n"""\n${rawMessage}\n"""\nReturn ONLY JSON:`;
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON');
  return JSON.parse(m[0]);
}

async function deepseekParse(key, rawMessage, currentGuess) {
  const r = await fetchT(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-chat', temperature: 0.3, max_tokens: 512,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(rawMessage, currentGuess) },
      ],
    }),
  }, 8000);
  if (!r.ok) throw new Error(`DeepSeek ${r.status}`);
  const d = await r.json();
  const content = d.choices?.[0]?.message?.content || '';
  return extractJson(content);
}

async function geminiParse(key, rawMessage, currentGuess) {
  const r = await fetchT(`${GEMINI_API_URL}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: SYSTEM_PROMPT + '\n\n' + buildUserPrompt(rawMessage, currentGuess) }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
    }),
  }, 8000);
  if (!r.ok) throw new Error(`Gemini ${r.status}`);
  const d = await r.json();
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return extractJson(text);
}

async function kimiParse(key, rawMessage, currentGuess) {
  const r = await fetchT(KIMI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'kimi-k2.6', temperature: 0.3, max_tokens: 512,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(rawMessage, currentGuess) },
      ],
    }),
  }, 8000);
  if (!r.ok) throw new Error(`Kimi ${r.status}`);
  const d = await r.json();
  const content = d.choices?.[0]?.message?.content || d.choices?.[0]?.message?.reasoning_content || '';
  return extractJson(content);
}

async function claudeParse(key, rawMessage, currentGuess) {
  const r = await fetchT(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      temperature: 0.3,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(rawMessage, currentGuess) }],
    }),
  }, 8000);
  if (!r.ok) throw new Error(`Claude ${r.status}`);
  const d = await r.json();
  const content = d.content?.[0]?.text || '';
  return extractJson(content);
}

async function openaiParse(key, rawMessage, currentGuess) {
  const r = await fetchT(OPENAI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o', temperature: 0.3, max_tokens: 512,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(rawMessage, currentGuess) },
      ],
    }),
  }, 8000);
  if (!r.ok) throw new Error(`OpenAI ${r.status}`);
  const d = await r.json();
  const content = d.choices?.[0]?.message?.content || '';
  return extractJson(content);
}

// ─── Provider router ────────────────────────────────────────────────────────
// If whitelist is set, ONLY use that provider (no fallback).
// Otherwise run the original DeepSeek → Gemini → Kimi cascade with Claude/GPT-4o
// as premium first-try options when their keys are present.
async function aiTextParse(ctx, rawMessage, currentGuess, whitelist = null) {
  const errors = [];

  // ─── Single-provider mode (user explicitly chose one) ────────────────────
  if (whitelist) {
    const providerMap = {
      claude: { key: ctx.anthropicKey, fn: claudeParse, name: 'claude' },
      openai: { key: ctx.openaiKey, fn: openaiParse, name: 'openai' },
      gemini: { key: ctx.geminiKey, fn: geminiParse, name: 'gemini' },
      deepseek: { key: ctx.deepseekKey, fn: deepseekParse, name: 'deepseek' },
      kimi: { key: ctx.kimiKey, fn: kimiParse, name: 'kimi' },
    };
    const p = providerMap[whitelist];
    if (!p || !p.key) {
      throw new Error(`Provider "${whitelist}" not configured (missing API key)`);
    }
    const result = await p.fn(p.key, rawMessage, currentGuess);
    return { ...result, _source: p.name };
  }

  // ─── Auto-cascade mode (default) ──────────────────────────────────────────
  // Try premium providers first if their keys exist, then cheap fallbacks.
  if (ctx.anthropicKey) {
    try {
      const result = await claudeParse(ctx.anthropicKey, rawMessage, currentGuess);
      return { ...result, _source: 'claude' };
    } catch (e) {
      errors.push(`Claude: ${e.message}`);
    }
  }
  if (ctx.openaiKey) {
    try {
      const result = await openaiParse(ctx.openaiKey, rawMessage, currentGuess);
      return { ...result, _source: 'openai' };
    } catch (e) {
      errors.push(`OpenAI: ${e.message}`);
    }
  }
  if (ctx.deepseekKey) {
    try {
      const result = await deepseekParse(ctx.deepseekKey, rawMessage, currentGuess);
      return { ...result, _source: 'deepseek' };
    } catch (e) {
      errors.push(`DeepSeek: ${e.message}`);
    }
  }
  if (ctx.geminiKey) {
    try {
      const result = await geminiParse(ctx.geminiKey, rawMessage, currentGuess);
      return { ...result, _source: 'gemini' };
    } catch (e) {
      errors.push(`Gemini: ${e.message}`);
    }
  }
  if (ctx.kimiKey) {
    try {
      const result = await kimiParse(ctx.kimiKey, rawMessage, currentGuess);
      return { ...result, _source: 'kimi' };
    } catch (e) {
      errors.push(`Kimi: ${e.message}`);
    }
  }

  throw new Error(errors.join(' | ') || 'no AI keys configured');
}

// Online cross-reference: confirm the reference exists / is real.
// Uses DuckDuckGo Instant Answer (keyless, fast, serverless-safe).
async function onlineCrossRef(brand, reference) {
  if (!reference) return { checked: false, found: false, note: 'no reference to look up' };
  // First try: GPT-4o-mini web search for canonical info
  // (replaces DDG HTML scrape which is blocked from serverless IPs)
  const origin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
  try {
    const r = await fetchT(`${origin}/api/online-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference, brand }),
    }, 20000);
    if (r.ok) {
      const data = await r.json();
      if (data.success && data.confidence >= 70) {
        return {
          checked: true,
          found: true,
          query: `${brand} ${reference}`,
          hits: 1,
          confidence: data.confidence,
          web_data: {
            brand: data.brand,
            reference: data.reference,
            model: data.model,
            collection: data.collection,
            year: data.year,
            caseMaterial: data.caseMaterial,
            dialColors: data.dialColors,
            priceRange: data.priceRange,
            notes: data.notes,
          },
          note: `web search (${data.confidence}%): ${data.brand} ${data.reference} ${data.model || ''}`.trim(),
        };
      }
      // Fall through to DDG if GPT confidence too low
    }
  } catch (e) {
    // Continue to DDG fallback
  }
  // Fallback: DDG HTML (may be blocked from Vercel IPs but works elsewhere)
  const q = `${brand && brand !== 'Unknown' ? brand + ' ' : ''}${reference} watch`;
  try {
    const r = await fetchT(`https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WatchFactsBot/1.0)' },
    }, 8000);
    if (!r.ok) return { checked: true, found: false, note: `search ${r.status}` };
    const html = (await r.text()).toLowerCase();
    const refTokens = normRef(reference);
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

async function analyzeOne(chunk, ctx, providerWhitelist = null) {
  ctx.startTime = ctx.startTime || Date.now();
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
  const hasAnyAiKey = ctx.deepseekKey || ctx.geminiKey || ctx.kimiKey || ctx.anthropicKey || ctx.openaiKey;
  const needsAi = !parsed.reference || parsed.brand === 'Unknown' || confidence < APPROVE_THRESHOLD;
  if (needsAi && hasAnyAiKey) {
    try {
      const ai = await aiTextParse(ctx, textOnly || chunk, parsed, providerWhitelist);
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
      stages.push({ stage: 'AI_TEXT', engine: ai._source || 'ai', confidence, data: { ...parsed }, note: `AI parsed messy text (${ai._source})` });
    } catch (e) {
      stages.push({ stage: 'AI_TEXT', engine: 'ai-fallback', confidence, error: e.message, note: 'AI parse failed, kept code result' });
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
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const proto = (req.headers['x-forwarded-proto'] || 'https');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = `${proto}://${host}`;

  const ctx = { kimiKey, deepseekKey, geminiKey, origin };

  let chunks = splitWatches(text);
  if (chunks.length === 0) chunks = [text.trim()];

  // Attach any explicitly-uploaded image URLs to the first chunk that has none
  if (Array.isArray(bodyImages) && bodyImages.length) {
    chunks = chunks.map((c, i) => (i === 0 && !extractUrls(c).some(isImageUrl)) ? `${c}\n${bodyImages.join('\n')}` : c);
  }

  // ─── Provider selection ──────────────────────────────────────────────────
  // Body-level preference overrides the cascade default.
  const providerPref = (req.body && req.body.provider) || 'auto';
  ctx.providerPref = providerPref;
  ctx.anthropicKey = process.env.ANTHROPIC_API_KEY;
  ctx.openaiKey = process.env.OPENAI_API_KEY;

  // ─── Provider whitelist check ────────────────────────────────────────────
  // If user picked a specific provider, ONLY use that one. No fallback cascade.
  const providerWhitelist = providerPref === 'auto' ? null : providerPref;

  try {
    // Batched parallel execution. 5 batches × 10 watches = 50 watches/request,
    // still well under the 60s function budget with image timeouts capped.
    const allChunks = chunks.slice(0, BATCH_SIZE * BATCH_CONCURRENCY);
    const results = new Array(allChunks.length);

    // Process in groups of BATCH_SIZE with BATCH_CONCURRENCY batches in flight
    for (let i = 0; i < allChunks.length; i += BATCH_SIZE * BATCH_CONCURRENCY) {
      const batchGroup = [];
      for (let j = 0; j < BATCH_CONCURRENCY && i + j * BATCH_SIZE < allChunks.length; j++) {
        const start = i + j * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, allChunks.length);
        batchGroup.push(
          Promise.all(allChunks.slice(start, end).map(async (chunk, k) => {
            results[start + k] = await analyzeOne(chunk, ctx, providerWhitelist);
          }))
        );
      }
      await Promise.all(batchGroup);
    }

    const summary = {
      total: results.length,
      approved: results.filter(r => r.verdict === 'APPROVED').length,
      human: results.filter(r => r.verdict === 'HUMAN').length,
      recycle: results.filter(r => r.verdict === 'RECYCLE').length,
      threshold: APPROVE_THRESHOLD,
      providerUsed: providerPref,
      latencyMs: Date.now() - (ctx.startTime || Date.now()),
    };

    return res.status(200).json({ success: true, summary, watches: results });
  } catch (e) {
    console.error('[clean-analyze]', e.message);
    return res.status(500).json({ error: e.message });
  }
}

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

import catalogLib from './_lib/catalog.js';
const { lookupCatalog } = catalogLib;
import visionLib from './_lib/vision.js';
const { analyzeImage } = visionLib;

const KIMI_API_URL = 'https://api.moonshot.cn/v1/chat/completions';
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
// Known image CDN domains that serve images without file extensions
const IMG_CDN_RE = /images\.unsplash\.com|cdn\.pixabay\.com|firebasestorage|googleusercontent|cloudinary|imgur\.com\/|telegra\.ph\/file|tme\.co\/|api\.telegram\.org\/file|pps\.whatsapp\.net\/mm|cdn\.instagram/i;

function extractUrls(text) {
  const urls = (text.match(URL_RE) || []).map(u => u.replace(/[.,;]+$/, ''));
  return [...new Set(urls)];
}
function isImageUrl(u) { return IMG_EXT_RE.test(u) || IMG_CDN_RE.test(u); }

/**
 * Split a pasted block into individual watch chunks.
 * Heuristics tuned for WhatsApp/Telegram dealer messages:
 *  - blank lines separate watches
 *  - emoji markers mid-line (🔥🏮🔵🟢🔴 etc.) — each emoji starts a new watch
 *  - comma-separated listings on one line (when each part has a ref or price)
 *  - bullet separators (• ▪ ✅ 🔹 -, numbered "1." "2)")
 *  - each line that starts a new reference-looking token
 *
 * Also separates trailing image URLs from the text so they can be
 * distributed to all watches in the original block (shared gallery image).
 */

// Emoji that dealers use as brand markers / bullet points mid-line
const EMOJI_SPLIT_RE = /([🔥🏮🔵⭕🟢⚫🔴🟠🟡⚪🔶🟣🟤✅🔹🔸▶►])/u;

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

  // 3) EMOJI SPLIT — if a single block has multiple watch-emoji markers
  //    mid-line, split on each emoji. Each emoji starts a new watch.
  //    Example: "🔥7010R Purple 538K 🔥5712/1A Blue 970K" → 2 watches
  //    Only fires when the block has NO newlines (multi-line blocks already
  //    split correctly via step 2).
  const expanded = [];
  for (const block of blocks) {
    // Skip emoji split for multi-line blocks — they're already split by line
    if (block.includes('\n')) { expanded.push(block); continue; }
    const emojiParts = block.split(EMOJI_SPLIT_RE);
    if (emojiParts.length > 2) {
      let current = '';
      let foundMultiple = false;
      for (let i = 0; i < emojiParts.length; i++) {
        const part = emojiParts[i];
        if (EMOJI_SPLIT_RE.test(part)) {
          if (current.trim()) {
            expanded.push(current.trim());
          }
          current = part;
          foundMultiple = true;
        } else {
          current += part;
        }
      }
      if (current.trim()) expanded.push(current.trim());
      if (foundMultiple && expanded.length > 1) {
        continue;
      }
    }
    expanded.push(block);
  }
  blocks = expanded.length > 1 ? expanded : blocks;

  // 4) COMMA / PIPE SPLIT — if a single block has multiple reference-like tokens
  //    separated by commas or pipes, split on them. Each part must look like a watch.
  //    Example: "5712/1A Blue 970K, 5167A 583K, 5968G 930K" → 3 watches
  //    Example: "116500LN 105k | 126710BLNR 98k | 5711/1A 1.2m" → 3 watches
  //    But NOT: "5712/1A, Blue, 970K" (one watch, comma-separated fields)
  const sepSplit = [];
  for (const block of blocks) {
    // Check for comma OR pipe separated listings
    const usesPipe = block.includes('|') && !block.includes(',');
    const usesComma = block.includes(',');
    if (!usesComma && !usesPipe) { sepSplit.push(block); continue; }
    
    const sep = usesPipe ? '|' : ',';
    const parts = block.split(sep).map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) { sepSplit.push(block); continue; }
    
    // Each part must look like a watch (have a reference OR a price)
    const watchLike = parts.filter(p =>
      /\b\d{3,4}[\/\-]?\d?[A-Z]{1,4}\b/i.test(p) ||  // reference-ish
      /\b(\d{2,3}\s?k|\$|usd|hkd|eur|usdt|€)\b/i.test(p)  // price-ish
    );
    if (watchLike.length >= 2) {
      sepSplit.push(...parts);
    } else {
      sepSplit.push(block); // keep as one watch
    }
  }
  blocks = sepSplit;

  // 5) Strip leading bullet/number separators (but keep emoji brand markers)
  return blocks
    .map(b => b.replace(/^\s*([0-9]+[.)]|[•▪◦‣·\-–—✅🔹🔸▶►*]+)\s*/u, '').trim())
    .filter(Boolean);
}

// Emoji brand markers used by dealers in WhatsApp/Telegram chats.
const EMOJI_BRAND_MAP = {
  '🔵': 'Patek Philippe', '⭕': 'Patek Philippe', '🏮': 'Patek Philippe',
  '🟢': 'Rolex', '⚫': 'Rolex',
  '🔴': 'Audemars Piguet', '🟠': 'Audemars Piguet',
  '🟡': 'Richard Mille',
  '⚪': 'Vacheron Constantin', '🔶': 'Vacheron Constantin',
  '🟣': 'Omega', '🟤': 'IWC',
};

// Infer brand from a reference token when no brand text/emoji is present.
function brandFromRef(ref) {
  const r = String(ref || '').toUpperCase();
  if (/^RM\d{2}/.test(r)) return 'Richard Mille';
  if (/^IW\d{4,6}$/.test(r)) return 'IWC';
  if (/^(5[12]\d{2}[A-Z]{1,3}|7[01]\d{2}[A-Z]{1,3}|5990|6007|6300|5303|5374|5524|5968|5520|5920|5320|5370)\d{0,3}$/i.test(r)) return 'Patek Philippe';  // 5167A, 5711/1A, 7118/1200A
  if (/^[3-7]\d{3}\//.test(r)) return 'Patek Philippe';                 // 5711/1A-014, 7118/1200A-001
  if (/^(?:15|26|77|16|41|67)\d{3}[A-Z]{0,4}$/.test(r)) return 'Audemars Piguet';  // 15500ST, 26579CE, 15407ST, 16202ST, 26240OR
  if (/^(?:11[4-9]|12[0-6]|22[6-8]|228|336|268)\d{3}[A-Z]{0,4}$/.test(r)) return 'Rolex';  // 6-digit Rolex refs
  if (/^(?:79|70)\d{4}[A-Z]*$/.test(r)) return 'Tudor';
  if (/^(33\d{4}|47\d{4}|85\d{4}|81180|85180)/.test(r)) return 'Vacheron Constantin';
  if (/^(?:CR|WE|WL|WI|WS|WH|WP|WJ|WC|W4|W6|WG)\w*?\d{3,5}/.test(r)) return 'Cartier';  // CRWSR0004, WSSA0029, WGTA0011
  if (/^(?:Q1[3-9]|Q2[5-9]|Q3[2-9]|Q7|Q8|Q9)\d{4}/.test(r)) return 'Jaeger-LeCoultre';
  if (/^[A-Z]{2}\d{4}[A-Z]?\d?$/.test(r)) return 'Breitling';           // AB0121, A13380
  if (/^(?:PAM|PAM0|PAM00)\d{3,5}$/.test(r)) return 'Panerai';
  return 'Unknown';
}

// Lightweight code-first parse (mirrors src/utils/parseEngine.ts on the high-value
// signals: emoji brand, brand-from-reference, suffix-aware refs, M/k prices).
function regexParse(chunk) {
  const text = chunk;
  const out = { reference: null, brand: 'Unknown', dialColor: null, condition: 'Unknown', year: null, price: null, currency: null };

  // Brand — emoji first (dealers lead with these), then text patterns.
  for (const [emoji, name] of Object.entries(EMOJI_BRAND_MAP)) {
    if (text.includes(emoji)) { out.brand = name; break; }
  }
  if (out.brand === 'Unknown') {
    const bl = text.toLowerCase();
    if (/\bpatek|philippe|\bpp\b/.test(bl)) out.brand = 'Patek Philippe';
    else if (/audemars|piguet|\bap\b/.test(bl)) out.brand = 'Audemars Piguet';
    else if (/richard\s*mille|\brm\s?\d/.test(bl)) out.brand = 'Richard Mille';
    else if (/rolex/.test(bl)) out.brand = 'Rolex';
    else if (/vacheron|\bvc\b/.test(bl)) out.brand = 'Vacheron Constantin';
    else if (/\biwc\b/.test(bl)) out.brand = 'IWC';
    else if (/tudor/.test(bl)) out.brand = 'Tudor';
    else if (/cartier/.test(bl)) out.brand = 'Cartier';
    else if (/omega/.test(bl)) out.brand = 'Omega';
  }

  // Reference (brand-aware patterns, ordered by specificity).
  // HIGHEST specificity first — Patek slash-format, then RM/IWC prefix,
  // then Rolex 6-digit, then generic patterns.
  // CRITICAL: 4-5 digit + letter patterns (5296R, 5196R, 5205R) must run
  // BEFORE bare 6-digit patterns (which would otherwise eat "152000HKD"
  // as a reference when it's clearly a price+currency token).
  //
  // Pre-extract currency from the raw text so we can reject reference
  // candidates that are actually price+currency tokens.
  const CURRENCY_FROM_TEXT = (text.match(/\b(hkd|usdt|usd|eur|chf|gbp|sgd)\b/i) || [])[1] ||
    (/€/.test(text) ? 'EUR' : (/£/.test(text) ? 'GBP' : (/\$/.test(text) ? 'USD' : null)));
  
  let ref =
    (text.match(/\bRM\s?\d{2}[-\s]?\d{2}\b/i) || [])[0] ||
    (text.match(/\b\d{4}\/\d{1,4}[A-Z]{0,2}(?:-\d{3})?\b/i) || [])[0] ||   // Patek 5711/1A, 7118/1200A
    (text.match(/\bIW\d{4,6}\b/i) || [])[0] ||
    (text.match(/\b(?:116|126|114|124|226|228|279|128|336|268)\d{3}[A-Z]{0,4}\b/i) || [])[0]; // Rolex/VC 6-digit + suffix
  
  // Only fall back to generic digit patterns if we haven't found anything.
  // 4-5 digit + letter comes BEFORE bare 6-digit to avoid price smashing.
  if (!ref) {
    ref = (text.match(/\b\d{4,5}[A-Z]{1,4}\b/i) || [])[0];  // 5296R, 5205R, 15500ST
  }
  if (!ref) {
    ref = (text.match(/\b\d{4}[\s\/-]?\d?[A-Z]{1,3}\b/i) || [])[0];   // 1166 10LN, 5712 1A
  }
  if (!ref) {
    ref = (text.match(/\b\d{6}[A-Z]{0,4}\b/i) || [])[0];              // bare 6-digit (only as last resort)
  }
  
  // REJECT reference candidates that are obviously prices.
  // A 5-6 digit token followed immediately by a known currency suffix
  // (e.g. "152000hkd") is a PRICE, not a reference. Also reject 6-digit
  // pure-number tokens >= 100,000 that appear with a currency indicator.
  if (ref) {
    const refClean = ref.trim().toUpperCase();
    // Pattern: "152000HKD" — 5-6 digits + known currency suffix
    if (/^\d{5,6}(?:HKD|USD|EUR|CHF|GBP|SGD|USDT|JPY|AED)$/i.test(refClean)) {
      ref = null;  // This is a price+currency, not a reference
    }
    // Pattern: pure 6-digit number >= 100,000 with currency nearby
    if (ref && /^\d{6}$/.test(refClean)) {
      const val = parseInt(refClean, 10);
      if (val >= 100000 && val <= 5000000 && CURRENCY_FROM_TEXT) {
        ref = null;  // This is a price in HKD/USD/etc.
      }
    }
  }

  if (ref) out.reference = ref.trim().toUpperCase().replace(/\s+/g, '');

  // Brand from reference if still unknown.
  if (out.brand === 'Unknown' && out.reference) {
    const inferred = brandFromRef(out.reference);
    if (inferred !== 'Unknown') out.brand = inferred;
  }

  // Condition
  if (/\bnew\b|unworn|\bbnib\b|sealed|full\s*set|\bnos\b|\bmint\b/i.test(text)) out.condition = 'New';
  else if (/\bused\b|pre[\s-]?owned|worn/i.test(text)) out.condition = 'Used';

  // Dial color — explicit text first (mirrors parseEngine.ts patterns)
  const DIAL_PATTERNS = [
    [/\b(?:tiffany|tiffanie|tiff)\s*(?:blue|dial)?\b/i, 'Tiffany'],
    [/\b(?:ice\s*blue|icy\s*blue|light\s*blue|powder\s*blue)\b/i, 'Ice Blue'],
    [/\bdiamond\s*(?:dial|set|pave)?\b/i, 'Diamond'],
    [/\b(?:blue\s*(?:dial)?)(?!\s*(?:strap|box|card|papers))\b/i, 'Blue'],
    [/\b(?:black\s*(?:dial)?)(?!\s*(?:strap|box|card|papers))\b/i, 'Black'],
    [/\b(?:green\s*(?:dial)?)(?!\s*(?:strap|box|card|papers))\b/i, 'Green'],
    [/\b(?:white\s*(?:dial)?)(?!\s*(?:strap|box|card|papers|gold|steel|platinum|rotor))\b/i, 'White'],
    [/\b(?:silver\s*(?:dial)?)\b/i, 'Silver'],
    [/\b(?:grey|gray)\s*(?:dial)?\b/i, 'Grey'],
    [/\b(?:brown|chocolate|zebra)\s*(?:dial)?\b/i, 'Brown'],
    [/\b(?:pink|rose)\s*(?:dial)?\b/i, 'Pink'],
    [/\b(?:purple|violet|plum)\s*(?:dial)?\b/i, 'Purple'],
    [/\byellow\s*(?:dial)?(?!\s*gold)\b/i, 'Yellow'],
    [/\b(?:orange)\s*(?:dial)?\b/i, 'Orange'],
    [/\b(?:champagne|champ)\s*(?:dial)?\b/i, 'Champagne'],
    [/\bred\s*(?:dial)?\b/i, 'Red'],
  ];
  for (const [re, color] of DIAL_PATTERNS) {
    if (re.test(text)) { out.dialColor = color; break; }
  }
  // Infer from reference suffix if no explicit dial color found (Rolex-only)
  if (!out.dialColor && out.reference) {
    const SUFFIX_DIAL = {
      'BLNR': 'Blue Black', 'BLRO': 'Red Blue', 'GRNR': 'Green Black',
      'CHNR': 'Brown', 'RBOW': 'Rainbow',
      'LB': 'Blue', 'LV': 'Green', 'LN': 'Black', 'ST': 'Blue',
      'OR': 'Pink', 'TI': 'Grey', 'BC': 'Black',
    };
    const refUpper = out.reference.toUpperCase();
    // Only apply to Rolex 6-digit refs (e.g. 116610LN, 126710BLNR)
    // Patek/AP/RM suffixes = case material (R=Rose Gold, ST=Steel), NOT dial color
    const isRolexRef = /^\d{6}[A-Z]{2,5}$/.test(refUpper);
    if (isRolexRef) {
      const suffixes = Object.keys(SUFFIX_DIAL).sort((a, b) => b.length - a.length);
      for (const suf of suffixes) {
        if (refUpper.endsWith(suf)) { out.dialColor = SUFFIX_DIAL[suf]; break; }
      }
    }
  }

  // Year
  const y = (text.match(/\b(20[12]\d)\b/) || [])[1];
  if (y) out.year = parseInt(y, 10);

  // Price + currency (handles "1.2M", "850k", "HKD 970,000", "$125,000",
  // and right-side currency: "152000hkd", "138000USD").
  let priceM =
    text.match(/([\d.,]+)\s*([MmKk])\s*(?:HKD|USD|EUR|CHF|GBP|SGD|USDT)?\b/) ||
    text.match(/(?:HKD|USD|EUR|CHF|GBP|SGD|USDT|HK\$|\$|€)\s*([\d.,]{3,})\s*([MmKk])?/i) ||
    text.match(/([\d.,]{4,})\s*(?:HKD|USD|EUR|CHF|GBP|SGD|USDT)\b/i);
  if (priceM) {
    let val = parseFloat(String(priceM[1]).replace(/,/g, ''));
    const suf = (priceM[2] || '').toLowerCase();
    if (suf === 'm') val *= 1_000_000;
    else if (suf === 'k') val *= 1_000;
    if (!isNaN(val) && val >= 100 && val < 10_000_000_000) out.price = Math.round(val);
  }
  // Currency: check standalone ("138k hkd"), suffixed ("152000hkd"),
  // and symbol-based patterns.
  let cur = (text.match(/\b(hkd|usdt|usd|eur|chf|gbp|sgd)\b/i) || [])[1];
  if (!cur) {
    cur = (text.match(/[\d.,]+\s*(hkd|usdt|usd|eur|chf|gbp|sgd)\b/i) || [])[1];
  }
  if (!cur) {
    cur = (/€/.test(text) ? 'EUR' : (/£/.test(text) ? 'GBP' : (/\$/.test(text) ? 'USD' : null)));
  }
  if (cur) out.currency = cur.toUpperCase();

  // Intent detection — classify dealer message as SELL/BUY/INQUIRY/TRADE/ALERT.
  // Must run AFTER brand/reference extraction so we don't confuse intent words
  // with watch brand names.
  const tL = text.toLowerCase();
  if (/\b(wtb|want\b.*\bbuy|looking\s+for|in\s+search\s+of|iso\b|seeking|need\b.*\bwatch)\b/i.test(tL)
      && !/\b(model|reference|ref|daytona|submariner|nautilus)\b/i.test(tL)) {
    out.intent = 'BUY';
  } else if (/\b(ft|f\/t|for\s+trade|trade[\s:].*?\b(for|with))\b/i.test(tL)) {
    out.intent = 'TRADE';
  } else if (/\b(inquiry|inquire|what.?s? the price|info\b.*\bpls|tell me about)\b/i.test(tL)) {
    out.intent = 'INQUIRY';
  } else if (/\b(sold|gone|on hold|reserved)\b/i.test(tL)) {
    out.intent = 'ALERT';
  } else if (out.price > 0) {
    out.intent = 'SELL';
  } else {
    out.intent = 'UNKNOWN';
  }

  return out;
}

// confidence from a code parse alone (how completely did we identify it?)
//
// Re-weighted so a confirmed reference + known brand is enough to IDENTIFY a
// watch even when the dealer omitted price/dial (common in inventory blasts).
// ref(50) + brand(28) = 78 base; catalog agreement (see crossValidate) then
// lifts a clean ID over the 85 gate WITHOUT paying for an LLM call.
// Price/dial/condition/year remain useful but are no longer required for ID.
function codeConfidence(p) {
  let c = 0;
  if (p.reference) c += 50;
  if (p.brand && p.brand !== 'Unknown') c += 28;
  if (p.dialColor) c += 8;
  if (p.condition && p.condition !== 'Unknown') c += 6;
  if (p.price) c += 6;
  if (p.year) c += 2;
  return Math.min(c, 100);
}

// ── Cross-validation: combine independent signals (catalog / image / web) ──
//
// Ported from src/utils/parseEngine.ts applyCrossValidation — previously DEAD
// on the live path. When multiple independent sources agree, we boost
// confidence enough to auto-approve records that no single signal could.
// This is the primary lever for reducing the HUMAN-review queue.
function crossValidate(parsed, signals = {}) {
  let boost = 0;
  const agree = [];
  const disagree = [];

  // 1. Catalog agreement — ref exists AND brand matches the parser.
  if (signals.catalogHit && signals.catalogBrand) {
    const pb = (parsed.brand || '').toLowerCase();
    const cb = signals.catalogBrand.toLowerCase();
    if (parsed.brand && parsed.brand !== 'Unknown' &&
        (pb === cb || pb.includes(cb) || cb.includes(pb))) {
      agree.push('catalog'); boost += 10;            // ref+brand confirmed by curated data
    } else if (!parsed.brand || parsed.brand === 'Unknown') {
      agree.push('catalog-supplies-brand'); boost += 10;
    } else {
      disagree.push('catalog-vs-parser-brand'); boost -= 8;
    }
  } else if (signals.catalogHit) {
    agree.push('catalog-ref'); boost += 6;           // ref verified, brand unknown in catalog
  } else if (parsed.reference) {
    // Catalog MISS on the reference — the parser found a string that looks
    // like a ref but our curated database doesn't know it. This is a strong
    // signal that the parser grabbed a price token or garbled the reference.
    // Penalize to prevent blind brand-from-ref-inference (the "Rolex default").
    if (!signals.catalogHit && signals.catalogSearched) {
      disagree.push('catalog-miss'); boost -= 12;
    }
  }

  // 2. Image agreement — vision saw the same ref/brand.
  if (signals.imageVerdict === 'MATCH') { agree.push('image-match'); boost += 12; }
  else if (signals.imageVerdict === 'MISMATCH') { disagree.push('image-mismatch'); boost -= 30; }

  // 3. Web search agreement.
  if (signals.webSearchConfidence && signals.webSearchConfidence >= 70) {
    if (signals.webSearchBrand && parsed.brand && parsed.brand !== 'Unknown' &&
        signals.webSearchBrand.toLowerCase() !== parsed.brand.toLowerCase()) {
      disagree.push('web-vs-parser-brand'); boost -= 10;
    } else { agree.push('web-search'); boost += 8; }
  }

  // 4. Multi-signal convergence — 3+ independent sources agree → extra bump.
  if (agree.length >= 3) boost += 8;

  return { boost, agree, disagree };
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

// Vision analyze (inlined from _lib/vision.js): reads image blind, extracts dial
// color + brand + reference, compares to text. NO self-HTTP call.
async function visionVerify(origin, imageUrl, reference, brand) {
  const v = await analyzeImage(imageUrl, reference, brand);
  return v;
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

  // 2) CATALOG (code-first, free) — look the reference up in the merged
  //    catalog (catalog.json + enriched_refs.json, 3,556 refs) BEFORE any LLM.
  //    Supplies/confirms brand, fills collection/model, and feeds crossValidate.
  let catalog = { found: false, brand: null };
  if (parsed.reference) {
    catalog = lookupCatalog(parsed.reference);
    if (catalog.found || catalog.brand) {
      // Fill brand if the parser missed it; never overwrite a confident parser brand.
      if ((!parsed.brand || parsed.brand === 'Unknown') && catalog.brand) {
        parsed.brand = catalog.brand;
      }
      if (!parsed.dialColor && catalog.dialColors) {
        parsed.dialColor = String(catalog.dialColors).split(/[;,]/)[0].trim();
      }
      // recompute base confidence now that brand may be filled
      confidence = Math.max(confidence, codeConfidence(parsed));
    }
    stages.push({
      stage: 'CATALOG', engine: 'catalog', confidence,
      data: { found: catalog.found, matchType: catalog.matchType || null, brand: catalog.brand,
              collection: catalog.collection || null, model: catalog.model || null,
              liquidityScore: catalog.liquidityScore ?? null },
      note: catalog.found ? `catalog ${catalog.matchType} hit: ${catalog.brand || 'brand?'} ${catalog.collection || ''}`.trim()
                          : (catalog.brand ? `catalog miss; brand inferred: ${catalog.brand}` : 'catalog miss'),
    });
  }

  // 3) AI TEXT — only when code+catalog STILL couldn't resolve a clean
  //    brand+reference, or confidence is below the gate. Algorithmic-first.
  const hasAnyAiKey = ctx.deepseekKey || ctx.geminiKey || ctx.kimiKey || ctx.anthropicKey || ctx.openaiKey;
  const catalogConfirmed = catalog.found && parsed.reference && parsed.brand && parsed.brand !== 'Unknown';
  const needsAi = !catalogConfirmed && (!parsed.reference || parsed.brand === 'Unknown' || confidence < APPROVE_THRESHOLD);
  if (needsAi && hasAnyAiKey) {
    try {
      const ai = await aiTextParse(ctx, textOnly || chunk, parsed, providerWhitelist);
      // Merge: prefer AI values where code was empty/unknown
      // Use nullish coalescing so falsy code values (Unknown, 0) don't get
      // overwritten by AI nulls, but missing values do.
      parsed = {
        reference: ai.reference || parsed.reference,
        brand: (ai.brand && ai.brand !== 'Unknown' && ai.brand !== null) ? ai.brand : parsed.brand,
        dialColor: ai.dialColor || parsed.dialColor,
        condition: (ai.condition && ai.condition !== 'Unknown' && ai.condition !== null) ? ai.condition : parsed.condition,
        year: ai.year ?? parsed.year,
        price: ai.price ?? parsed.price,
        currency: ai.currency || parsed.currency,
        intent: parsed.intent || 'UNKNOWN',  // preserve regex intent (AI doesn't know this)
      };
      // Fix up null brand from AI if catalog already supplied it
      if ((!parsed.brand || parsed.brand === 'Unknown') && catalog.brand) {
        parsed.brand = catalog.brand;
      }
      // Fix up null brand from AI: re-run brandFromRef on any new reference
      if ((!parsed.brand || parsed.brand === 'Unknown') && parsed.reference) {
        const inferred = brandFromRef(parsed.reference);
        if (inferred !== 'Unknown') parsed.brand = inferred;
      }
      confidence = Math.max(confidence, Math.min(ai.confidence ?? codeConfidence(parsed), 100));
      // If AI surfaced a reference the parser missed, re-check the catalog.
      if (ai.reference && (!catalog.found)) {
        const recheck = lookupCatalog(parsed.reference);
        if (recheck.found) {
          catalog = recheck;
          if ((!parsed.brand || parsed.brand === 'Unknown') && recheck.brand) parsed.brand = recheck.brand;
        }
      }
      stages.push({ stage: 'AI_TEXT', engine: ai._source || 'ai', confidence, data: { ...parsed }, note: `AI parsed messy text (${ai._source})` });
    } catch (e) {
      stages.push({ stage: 'AI_TEXT', engine: 'ai-fallback', confidence, error: e.message, note: 'AI parse failed, kept code result' });
    }
  } else if (catalogConfirmed) {
    stages.push({ stage: 'AI_TEXT', engine: 'skipped', confidence, note: 'AI skipped — catalog already confirmed brand+reference (cost saved)' });
  }

  // 4) ONLINE cross-reference — only when NOT already catalog-confirmed
  //    (no point paying for a web lookup on a ref we already have curated).
  let online = { checked: false, found: false };
  let webSearchConfidence = 0, webSearchBrand = null;
  if (parsed.reference && !catalogConfirmed && confidence < APPROVE_THRESHOLD) {
    online = await onlineCrossRef(parsed.brand, parsed.reference);
    if (online.found) {
      if (online.confidence) { webSearchConfidence = online.confidence; webSearchBrand = online.web_data?.brand || null; }
    }
    stages.push({ stage: 'ONLINE', engine: 'web', confidence, data: online, note: online.note });
  }

  // 5) IMAGE / URL verification (online + picture) — multi-image support
  let imageVerdict = null;
  let bestVisionResult = null;
  const imageResults = [];

  // Process ALL image URLs (up to 3 to avoid timeout), pick the best legible result
  for (let imgIdx = 0; imgIdx < Math.min(imageUrls.length, 3); imgIdx++) {
    const img = imageUrls[imgIdx];
    const v = await visionVerify(ctx.origin, img, parsed.reference, parsed.brand);
    v._imageUrl = img;
    imageResults.push(v);

    // Track the best result (prefer legible + highest confidence)
    if (v.legible && (!bestVisionResult || v.confidence > bestVisionResult.confidence)) {
      bestVisionResult = v;
    }

    // If we found a MISMATCH, stop — this is a safety signal
    if ((v.verificationVerdict || v.verdict) === 'MISMATCH') {
      imageVerdict = 'MISMATCH';
      break;
    }
  }

  const targetImage = imageUrls[0] || null;

  if (bestVisionResult) {
    const v = bestVisionResult;
    imageVerdict = imageVerdict || v.verificationVerdict || v.verdict;

    // Fill dial color from vision if text parser didn't get it
    if (v.dialColor && v.dialColor !== 'UNKNOWN' && (!parsed.dialColor || parsed.dialColor === 'UNKNOWN')) {
      parsed.dialColor = v.dialColor;
      confidence = Math.min(100, confidence + 8);
    }

    // Fill brand from vision if parser missed it
    if (v.brand && (!parsed.brand || parsed.brand === 'Unknown')) {
      parsed.brand = v.brand;
      confidence = Math.min(100, confidence + 5);
    }

    const imgCount = imageResults.length;
    stages.push({
      stage: 'IMAGE',
      engine: v.source || 'vision',
      confidence,
      data: v.image || {},
      verdict: imageVerdict,
      note: v.reason + (imgCount > 1 ? ` (best of ${imgCount} images)` : ''),
      dialColor: v.dialColor,
      dialConfidence: v.dialConfidence,
      imagesAnalyzed: imgCount,
    });
  } else if (imageResults.length > 0) {
    // Images were processed but none legible
    const v = imageResults[0];
    imageVerdict = v.verificationVerdict || v.verdict;
    stages.push({
      stage: 'IMAGE',
      engine: v.source || 'vision',
      confidence,
      data: v.image || {},
      verdict: imageVerdict,
      note: v.reason + (imageResults.length > 1 ? ` (${imageResults.length} images analyzed, none legible)` : ''),
    });
  } else if (pageUrls.length) {
    stages.push({ stage: 'IMAGE', engine: 'link', confidence, data: { pageUrl: pageUrls[0] }, note: 'link present (not a direct image URL); text-vs-link compare requires page scrape' });
  }

  // 6) CROSS-VALIDATION — fuse catalog + image + web signals into one boost.
  const cv = crossValidate(parsed, {
    catalogHit: catalog.found,
    catalogBrand: catalog.brand,
    catalogSearched: !!(parsed.reference),  // true if we attempted a catalog lookup
    imageVerdict,
    webSearchConfidence,
    webSearchBrand,
  });
  confidence = Math.min(100, Math.max(0, confidence + cv.boost));
  // Image MISMATCH always forces confidence down hard (safety).
  if (imageVerdict === 'MISMATCH') confidence = Math.min(confidence, 40);
  stages.push({
    stage: 'CROSS_VAL', engine: 'multi-signal', confidence,
    data: { boost: cv.boost, agree: cv.agree, disagree: cv.disagree },
    note: `${cv.agree.length} signal(s) agree${cv.agree.length ? ': ' + cv.agree.join(', ') : ''}${cv.disagree.length ? ' | disagree: ' + cv.disagree.join(', ') : ''} (boost ${cv.boost >= 0 ? '+' : ''}${cv.boost})`,
  });

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
    rawEntry: chunk,              // original text preserved for human review
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

  // Separate trailing image URLs from the raw text — these are shared
  // gallery images that should be attached to ALL watches in the paste.
  const sharedImages = [];
  // Extract image URLs from the full raw text that appear AFTER the last watch-like token
  const allUrls = extractUrls(text);
  const sharedImgUrls = allUrls.filter(isImageUrl);

  // Attach shared images to every chunk that doesn't already have its own image
  if (sharedImgUrls.length > 0 && chunks.length > 1) {
    chunks = chunks.map(c => {
      const hasOwnImage = extractUrls(c).some(isImageUrl);
      if (!hasOwnImage) {
        return c + '\n' + sharedImgUrls.join('\n');
      }
      return c;
    });
  }

  // Also attach any explicitly-uploaded image URLs from the request body
  if (Array.isArray(bodyImages) && bodyImages.length) {
    chunks = chunks.map(c => {
      const hasOwnImage = extractUrls(c).some(isImageUrl);
      return !hasOwnImage ? `${c}\n${bodyImages.join('\n')}` : c;
    });
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
      catalogHits: results.filter(r => r.stages?.some(s => s.stage === 'CATALOG' && s.data?.found)).length,
      aiSkipped: results.filter(r => r.stages?.some(s => s.stage === 'AI_TEXT' && s.engine === 'skipped')).length,
      threshold: APPROVE_THRESHOLD,
      providerUsed: providerPref,
      latencyMs: Date.now() - (ctx.startTime || Date.now()),
    };

    // Anti-hallucination: convert "Unknown" sentinels to null in client-facing response
    const cleanResults = results.map(r => {
      if (!r.parsed) return r;
      const p = { ...r.parsed };
      if (p.brand === 'Unknown') p.brand = null;
      if (p.condition === 'Unknown') p.condition = null;
      if (p.dialColor === 'UNKNOWN') p.dialColor = null;
      return { ...r, parsed: p };
    });

    return res.status(200).json({ success: true, summary, watches: cleanResults });
  } catch (e) {
    console.error('[clean-analyze]', e.message);
    return res.status(500).json({ error: e.message });
  }
}

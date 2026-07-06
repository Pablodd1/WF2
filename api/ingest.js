/**
 * LIVE INGEST ENDPOINT  —  POST /api/ingest
 * JASS v4.0 Oracle — 3-layer parser with type detection + multi-watch splitter
 *
 * Receives raw WhatsApp/Telegram dealer messages, runs the full
 * parse pipeline, and persists results to Supabase.
 *
 * POST body: { rawMessage, channelId?, source? }
 * GET /api/ingest — returns last 50 live records from Supabase
 */

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const APPROVE_THRESHOLD = 90;
const HUMAN_THRESHOLD = 70;

const RATES = {
  USD: 1.0, USDT: 1.0, HKD: 0.128, EUR: 1.08,
  GBP: 1.27, CHF: 1.13, SGD: 0.74, AUD: 0.65,
  CAD: 0.73, JPY: 0.0066, CNY: 0.138, RMB: 0.138,
};

function toUSD(amount, currency) {
  return Math.round(amount * (RATES[(currency || 'USD').toUpperCase()] || 1.0));
}

// ── FIX 3: Extended dial list ──────────────────────────────────
const DIAL_WORDS = [
  'mother of pearl', 'mop', 'meteorite', 'skeleton', 'sundust', 'obsidian',
  'rhodium', 'turquoise', 'chocolate', 'salmon', 'opal', 'onyx', 'cream',
  'ice blue', 'tiffany', 'wimbledon', 'copper', 'lapis', 'burgundy', 'champagne',
  'black', 'blue', 'white', 'green', 'silver', 'brown', 'grey', 'gray',
  'pink', 'red', 'orange', 'yellow', 'gold', 'purple', 'ivory',
];

// ── FIX 6: Dealer slang → collection mapping ──────────────────
const SLANG_TO_COLLECTION = {
  'hulk': 'Submariner Date', 'kermit': 'Submariner Date', 'starbucks': 'Submariner Date',
  'smurf': 'Submariner Date', 'batman': 'GMT Master II', 'batgirl': 'GMT Master II',
  'pepsi': 'GMT Master II', 'rootbeer': 'GMT Master II', 'coke': 'GMT Master II',
  'sprite': 'GMT Master II', 'bruce wayne': 'GMT Master II',
  'polar': 'Explorer II', 'ghost': 'Daytona', 'panda': 'Daytona',
  'reverse panda': 'Daytona', 'zebra': 'Daytona', 'land dweller': 'Sky-Dweller',
  'tiffany': 'Oyster Perpetual', 'wimbledon': 'Datejust', 'daytona': 'Daytona',
  'submariner': 'Submariner', 'sea-dweller': 'Sea-Dweller', 'deepsea': 'Deepsea',
  'explorer': 'Explorer', 'gmt': 'GMT Master II', 'datejust': 'Datejust',
  'nautilus': 'Nautilus', 'aquanaut': 'Aquanaut', 'overseas': 'Overseas',
  'royal oak': 'Royal Oak', 'royal oak offshore': 'Royal Oak Offshore',
  'day-date': 'Day-Date', 'president': 'Day-Date',
};

// ── FIX 1+2+4+5+6: Full parser v4.0 ──────────────────────────

function inferBrandFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase().replace(/[^A-Z0-9\/\-]/g, '');
  if (/^[345]\d{3}[A-Z]?\//.test(r)) return 'Patek Philippe';
  if (/^[345]\d{3}[A-Z]$/.test(r)) return 'Patek Philippe';
  if (/^\d{5}[A-Z]{2,4}$/.test(r)) return 'Audemars Piguet';
  // FIX 1: 5-6 digit refs for Rolex
  if (/^\d{5,6}[A-Z]{0,4}$/.test(r)) return 'Rolex';
  if (/^RM\d{2}/.test(r)) return 'Richard Mille';
  if (/^(85|47|49)\d{3}[A-Z\/]/.test(r)) return 'Vacheron Constantin';
  if (/^(79|70)\d{4}[A-Z]*$/.test(r)) return 'Tudor';
  if (/^IW\d{4,6}$/.test(r)) return 'IWC';
  if (/^(WSSA|WSNM|WGNM|WJSA|CRWS|CRWG)/.test(r)) return 'Cartier';
  return null;
}

function inferDialFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase();
  const SUFFIX_MAP = {
    LN: 'Black', LB: 'Blue', LV: 'Green', CHNR: 'Brown', OR: 'Pink',
    TI: 'Grey', BC: 'Black', ST: 'Blue', GRNR: 'Black', BLNR: 'Blue',
    BLRO: 'Red Blue', VTNR: 'Green Black', RBR: 'Diamond',
  };
  for (const [sfx, color] of Object.entries(SUFFIX_MAP)) {
    if (r.endsWith(sfx)) return color;
  }
  const last = r.split(/[\/\-]/).pop() || '';
  if (last.endsWith('G') && last.length > 2) return 'Blue';
  if (last.endsWith('J') && last.length > 2) return 'Champagne';
  if (last.endsWith('P') && last.length > 2) return 'Blue';
  if (last.endsWith('R') && last.length > 2) return 'Brown';
  return null;
}

function parsePrice(text, knownRef) {
  const t = text.replace(/,/g, '');
  // Million: 1.8M, 1.8 million, 1.8 mio
  const mMatch = t.match(/\b(\d{1,4}(?:\.\d{1,3})?)\s*(?:m|million|mio)\b/i);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1_000_000);
  // K suffix: 93k, 308K
  const kMatch = t.match(/\b(\d{1,4}(?:\.\d{1,2})?)\s*k\b/i);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  // FIX 4: Plain number — skip years (20xx) AND skip the known ref
  const nums = t.match(/\b(\d{4,8})\b/g);
  if (nums) {
    for (const n of nums) {
      const v = parseInt(n, 10);
      if (v >= 1900 && v <= 2026) continue;
      if (v > 99999999) continue;
      // Skip if this number is the reference
      if (knownRef && String(v) === String(knownRef)) continue;
      return v;
    }
  }
  return null;
}

function parseCurrency(text) {
  const t = text.toUpperCase();
  if (/\bUSDT\b/.test(t)) return 'USDT';
  if (/\bHKD\b|HK\$/.test(t)) return 'HKD';
  if (/\bEUR\b|€/.test(t)) return 'EUR';
  if (/\bGBP\b|£/.test(t)) return 'GBP';
  if (/\bCHF\b/.test(t)) return 'CHF';
  if (/\bSGD\b/.test(t)) return 'SGD';
  if (/\bAED\b/.test(t)) return 'AED';
  if (/\bJPY\b/.test(t)) return 'JPY';
  if (/\bUSD\b|\$/.test(t)) return 'USD';
  // WhatsApp format: 💰 followed by number without currency = HKD
  if (/💰/.test(t)) return 'HKD';
  return null;
}

// ── FIX 5: Brand with proximity weighting ──────────────────────
const BRAND_PATTERNS = [
  [/\bpatek\s*philippe\b|\bpp\b(?!\w)/i, 'Patek Philippe'],
  [/\baudemars\s*piguet\b|\bap\b(?!\w)/i, 'Audemars Piguet'],
  [/\brichard\s*mille\b|\brm\b(?!\w)/i, 'Richard Mille'],
  [/\bvacheron\s*constantin\b|\bvc\b(?!\w)/i, 'Vacheron Constantin'],
  [/\brolex\b/i, 'Rolex'],
  [/\bomega\b/i, 'Omega'],
  [/\bcartier\b/i, 'Cartier'],
  [/\btudor\b/i, 'Tudor'],
  [/\bblancpain\b/i, 'Blancpain'],
  [/\biwc\b/i, 'IWC'],
  [/\bpanerai\b/i, 'Panerai'],
  [/\bjaeger\s*lecoultre\b|\bjlc\b/i, 'Jaeger-LeCoultre'],
  [/\bhublot\b/i, 'Hublot'],
  [/\bbreitling\b/i, 'Breitling'],
  [/\blange\b/i, 'A. Lange & Sohne'],
  [/\btag\s*heuer\b/i, 'TAG Heuer'],
  [/\bgrand\s*seiko\b/i, 'Grand Seiko'],
];

function extractBrand(text, ref) {
  let bestBrand = null;
  let bestScore = 0;
  let refPos = null;
  if (ref) {
    const rm = text.match(new RegExp(ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    if (rm) refPos = rm.index;
  }

  for (const [pattern, brandName] of BRAND_PATTERNS) {
    const matches = text.match(pattern);
    if (!matches) continue;
    let proximityBonus = 0;
    if (refPos != null) {
      const dist = Math.abs((text.search(pattern)) - refPos);
      if (dist < 80) proximityBonus = 2;
    }
    const inferredBrand = inferBrandFromRef(ref);
    const refBonus = (inferredBrand === brandName) ? 1 : 0;
    const score = 1 + proximityBonus + refBonus;
    if (score > bestScore) { bestScore = score; bestBrand = brandName; }
  }
  return bestBrand || inferBrandFromRef(ref);
}

function extractDial(text, ref) {
  const lower = text.toLowerCase();
  // Try 2-word dials first (longest match)
  for (const dw of DIAL_WORDS.slice().sort((a, b) => b.length - a.length)) {
    const pattern = dw.includes('of') || dw.includes(' ')
      ? new RegExp('\\b' + dw.replace(/\s+/g, '[- ]?') + '\\b', 'i')
      : new RegExp('\\b' + dw + '\\b', 'i');
    if (pattern.test(lower)) {
      return dw.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    }
  }
  if (ref) return inferDialFromRef(ref);
  return null;
}

function extractCondition(text) {
  const t = text.toLowerCase();
  if (/\bnew\b|unworn|bnib|brand\s*new|stickers?\s*(?:on|intact)/i.test(t)) return 'New';
  if (/\bused\b|pre[- ]?owned|worn|pre[- ]?enjoyed/i.test(t)) return 'Used';
  if (/\bmint\b|excellent|like new|superb/i.test(t)) return 'Like New';
  if (/\bgood\b|fair|decent|nice\s*condition/i.test(t)) return 'Good';
  return null;
}

function extractYear(text) {
  const y = text.match(/[Nn]\d\s*\/\s*(\d{4})/);
  if (y) return parseInt(y[1], 10);
  const fallback = text.match(/\b(19\d{2}|20[01]\d|202[0-6])\b/);
  if (fallback) return parseInt(fallback[1], 10);
  return null;
}

function parseFull(rawMsg, knownRef) {
  const text = rawMsg || '';
  // FIX 1: 5-6 digit refs
  let ref = null;
  const rmM = text.match(/\bRM\s?\d{2}[-\s]?\d{2}[A-Z]?(?:-[A-Z]{2})?\b/i);
  const ppM = text.match(/\b[345]\d{3}[A-Z]?\/\d{1,4}[A-Z]{0,4}(?:-\d{3})?\b/i);
  const shortPP = text.match(/\b[345]\d{3}[A-Z]\b/i);
  const apM = text.match(/\b\d{5}[A-Z]{2,4}\b/i);
  const rolexM = text.match(/\b\d{5,6}[A-Z]{0,4}\b/i); // FIX 1: was 6, now 5-6
  if (rmM) ref = rmM[0].toUpperCase().replace(/\s/g, '');
  else if (ppM) ref = ppM[0].toUpperCase();
  else if (shortPP) ref = shortPP[0].toUpperCase();
  else if (apM) ref = apM[0].toUpperCase();
  else if (rolexM) ref = rolexM[0].toUpperCase();

  // FIX 5: Brand with proximity
  const brand = extractBrand(text, ref);
  // FIX 3: Full dial list
  const dial = extractDial(text, ref);
  const condition = extractCondition(text);
  const year = extractYear(text);
  // FIX 2+4: Price + currency
  const price = parsePrice(text, knownRef);
  const currency = parseCurrency(text) || 'USD';

  // JASS v4.0 scoring: brand 25% + ref 25% + price 20% + dial 10% + cond 8% + year 7% + currency 5%
  let confidence = 0;
  if (brand && brand !== 'Unknown') confidence += 25;
  if (ref) confidence += 25;
  if (price) confidence += 20;
  if (dial) confidence += 10;
  if (condition) confidence += 8;
  if (year) confidence += 7;
  if (currency) confidence += 5;

  return { brand, ref, dial, condition, year, price, currency, confidence };
}

// ── MESSAGE TYPE DETECTION ──────────────────────────────────

function detectType(rawMsg) {
  const t = rawMsg.toLowerCase().trim();
  const first = t.substring(0, 40);

  // WTB: message starts with or contains strong WTB signal
  if (/^wtb\b|^wtt\b|^(?:want|looking|need|searching|hunting)[\s,.]/.test(first)) return 'WTB';
  if (/\bwtb\b|\bwant\s*(?:to\s*)?(?:buy|pay)\b|\blooking\s*(?:for|to\s*buy)\b/i.test(t)) return 'WTB';

  // NTQ: name your price / make an offer
  if (/\bntq\b|\bname\s*your\s*price\b|\bmake\s*an?\s*offer\b/i.test(t)) return 'NTQ';

  // TRADE: trade/swap/exchange (but not "open to trade" in WTS context)
  if (/\b(?:trade|swap|exchange|swop)\b/i.test(t)) {
    if (/\b(?:for\s*trade|open\s*to\s*trade|trade\s*possible)\b/i.test(t)) return 'WTS';
    if (/^trade\s|^swap\s/i.test(t) || /\bmy\s.+\sfor\s.+$/im.test(t)) return 'TRADE';
    return 'WTS';
  }

  // MULTI: 3+ watch lines in price list format
  const lines = rawMsg.split(/\n/).map(l => l.trim()).filter(Boolean);
  let watchLines = 0;
  for (const line of lines) {
    const hasRef = /\b\d{4,6}[A-Z]{0,4}\b/i.test(line);
    const hasPrice = /\b(\d{3,8})\b/.test(line);
    if (hasRef && hasPrice) watchLines++;
  }
  if (watchLines >= 3) return 'MULTI';

  return 'WTS';
}

// ── MULTI-WATCH SPLITTER ────────────────────────────────────

function splitMulti(rawMsg) {
  const lines = rawMsg.split(/\n/).map(l => l.trim()).filter(Boolean);
  const watches = [];
  let header = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip pure header/emoji lines
    if (/\b(?:rolex|patek|remark|updated|ready\s*stock|stock)\b/i.test(line)
        && !/\b\d{4,6}[A-Z]{0,4}\b/i.test(line)
        && line.length < 60) {
      header = line;
      continue;
    }

    // Try to extract ref from this line
    const refM = line.match(/\b(\d{4,6}[A-Z]{0,4})\b/i);
    if (!refM) continue;

    // Text before the ref might have brand/context
    const afterRef = line.substring(refM.index + refM[0].length);
    
    // Extract price from afterRef (the 💰 symbol + price or just the price)
    // For lines like 🏷️52506 N3 FS💰300000
    let price = null;
    const pm = afterRef.match(/💰\s*(\d{4,8})\b/);
    if (pm) price = pm[1];
    if (!price) {
      const pm2 = afterRef.match(/\b(\d{4,8})\b/);
      if (pm2 && String(pm2[1]) !== String(refM[1])) price = pm2[1];
    }
    
    // Extract dial from description (words before 💰)
    let dial = null;
    const beforePrice = afterRef.split('💰')[0];
    const dialM = beforePrice.match(/\b(blue|black|green|white|brown|grey|gray|silver|pink|purple|red|orange|yellow|gold|wim|lub|oys|rom|jub)\b/i);
    if (dialM) {
      const dm = dialM[1].toLowerCase();
      const dialMap = { wim: 'Wimbledon', lub: 'Blue', oys: 'Silver', rom: 'Roman', jub: 'Silver' };
      dial = dialMap[dm] || dm.charAt(0).toUpperCase() + dm.slice(1);
    }
    
    // Extract condition (N3, N4, FS)
    let condition = null;
    const condM = beforePrice.match(/FS/i);
    if (condM) condition = 'Full Set';
    
    const watchMsg = header ? `${header}\n${line}` : line;

    watches.push({
      rawMessage: watchMsg,
      parsedRef: refM[1],
      parsedPrice: price,
      rest: afterRef,
    });
  }

  return watches;
}

// ── LLM ENRICH ────────────────────────────────────────────

async function llmEnrich(rawMsg, parsed, apiKey) {
  const resp = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `You are a luxury watch expert. Extract watch data from dealer messages. Return ONLY JSON with: brand, reference, dialColor, condition, year, price, currency, confidence (0-100). N5/2026 = New year 2026. k = thousands, m = millions. $ = USD. HK$ or HKD = Hong Kong Dollar. € = Euro. £ = GBP. USDT = crypto. Be precise about reference numbers.`
        },
        {
          role: 'user',
          content: `Regex result: ${JSON.stringify(parsed)}\nMessage: "${rawMsg}"\nReturn JSON only:`
        },
      ],
      max_tokens: 200, temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  });
  if (!resp.ok) throw new Error(`DeepSeek ${resp.status}`);
  const d = await resp.json();
  return JSON.parse(d.choices[0].message.content);
}

function verdict(parsed) {
  const hasRef = !!(parsed.ref && parsed.ref.length > 2);
  const hasBrand = !!(parsed.brand && parsed.brand !== 'Unknown');
  if (!hasRef && !hasBrand) return 'RECYCLE';
  if (parsed.confidence < 35) return 'RECYCLE';
  if (parsed.confidence >= APPROVE_THRESHOLD && hasRef && hasBrand) return 'APPROVED';
  if (parsed.confidence >= HUMAN_THRESHOLD) return 'HUMAN';
  return 'RECYCLE';
}

async function supabaseUpsert(record, supabaseUrl, serviceKey) {
  const resp = await fetch(`${supabaseUrl}/rest/v1/watch_records`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([record]),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Supabase upsert failed: ${err}`);
  }
}

// ── SINGLE MESSAGE PROCESSOR ───────────────────────────────

async function processMessage(rawMessage, channelId, source, supabaseUrl, serviceKey, deepseekKey) {
  // Stage 0: Detect type
  const msgType = detectType(rawMessage);
  const isMulti = msgType === 'MULTI';

  let messages = [{ rawMessage, channelId, source, isMulti, groupId: null }];

  // Split multi-watch messages
  if (isMulti) {
    const groupId = `multi_${Date.now()}_${Math.random().toString(36).substr(2,4)}`;
    const split = splitMulti(rawMessage);
    messages = split.map((s, i) => ({
      rawMessage: s.rawMessage,
      channelId,
      source,
      isMulti: true,
      groupId,
      groupIndex: i,
      groupTotal: split.length,
      parsedRef: s.parsedRef,
      parsedPrice: s.parsedPrice,
    }));
  }

  const results = [];
  for (const msg of messages) {
    // Pass the splitter's ref hint + price to parseFull so price doesn't eat the ref
    const knownRef = msg.parsedRef || null;
    let parsed = parseFull(msg.rawMessage, knownRef);
    // If the splitter found a price and the regex parser didn't, use the splitter's
    if (!parsed.price && msg.parsedPrice) {
      parsed.price = parseInt(msg.parsedPrice, 10);
      if (parsed.price) parsed.confidence = Math.min(100, parsed.confidence + 20);
    }
    let usedLLM = false;

    if (parsed.confidence < HUMAN_THRESHOLD && parsed.ref && deepseekKey) {
      try {
        const llm = await llmEnrich(msg.rawMessage, parsed, deepseekKey);
        if (!parsed.brand && llm.brand && llm.brand !== 'Unknown') parsed.brand = llm.brand;
        if (!parsed.ref && llm.reference) parsed.ref = llm.reference;
        if (!parsed.dial && llm.dialColor && llm.dialColor !== 'Unknown') parsed.dial = llm.dialColor;
        if (!parsed.condition && llm.condition) parsed.condition = llm.condition;
        if (!parsed.year && llm.year) parsed.year = llm.year;
        if (!parsed.price && llm.price) parsed.price = llm.price;
        if (!parsed.currency && llm.currency && llm.currency !== 'Unknown') parsed.currency = llm.currency;
        parsed.confidence = Math.max(parsed.confidence, parseInt(llm.confidence) || 0);
        usedLLM = true;
      } catch { /* keep regex result */ }
    }

    const v = verdict(parsed);
    const priceUSD = parsed.price ? toUSD(parsed.price, parsed.currency || 'USD') : null;

    const record = {
      id: `live_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      raw_message: msg.rawMessage,
      brand: parsed.brand || 'Unknown',
      reference: parsed.ref || null,
      dial_color: parsed.dial || null,
      condition: parsed.condition || null,
      year: parsed.year || null,
      price_raw: parsed.price || null,
      price_usd: priceUSD,
      currency: parsed.currency || null,
      confidence: parsed.confidence,
      verdict: v,
      source,
      channel_id: channelId,
      llm_used: usedLLM,
      created_at: new Date().toISOString(),
    };

    let persisted = false;
    let persistError = null;
    if (supabaseUrl && serviceKey) {
      try {
        await supabaseUpsert(record, supabaseUrl, serviceKey);
        persisted = true;
      } catch (e) {
        console.error('[ingest] Supabase write failed:', e.message);
        persistError = e.message;
      }
    } else {
      persistError = `supabase not configured: url=${!!supabaseUrl} key=${!!serviceKey}`;
    }

    results.push({ ...record, persisted, _upsert_error: persistError });
  }

  return results;
}

// ── MAIN HANDLER ────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  if (req.method === 'GET') {
    if (!supabaseUrl || !serviceKey) {
      return res.status(200).json({ count: 0, records: [], status: 'supabase_not_configured' });
    }
    try {
      const resp = await fetch(
        `${supabaseUrl}/rest/v1/watch_records?order=created_at.desc&limit=50`,
        { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
      );
      const records = await resp.json();
      return res.status(200).json({ count: records.length, records, status: 'ok' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  let rawMessage = body.rawMessage;
  let channelId = body.channelId || body.channel_id || 'direct';
  let source = body.source || 'api';

  if (!rawMessage && body.message?.text) {
    rawMessage = body.message.text;
    channelId = String(body.message.chat?.id || 'telegram');
    source = 'telegram';
  }

  if (!rawMessage || typeof rawMessage !== 'string' || rawMessage.trim().length < 5) {
    return res.status(400).json({ error: 'rawMessage required (min 5 chars)' });
  }

  try {
    const results = await processMessage(rawMessage, channelId, source, supabaseUrl, serviceKey, deepseekKey);
    return res.status(200).json({
      success: true,
      messageType: detectType(rawMessage),
      isMulti: results.length > 1,
      records: results.map(r => ({
        id: r.id,
        verdict: r.verdict,
        brand: r.brand,
        reference: r.reference,
        confidence: r.confidence,
        priceUSD: r.price_usd,
        currency: r.currency,
        listing_type: r.listing_type,
        persisted: r.persisted,
        source: r.llm_used ? 'llm' : 'regex',
      })),
    });
  } catch (e) {
    console.error('[ingest] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};

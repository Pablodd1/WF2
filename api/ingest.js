/**
 * LIVE INGEST ENDPOINT  —  POST /api/ingest
 *
 * Receives raw WhatsApp/Telegram dealer messages, runs the full
 * 4-stage parse pipeline, and persists results to Supabase.
 *
 * POST body:
 *   { rawMessage: string, channelId?: string, source?: string }
 *
 * GET /api/ingest — returns last 50 live records from Supabase
 *
 * Telegram bridge: also accepts Telegram webhook format
 *   { message: { text: string, chat: { id } } }
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
  const rate = RATES[(currency || 'USD').toUpperCase()] || 1.0;
  return Math.round(amount * rate);
}

function parsePrice(text) {
  const t = text.replace(/,/g, '');
  const mMatch = t.match(/\b(\d{1,4}(?:\.\d{1,3})?)\s*(?:m|million)\b/i);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1_000_000);
  const kMatch = t.match(/\b(\d{1,4}(?:\.\d{1,2})?)\s*k\b/i);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  const plainMatch = t.match(/\b(\d{4,8})\b/);
  if (plainMatch) return parseInt(plainMatch[1], 10);
  return null;
}

function parseCurrency(text) {
  const t = text.toUpperCase();
  if (/\bUSDTO?\b|USDT/.test(t)) return 'USDT';
  if (/\bHKD\b|HK\$/.test(t)) return 'HKD';
  if (/\bEUR\b|€/.test(t)) return 'EUR';
  if (/\bGBP\b|£/.test(t)) return 'GBP';
  if (/\bCHF\b/.test(t)) return 'CHF';
  if (/\bSGD\b/.test(t)) return 'SGD';
  if (/\bUSD\b|\$/.test(t)) return 'USD';
  return null;
}

function inferBrandFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase().replace(/[^A-Z0-9\/\-]/g, '');
  if (/^[345]\d{3}[A-Z]?\//.test(r)) return 'Patek Philippe';
  if (/^[345]\d{3}[A-Z]$/.test(r)) return 'Patek Philippe';
  if (/^\d{5}[A-Z]{2,4}$/.test(r)) return 'Audemars Piguet';
  if (/^\d{6}[A-Z]{0,4}$/.test(r)) return 'Rolex';
  if (/^RM\d{2}/.test(r)) return 'Richard Mille';
  if (/^(85|47|49)\d{3}[A-Z\/]/.test(r)) return 'Vacheron Constantin';
  return null;
}

function inferDialFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase();
  const map = { LN: 'Black', LB: 'Blue', LV: 'Green', CHNR: 'Brown', OR: 'Pink', TI: 'Grey', BC: 'Black', ST: 'Blue' };
  for (const [sfx, color] of Object.entries(map)) {
    if (r.endsWith(sfx)) return color;
  }
  const last = r.split(/[\/-]/).pop() || '';
  if (last.endsWith('G') && last.length > 2) return 'Blue';
  if (last.endsWith('J') && last.length > 2) return 'Champagne';
  if (last.endsWith('P') && last.length > 2) return 'Blue';
  if (last.endsWith('R') && last.length > 2) return 'Brown';
  return null;
}

function parseFull(rawMsg) {
  const text = rawMsg || '';
  let brand = null;
  if (/\bpp\b|patek\s?philippe|patek/i.test(text)) brand = 'Patek Philippe';
  else if (/\bap\b|audemars\s?piguet/i.test(text)) brand = 'Audemars Piguet';
  else if (/\brm\b|richard\s?mille/i.test(text)) brand = 'Richard Mille';
  else if (/rolex/i.test(text)) brand = 'Rolex';
  else if (/vacheron|constantin/i.test(text)) brand = 'Vacheron Constantin';
  else if (/omega/i.test(text)) brand = 'Omega';
  else if (/cartier/i.test(text)) brand = 'Cartier';

  let ref = null;
  const rmM = text.match(/\bRM\s?\d{2}[-\s]?\d{2}[A-Z]?\b/i);
  const ppM = text.match(/\b[345]\d{3}[A-Z]?\/\d{1,4}[A-Z]{0,4}(?:-\d{3})?\b/i);
  const shortPP = text.match(/\b[345]\d{3}[A-Z]\b/i);
  const apM = text.match(/\b\d{5}[A-Z]{2,4}\b/i);
  const rolexM = text.match(/\b\d{6}[A-Z]{0,4}\b/i);
  if (rmM) ref = rmM[0].toUpperCase().replace(/\s/g, '');
  else if (ppM) ref = ppM[0].toUpperCase();
  else if (shortPP) ref = shortPP[0].toUpperCase();
  else if (apM) ref = apM[0].toUpperCase();
  else if (rolexM) ref = rolexM[0].toUpperCase();

  if (!brand && ref) brand = inferBrandFromRef(ref);

  let dial = null;
  const dialM = text.match(/\b(blue|black|green|white|brown|grey|gray|silver|pink|purple|red|orange|yellow|champagne|tiffany|panda|hulk|zebra|mop|meteorite)\b/i);
  if (dialM) dial = dialM[1].charAt(0).toUpperCase() + dialM[1].slice(1).toLowerCase();
  if (!dial && ref) dial = inferDialFromRef(ref);

  let condition = null;
  if (/\bnew\b|unworn|bnib/i.test(text)) condition = 'New';
  else if (/\bused\b|pre-?owned|worn/i.test(text)) condition = 'Used';
  else if (/\bmint\b|excellent/i.test(text)) condition = 'Like New';

  const yearM = text.match(/[Nn]\d\/(\d{4})/) || text.match(/\b(20[12]\d)\b/);
  const year = yearM ? parseInt(yearM[1], 10) : null;

  const price = parsePrice(text);
  const currency = parseCurrency(text);

  let confidence = 0;
  if (ref) confidence += 40;
  if (brand) confidence += 25;
  if (dial) confidence += 10;
  if (condition) confidence += 8;
  if (price) confidence += 10;
  if (year) confidence += 4;
  if (currency) confidence += 3;

  return { brand, ref, dial, condition, year, price, currency, confidence };
}

async function llmEnrich(rawMsg, parsed, apiKey) {
  const resp = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: `You are a luxury watch expert. Extract watch data from dealer messages. Return ONLY JSON with: brand, reference, dialColor, condition, year, price, currency, confidence (0-100). Blue circle emoji (🔵) = Patek Philippe. N5/2026 = New, year 2026. k = thousands, m = millions.` },
        { role: 'user', content: `Regex result: ${JSON.stringify(parsed)}\nMessage: "${rawMsg}"\nReturn JSON only:` },
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
  return 'HUMAN';
}

async function supabaseUpsert(record, supabaseUrl, serviceKey) {
  const resp = await fetch(`${supabaseUrl}/rest/v1/live_ingest`, {
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  // GET — return recent live records from Supabase
  if (req.method === 'GET') {
    if (!supabaseUrl || !serviceKey) {
      return res.status(200).json({ count: 0, records: [], status: 'supabase_not_configured' });
    }
    try {
      const resp = await fetch(
        `${supabaseUrl}/rest/v1/live_ingest?order=received_at.desc&limit=50`,
        { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
      );
      const records = await resp.json();
      return res.status(200).json({ count: records.length, records, status: 'ok' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Normalize body — support direct POST or Telegram webhook format
  const body = req.body || {};
  let rawMessage = body.rawMessage;
  let channelId = body.channelId || body.channel_id || 'direct';
  let source = body.source || 'api';

  // Telegram webhook format
  if (!rawMessage && body.message?.text) {
    rawMessage = body.message.text;
    channelId = String(body.message.chat?.id || 'telegram');
    source = 'telegram';
  }

  if (!rawMessage || typeof rawMessage !== 'string' || rawMessage.trim().length < 5) {
    return res.status(400).json({ error: 'rawMessage required (min 5 chars)' });
  }

  // Stage 1: regex parse
  let parsed = parseFull(rawMessage);

  // Stage 2: LLM enrichment if needed
  let usedLLM = false;
  if (parsed.confidence < HUMAN_THRESHOLD && parsed.ref && deepseekKey) {
    try {
      const llm = await llmEnrich(rawMessage, parsed, deepseekKey);
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
    raw_message: rawMessage,
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
    received_at: new Date().toISOString(),
  };

  // Persist to Supabase if configured
  let persisted = false;
  if (supabaseUrl && serviceKey) {
    try {
      await supabaseUpsert(record, supabaseUrl, serviceKey);
      persisted = true;
    } catch (e) {
      console.error('[ingest] Supabase write failed:', e.message);
    }
  }

  return res.status(200).json({
    success: true,
    id: record.id,
    verdict: v,
    brand: record.brand,
    reference: record.reference,
    confidence: record.confidence,
    priceUSD,
    currency: record.currency,
    persisted,
    source: usedLLM ? 'llm' : 'regex',
  });
}

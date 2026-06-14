/**
 * SERVER-SIDE MULTI-STAGE PIPELINE API
 * /api/pipeline-parse
 *
 * Stage A: Structured Extraction (regex + optional AI)
 * Stage B: Normalization & Alias Mapping
 * Stage C: Canonical Reference Matching (fuzzy + master catalog)
 * Stage D: IQR Outlier Flagging
 * Stage E: Currency Conversion to USD
 */

const KIMI_API_URL = 'https://api.moonshot.ai/v1/chat/completions';
const APPROVE_THRESHOLD = 85;
const RECYCLE_FLOOR = 35;

// ─── Currency rates ───
let _rates = {
  USD: 1.0, HKD: 0.128, EUR: 1.08, GBP: 1.27, CHF: 1.13,
  JPY: 0.0066, SGD: 0.74, AUD: 0.65, CAD: 0.73, USDT: 1.0, CNY: 0.138,
};
let _ratesExpiry = 0;

async function refreshRates() {
  if (Date.now() < _ratesExpiry) return _rates;
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD', { signal: ctrl.signal });
    const d = await r.json();
    if (d.rates) {
      _rates = {
        USD: 1.0,
        HKD: d.rates.HKD ? 1 / d.rates.HKD : 0.128,
        EUR: d.rates.EUR ? 1 / d.rates.EUR : 1.08,
        GBP: d.rates.GBP ? 1 / d.rates.GBP : 1.27,
        CHF: d.rates.CHF ? 1 / d.rates.CHF : 1.13,
        JPY: d.rates.JPY ? 1 / d.rates.JPY : 0.0066,
        SGD: d.rates.SGD ? 1 / d.rates.SGD : 0.74,
        AUD: d.rates.AUD ? 1 / d.rates.AUD : 0.65,
        CAD: d.rates.CAD ? 1 / d.rates.CAD : 0.73,
        USDT: 1.0,
        CNY: d.rates.CNY ? 1 / d.rates.CNY : 0.138,
      };
      _ratesExpiry = Date.now() + 3600000;
    }
  } catch { /* keep static */ }
  return _rates;
}

function toUSD(amount, currency) {
  const rate = _rates[currency?.toUpperCase()] || 1.0;
  return Math.round(amount * rate);
}

// ─── Master Catalog ───
let _catalog = null;
let _catalogPromise = null;

async function loadCatalog() {
  if (_catalog) return _catalog;
  if (_catalogPromise) return _catalogPromise;
  _catalogPromise = (async () => {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch('https://watchfacts-poc.vercel.app/parsedWatches.json', { signal: ctrl.signal });
      const rows = await res.json();
      const catalog = new Map();
      const aliasIndex = new Map();
      for (const row of rows) {
        const ref = String(row[2] || '').trim().toUpperCase();
        const brand = String(row[1] || 'Unknown').trim().toUpperCase();
        const dial = String(row[3] || 'UNKNOWN').trim().toUpperCase();
        const priceUSD = Number(row[5]) || 0;
        if (!ref || ref === 'NONE') continue;
        const key = `${brand}::${ref}`;
        if (!catalog.has(key)) {
          catalog.set(key, { ref, brand, dials: new Map(), aliases: new Set() });
          aliasIndex.set(ref.replace(/[^A-Z0-9]/g, ''), ref);
          aliasIndex.set(ref, ref);
        }
        const entry = catalog.get(key);
        entry.aliases.add(ref.replace(/\//g, '-'));
        entry.aliases.add(ref.replace(/\//g, ''));
        if (!entry.dials.has(dial)) entry.dials.set(dial, { prices: [], count: 0 });
        const d = entry.dials.get(dial);
        if (priceUSD > 0) d.prices.push(priceUSD);
        d.count++;
      }
      _catalog = { catalog, aliasIndex };
      return _catalog;
    } catch (e) {
      console.error('[pipeline-parse] catalog load failed:', e.message);
      _catalog = { catalog: new Map(), aliasIndex: new Map() };
      return _catalog;
    }
  })();
  return _catalogPromise;
}

async function lookupRef(ref) {
  const { catalog, aliasIndex } = await loadCatalog();
  const normalized = ref.trim().toUpperCase();
  for (const [, entry] of catalog) {
    if (entry.ref === normalized) return entry;
  }
  const alias = aliasIndex.get(normalized.replace(/[^A-Z0-9]/g, ''));
  if (alias) {
    for (const [, entry] of catalog) {
      if (entry.ref === alias) return entry;
    }
  }
  const patekSlash = normalized.replace(/^(\d{4})([A-Z]\d?)$/, '$1/$2');
  if (patekSlash !== normalized) {
    for (const [, entry] of catalog) {
      if (entry.ref === patekSlash) return entry;
    }
  }
  const rmHyphen = normalized.replace(/^RM(\d{2})(\d{2})$/, 'RM$1-$2');
  if (rmHyphen !== normalized) {
    for (const [, entry] of catalog) {
      if (entry.ref === rmHyphen) return entry;
    }
  }
  return null;
}

// ─── Dictionaries ───
const DIAL_ALIASES = {
  'PANDA': 'WHITE', 'SILVER': 'WHITE', 'IVORY': 'WHITE', 'CREAM': 'WHITE',
  'CHAMPAGNE': 'WHITE', 'ARCTIC': 'WHITE', 'SNOW': 'WHITE', 'WHITE INDEX': 'WHITE',
  'MOP': 'WHITE', 'MOTHER OF PEARL': 'WHITE', 'MOTHER-OF-PEARL': 'WHITE',
  'ONIX': 'BLACK', 'ONYX': 'BLACK', 'JET': 'BLACK', 'NIGHT': 'BLACK',
  'DARK': 'BLACK', 'NOIR': 'BLACK', 'GHOST': 'BLACK',
  'TIFFANY': 'BLUE', 'AZURE': 'BLUE', 'NAVY': 'BLUE', 'ROYAL': 'BLUE',
  'COBALT': 'BLUE', 'SKY': 'BLUE', 'AQUA': 'BLUE', 'AQUAMARINE': 'BLUE',
  'TURQUOISE': 'BLUE', 'ICE BLUE': 'BLUE',
  'HULK': 'GREEN', 'OLIVE': 'GREEN', 'EMERALD': 'GREEN', 'FOREST': 'GREEN',
  'LIME': 'GREEN', 'JADE': 'GREEN', 'MINT': 'GREEN',
  'BRONZE': 'BROWN', 'COPPER': 'BROWN', 'TOBACCO': 'BROWN', 'COFFEE': 'BROWN',
  'CHOCOLATE': 'BROWN', 'ROOT BEER': 'BROWN', 'COGNAC': 'BROWN',
  'GRAY': 'GREY', 'SLATE': 'GREY', 'GRAPHITE': 'GREY', 'TITANIUM': 'GREY',
  'RHODIUM': 'GREY',
  'LAVENDER': 'PURPLE', 'VIOLET': 'PURPLE', 'PLUM': 'PURPLE', 'EGGPLANT': 'PURPLE',
  'BURGUNDY': 'RED', 'CHERRY': 'RED', 'RUBY': 'RED', 'MAROON': 'RED', 'ROSE': 'RED',
  'APRICOT': 'ORANGE', 'TANGERINE': 'ORANGE',
  'GOLD': 'YELLOW', 'HONEY': 'YELLOW', 'SUN': 'YELLOW',
  'ROSE GOLD': 'PINK', 'SALMON': 'PINK', 'BLUSH': 'PINK',
  '\ud83c\udf08': 'MULTI-COLOR', 'RAINBOW': 'MULTI-COLOR', 'MULTICOLOR': 'MULTI-COLOR',
  'METEORITE': 'METEORITE', 'DIAMOND': 'DIAMOND', 'GEMSET': 'DIAMOND',
};

const CONDITION_ALIASES = {
  'NOS': 'NEW', 'NEW OLD STOCK': 'NEW', 'UNWORN': 'NEW', 'FULL STICKER': 'NEW',
  'BNIB': 'NEW', 'BRAND NEW IN BOX': 'NEW', 'SEALED': 'NEW', 'UNUSED': 'NEW',
  'MINT': 'LIKE NEW', 'EXCELLENT': 'LIKE NEW', 'NEAR MINT': 'LIKE NEW',
  'PRE-OWNED': 'USED', 'PREOWNED': 'USED', 'WORN': 'USED', 'VINTAGE': 'USED',
  'NAKED': 'USED', 'WATCH ONLY': 'USED', 'NO BOX': 'USED', 'NO PAPERS': 'USED',
  'NO CARD': 'USED',
};

const BRAND_ALIASES = {
  'PP': 'PATEK PHILIPPE', 'PATEK': 'PATEK PHILIPPE', 'PHILIPPE': 'PATEK PHILIPPE',
  'AP': 'AUDEMARS PIGUET', 'AUDEMARS': 'AUDEMARS PIGUET', 'PIGUET': 'AUDEMARS PIGUET',
  'RM': 'RICHARD MILLE', 'RICHARD': 'RICHARD MILLE', 'MILLE': 'RICHARD MILLE',
  'VC': 'VACHERON CONSTANTIN', 'VACHERON': 'VACHERON CONSTANTIN',
};

function normDial(raw) {
  if (!raw) return 'UNKNOWN';
  const c = String(raw).trim().toUpperCase();
  return DIAL_ALIASES[c] || c;
}

function normCondition(raw) {
  if (!raw) return 'UNKNOWN';
  const c = String(raw).trim().toUpperCase();
  return CONDITION_ALIASES[c] || (['NEW', 'USED', 'LIKE NEW', 'UNKNOWN'].includes(c) ? c : 'UNKNOWN');
}

function normBrand(raw) {
  if (!raw) return 'Unknown';
  const c = String(raw).trim().toUpperCase();
  return BRAND_ALIASES[c] || c.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

// ─── Stage A: Regex Extraction ───
function regexExtract(text) {
  const lower = text.toLowerCase();
  let brand = null, ref = null, dial = null, condition = null, year = null;
  let price = null, currency = null;

  if (/\bpp\b|patek|philippe/.test(lower)) brand = 'Patek Philippe';
  else if (/\bap\b|audemars|piguet/.test(lower)) brand = 'Audemars Piguet';
  else if (/\brm\b|richard\s*mille/.test(lower)) brand = 'Richard Mille';
  else if (/rolex/.test(lower)) brand = 'Rolex';
  else if (/vacheron|constantin/.test(lower)) brand = 'Vacheron Constantin';

  const rmMatch = text.match(/\bRM\s?\d{2}[-\s]?\d{2}[A-Z]?\b/i);
  const ppMatch = text.match(/\b\d{4}\/\d{1,4}[A-Z]{0,2}(?:-\d{3})?\b/i);
  const apMatch = text.match(/\b\d{5}[A-Z]{2,4}\b/i);
  const rolexMatch = text.match(/\b\d{6}[A-Z]{0,4}\b/i);
  const genericMatch = text.match(/\b\d{4,6}[\/\s-]?\d?[A-Z]{1,4}\b/i);

  if (rmMatch) ref = rmMatch[0].toUpperCase().replace(/\s/g, '');
  else if (ppMatch) ref = ppMatch[0].toUpperCase();
  else if (apMatch) ref = apMatch[0].toUpperCase();
  else if (rolexMatch) ref = rolexMatch[0].toUpperCase();
  else if (genericMatch) ref = genericMatch[0].toUpperCase();

  const dialM = text.match(/\b(blue|black|green|white|brown|grey|gray|silver|pink|purple|red|orange|yellow|champagne|mop|mother\s*of\s*pearl|meteorite|diamond|gemset|rainbow|multi[\s-]?color|panda|hulk|tiffany|onyx|root\s*beer|cognac|ice\s*blue)\b/i);
  if (dialM) dial = dialM[1] || dialM[0];
  if (!dial && ref) {
    const su = ref.toUpperCase();
    if (su.endsWith('LN')) dial = 'Black';
    else if (su.endsWith('LB')) dial = 'Blue';
    else if (su.endsWith('LV')) dial = 'Green';
    else if (su.endsWith('CHNR')) dial = 'Brown';
    else if (su.endsWith('R') && !su.includes('RM')) dial = 'Brown';
    else if (su.endsWith('G') && !su.includes('RM')) dial = 'Blue';
    else if (su.endsWith('J')) dial = 'Champagne';
    else if (su.endsWith('P')) dial = 'Blue';
    else if (su.endsWith('ST')) dial = 'Blue';
    else if (su.endsWith('OR')) dial = 'Pink';
    else if (su.endsWith('TI')) dial = 'Grey';
    else if (su.endsWith('BC')) dial = 'Black';
  }

  if (/\bnew\b|unworn|bnib|sealed|full\s*set|full\s*sticker/i.test(text)) condition = 'New';
  else if (/\bused\b|pre[\s-]?owned|worn|vintage/i.test(text)) condition = 'Used';
  else if (/\bmint\b|excellent|near\s*mint/i.test(text)) condition = 'Like New';

  const yM = text.match(/\b(20[12]\d)\b/);
  if (yM) year = parseInt(yM[1], 10);

  const kM = text.match(/\b(\d{1,3})\s?[kK]\b/);
  if (kM) price = parseInt(kM[1], 10) * 1000;
  const pM = text.match(/([\d,]{3,})\s?(HKD|USD|USDT|EUR|hkd|usd|eur|usdt|\$|€)/i);
  if (pM) {
    price = parseInt(pM[1].replace(/,/g, ''), 10) || price;
    const cs = (pM[2] || '').toUpperCase();
    if (cs === '$' || cs === 'USD') currency = 'USD';
    else if (cs === 'HKD' || cs === 'HK$') currency = 'HKD';
    else if (cs === 'EUR' || cs === '€') currency = 'EUR';
    else if (cs === 'USDT') currency = 'USDT';
  }
  if (!currency) {
    if (/\bhkd\b|hk\$/i.test(text)) currency = 'HKD';
    else if (/\busdt\b/i.test(text)) currency = 'USDT';
    else if (/\beur\b|€/i.test(text)) currency = 'EUR';
    else if (/\$|usd\b/i.test(text)) currency = 'USD';
  }

  let confidence = 0;
  if (ref) confidence += 40;
  if (brand) confidence += 25;
  if (dial) confidence += 12;
  if (condition) confidence += 8;
  if (price) confidence += 8;
  if (year) confidence += 4;

  return { brand, ref, dial, condition, year, price, currency, confidence };
}

// ─── AI Parse ───
async function aiParse(kimiKey, rawMessage, currentGuess) {
  const systemPrompt = `You are a luxury watch expert parsing WhatsApp dealer listings.
Return ONLY valid JSON with: reference, dialColor, brand, condition, year, price, currency, confidence.
Reference suffix -> dial: LN=Black LB=Blue LV=Green CHNR=Brown R=Brown G=Blue J=Champagne ST=Blue OR=Pink TI=Grey BC=Black.
No markdown.`;
  const userPrompt = `Regex guess: ${JSON.stringify(currentGuess || {})}\nRaw:\n"""\n${rawMessage}\n"""\nReturn ONLY JSON:`;

  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 18000);
  const r = await fetch(KIMI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kimiKey}` },
    signal: ctrl.signal,
    body: JSON.stringify({
      model: 'kimi-k2.6', temperature: 1, max_tokens: 2048,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    }),
  });
  if (!r.ok) throw new Error(`Kimi ${r.status}`);
  const d = await r.json();
  const content = d.choices?.[0]?.message?.content || d.choices?.[0]?.message?.reasoning_content || '';
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON');
  return JSON.parse(m[0]);
}

// ─── IQR ───
function priceIsOutlier(price, prices) {
  if (prices.length < 5) return false;
  // First filter existing outliers to get clean distribution
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lowBound = q1 - 1.5 * iqr;
  const highBound = q3 + 1.5 * iqr;
  const clean = sorted.filter(p => p >= lowBound && p <= highBound);
  if (clean.length < 5) return false;
  const cq1 = clean[Math.floor(clean.length * 0.25)];
  const cq3 = clean[Math.floor(clean.length * 0.75)];
  const ciqr = cq3 - cq1;
  return price < cq1 - 1.5 * ciqr || price > cq3 + 1.5 * ciqr;
}

// ─── Per-watch analysis ───
async function analyzeOne(chunk, ctx) {
  const stages = [];

  let parsed = regexExtract(chunk);
  let confidence = parsed.confidence;
  stages.push({ stage: 'PARSE', engine: 'regex', confidence, data: { ...parsed }, note: 'code-first extraction' });

  const needsAi = !parsed.ref || !parsed.brand || confidence < APPROVE_THRESHOLD;
  if (needsAi && ctx.kimiKey) {
    try {
      const ai = await aiParse(ctx.kimiKey, chunk, parsed);
      parsed = {
        brand: ai.brand || parsed.brand,
        ref: ai.reference || parsed.ref,
        dial: ai.dialColor || parsed.dial,
        condition: ai.condition || parsed.condition,
        year: ai.year ?? parsed.year,
        price: ai.price ?? parsed.price,
        currency: ai.currency || parsed.currency,
        confidence: Math.min(ai.confidence ?? confidence, 100),
      };
      confidence = parsed.confidence;
      stages.push({ stage: 'AI_TEXT', engine: 'kimi-k2.6', confidence, data: { ...parsed }, note: 'AI parsed messy text' });
    } catch (e) {
      stages.push({ stage: 'AI_TEXT', engine: 'kimi-k2.6', confidence, error: e.message, note: 'AI parse failed' });
    }
  }

  const brand = normBrand(parsed.brand);
  const dialColor = normDial(parsed.dial);
  const condition = normCondition(parsed.condition);
  const currency = parsed.currency || 'USD';
  const originalPrice = parsed.price;
  const year = parsed.year;

  let reference = parsed.ref || '';
  let family = 'OTHER';
  let materials = [];
  let catalogEntry = null;

  if (reference) {
    catalogEntry = await lookupRef(reference);
    if (catalogEntry) {
      reference = catalogEntry.ref;
      const patterns = [
        [/^571[12]|^5726|^5740|^5811|^5980|^5990|^7010|^7118/, 'NAUTILUS'],
        [/^516[47]|^5168|^526[178]|^5968|^5067/, 'AQUANAUT'],
        [/^49/, 'TWENTY~4'], [/^5205/, 'COMPLICATIONS'], [/^7300/, 'TWENTY~4'],
        [/^1263(34|33|31|00|03)|^1262(34|31|33|00|01)/, 'DATEJUST'],
        [/^126(50[0358]|51[89]|600|603|621|622|655|711|715|719|720)/, 'PROFESSIONAL'],
        [/^228(238|235|239|206|396)/, 'DAY-DATE'],
        [/^116(500|503|508|518|519|506|505)/, 'DAYTONA'],
        [/^155(10|51)|^15720|^262(40|31)|^26420|^265(74|79|86)|^15400|^15202|^16202|^26331|^26315|^773(51|50)|^77451|^676(51|50)/, 'ROYAL OAK'],
        [/^RM/, 'RM'],
      ];
      for (const [pat, fam] of patterns) {
        if (pat.test(reference)) { family = fam; break; }
      }
      const m = reference.toUpperCase();
      if (m.includes('ST')) materials.push('STEEL');
      if (m.includes('OR')) materials.push('ROSE GOLD');
      if (m.includes('R') && !m.includes('OR') && !m.includes('RM')) materials.push('ROSE GOLD');
      if (m.includes('G') && !m.includes('GR') && !m.includes('RM')) materials.push('WHITE GOLD');
      if (m.includes('PT')) materials.push('PLATINUM');
      if (m.includes('TI')) materials.push('TITANIUM');
      if (m.includes('BC')) materials.push('BLACK CERAMIC');
      if (m.includes('CE')) materials.push('CERAMIC');
      if (materials.length === 0) materials.push('STEEL');
      confidence = Math.max(confidence, 95);
      stages.push({ stage: 'CATALOG', engine: 'master_db', confidence, data: { reference, family, materials }, note: 'Verified in master catalog' });
    } else {
      stages.push({ stage: 'CATALOG', engine: 'master_db', confidence, data: { reference }, note: 'Unknown reference — not in catalog' });
      confidence = Math.min(confidence, 50);
    }
  } else {
    stages.push({ stage: 'CATALOG', engine: 'master_db', confidence, data: {}, note: 'Missing reference' });
    confidence = Math.min(confidence, 30);
  }

  let outlierFlag = null;
  if (catalogEntry && originalPrice) {
    const allPrices = [];
    for (const d of catalogEntry.dials.values()) {
      allPrices.push(...d.prices);
    }
    if (allPrices.length >= 5) {
      const usdPrice = toUSD(originalPrice, currency);
      // Also check per-dial prices for tighter bounds
      const dialPrices = catalogEntry.dials.get(dialColor)?.prices || [];
      const pricesToCheck = dialPrices.length >= 5 ? dialPrices : allPrices;
      if (priceIsOutlier(usdPrice, pricesToCheck)) {
        outlierFlag = 'PRICE_OUTLIER';
        confidence = Math.min(confidence, 60);
        stages.push({ stage: 'IQR', engine: 'statistical', confidence, data: { priceUSD: usdPrice, catalogPrices: pricesToCheck.length, checkedDial: dialPrices.length >= 5 }, note: 'Price is IQR outlier for this reference' });
      } else {
        stages.push({ stage: 'IQR', engine: 'statistical', confidence, data: { priceUSD: usdPrice, catalogPrices: pricesToCheck.length, checkedDial: dialPrices.length >= 5 }, note: 'Price within normal range' });
      }
    } else {
      stages.push({ stage: 'IQR', engine: 'statistical', confidence, data: { catalogPrices: allPrices.length }, note: 'Insufficient catalog data for IQR (< 5 points)' });
    }
  }

  const priceUSD = originalPrice ? toUSD(originalPrice, currency) : null;
  stages.push({ stage: 'CURRENCY', engine: 'exchange', confidence, data: { originalPrice, currency, priceUSD, rate: _rates[currency] }, note: `Converted ${currency} to USD` });

  const flags = [];
  if (!reference) flags.push('MISSING_REFERENCE');
  if (!catalogEntry) flags.push('UNKNOWN_REFERENCE');
  if (outlierFlag) flags.push(outlierFlag);
  if (confidence < 35) flags.push('LOW_CONFIDENCE');
  if (!originalPrice) flags.push('MISSING_PRICE');
  if (dialColor === 'UNKNOWN') flags.push('UNKNOWN_DIAL');

  const identified = !!reference && brand !== 'Unknown';
  let verdict, reason;
  if (!identified && confidence < RECYCLE_FLOOR) {
    verdict = 'RECYCLE';
    reason = 'Not enough information to identify the watch.';
  } else if (confidence >= APPROVE_THRESHOLD && !outlierFlag) {
    verdict = 'APPROVED';
    reason = `High confidence (${Math.round(confidence)}%) — auto-approved.`;
  } else {
    verdict = 'HUMAN';
    reason = `Confidence ${Math.round(confidence)}% below ${APPROVE_THRESHOLD}% or flagged — route to human review.`;
  }

  return {
    input: chunk,
    parsed: { brand, reference, family, dialColor, condition, year, price: originalPrice, currency, priceUSD, materials },
    confidence: Math.round(confidence),
    verdict,
    reason,
    flags,
    stages,
  };
}

// ─── Handler ───
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }

  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text (string) required' });
  }

  await refreshRates();
  const kimiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
  const ctx = { kimiKey };

  const chunks = text.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);
  const capped = chunks.slice(0, 8);

  try {
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
    console.error('[pipeline-parse]', e.message);
    return res.status(500).json({ error: e.message });
  }
};

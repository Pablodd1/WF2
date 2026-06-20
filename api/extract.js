/**
 * WatchFacts Extraction API — Regex Engine + AI Refinement
 * POST /api/extract
 * Body: { "messages": [ "raw line 1", "raw line 2", ... ], "useAI": false }
 * Returns: { "listings": [...], "stats": {...} }
 *
 * CommonJS for Vercel serverless (Node.js 20.x)
 */

// ─── Regex Extraction Engine (ported from Python) ───

const BRANDS = {
  rolex: 'Rolex', patek: 'Patek Philippe', pp: 'Patek Philippe',
  ap: 'Audemars Piguet', audemars: 'Audemars Piguet',
  rm: 'Richard Mille', cartier: 'Cartier', omega: 'Omega',
  tudor: 'Tudor', vc: 'Vacheron Constantin', lange: 'A. Lange & Söhne',
  hublot: 'Hublot', iwc: 'IWC', breitling: 'Breitling',
  jaeger: 'Jaeger-LeCoultre', panerai: 'Panerai', zenith: 'Zenith',
  breguet: 'Breguet', blancpain: 'Blancpain',
  'fp journe': 'F.P. Journe', moser: 'H. Moser & Cie',
};

const ROLEX_PREFIXES = ['126','116','228','226','278','279','336','277','128','127','124','134','118'];
const PATEK_PREFIXES = ['57','59','51','52','53','58','61','70','71','72','73','49'];
const AP_PREFIXES = ['15','16','25','26','67','77'];
const VC_PREFIXES = ['4000','4300','4500','4520','4600','5500','6000','7700'];

const MATERIAL_SUFFIX = {
  or:'Rose Gold', st:'Stainless Steel', ti:'Titanium', ba:'Yellow Gold',
  bc:'White Gold', wg:'White Gold', rg:'Rose Gold', ce:'Ceramic',
  cd:'Ceramic', cb:'Ceramic', io:'Titanium/Ceramic', sg:'Sedna Gold',
  sr:'Steel + Rose Gold', ic:'Titanium/Ceramic', nt:'NTPT Carbon', xt:'Carbon/TPT',
};

const COLOR_SLANG = {
  blk:'Black', black:'Black', blue:'Blue', green:'Green', white:'White',
  grey:'Grey', gray:'Grey', red:'Red', silver:'Silver',
  choco:'Chocolate', chocolate:'Chocolate', champ:'Champagne', champagne:'Champagne',
  salmon:'Salmon', brown:'Brown', yellow:'Yellow', orange:'Orange',
  purple:'Purple', pink:'Pink', tiffany:'Tiffany Blue', meteorite:'Meteorite',
  mete:'Meteorite', 'ice blue':'Ice Blue', pistachio:'Pistachio Green',
  'candy pink':'Candy Pink', lavender:'Lavender', wim:'Wimbledon',
  'salted egg':'Yellow Gold', onyx:'Onyx', mop:'Mother of Pearl',
  rainbow:'Rainbow', rbw:'Rainbow', ombre:'Ombré', pave:'Pavé Diamond',
};

const CONDITION_MAP = {
  new:'new', 'brand new':'new', bnib:'new', used:'pre-owned',
  'pre-owned':'pre-owned', 'like new':'like-new', unworn:'unworn',
  nos:'new-old-stock', mint:'mint', naked:'pre-owned',
};

function normalizeText(text) {
  return text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ').trim();
}

function extractReference(text) {
  const clean = normalizeText(text);
  
  // RM format: 07-01, 11-03, RM35-01, or standalone 3-digit (055, 004, 011)
  let m = clean.match(/\b(?:RM)?(\d{2,3}[-]\d{2,3})\b/i);
  if (!m) m = clean.match(/\bRM(\d{3})\b/i);
  if (!m) m = clean.match(/\b(\d{3})\b(?=.*(?:ntpt|ceramic|naked|full set|ti\b|Rg\b))/i);
  if (m) return { ref: m[1].startsWith('RM') ? m[1] : `RM${m[1]}`, conf: m[1].length >= 5 ? 0.85 : 0.70 };
  
  // AP full format: 15720ST.OO.A052CA.01
  m = clean.match(/\b(\d{5}[A-Za-z]{2,4}(?:\.[A-Za-z]{2}\.[A-Za-z0-9]{5,6}\.\d{2}))\b/);
  if (m) return { ref: m[1], conf: 0.90 };
  
  // Standard: 4-6 digits + optional letters
  const re = /\b(\d{4,6}[A-Za-z]{0,6}(?:\/\d+[A-Za-z]{0,2})?(?:-\d{4})?)\b(?!\s*(?:[kKmM]|hkd|HKD|usdt|USDT))\b/gi;
  let match;
  while ((match = re.exec(clean)) !== null) {
    const ref = match[1];
    const before = clean.substring(Math.max(0, match.index - 10), match.index).toUpperCase();
    if (/[$]|HKD|USDT|USD|\.$/.test(before.slice(-4))) continue;
    
    // Skip prices
    if (/^\d{4,6}$/.test(ref)) {
      const n = parseInt(ref);
      if (n >= 10000 && (n % 1000 === 0 || n % 500 === 0)) {
        const ctx = clean.substring(Math.max(0, match.index - 15), match.index + ref.length + 10);
        if (/[Hh][Kk][Dd]|[Uu][Ss][Dd][Tt]|\$|:/.test(ctx)) continue;
      }
    }
    
    // Skip currency-code refs
    const suffixM = ref.match(/^(\d{4,6})([A-Za-z]{2,6})$/);
    if (suffixM && ['HKD','USDT','USD'].includes(suffixM[2].toUpperCase())) continue;
    
    // Rolex
    if (new RegExp(`^(${ROLEX_PREFIXES.join('|')})[0-9A-Z-]+$`, 'i').test(ref))
      return { ref, conf: 0.85 };
    
    // AP
    if (/^\d{5}[A-Za-z]{2,}/.test(ref))
      return { ref, conf: 0.85 };
    
    // General with letters
    if (/^\d{4,6}[A-Za-z/]+/.test(ref) && ref.length > 4)
      return { ref, conf: 0.80 };
    
    // Patek 4-digit
    if (/^\d{4}$/.test(ref) && parseInt(ref) < 9000) {
      if (parseInt(ref) >= 2020 && parseInt(ref) <= 2030) continue;
      return { ref, conf: 0.60 };
    }
  }
  
  return { ref: null, conf: 0 };
}

function detectBrand(text, ref) {
  const lower = text.toLowerCase();
  for (const [key, name] of Object.entries(BRANDS)) {
    if (new RegExp('\\b' + key + '\\b', 'i').test(lower))
      return { brand: name, conf: 0.90 };
  }
  if (!ref) return { brand: null, conf: 0 };
  
  const clean = ref.toUpperCase();
  if (clean.startsWith('RM') || /^\d{2}-\d{2}/.test(clean))
    return { brand: 'Richard Mille', conf: 0.85 };
  if (/^\d{5}[A-Z]{2}/i.test(clean) && AP_PREFIXES.some(p => clean.startsWith(p)))
    return { brand: 'Audemars Piguet', conf: 0.80 };
  
  const short = clean.replace(/[^A-Z0-9]/g, '');
  if (ROLEX_PREFIXES.some(p => short.startsWith(p)))
    return { brand: 'Rolex', conf: 0.80 };
  if (PATEK_PREFIXES.some(p => short.startsWith(p)) && /^\d{4}/.test(short))
    return { brand: 'Patek Philippe', conf: 0.75 };
  if (VC_PREFIXES.some(p => short.startsWith(p)))
    return { brand: 'Vacheron Constantin', conf: 0.75 };
  if (/^(WSPN|WSSA|WGTA|WSTA|HPI|WHSA)/i.test(clean))
    return { brand: 'Cartier', conf: 0.85 };
  if (clean.startsWith('IW')) return { brand: 'IWC', conf: 0.80 };
  if (/^M\d{2}/.test(clean)) return { brand: 'Tudor', conf: 0.75 };
  
  return { brand: null, conf: 0 };
}

function extractYear(text) {
  const lower = text.toLowerCase();
  let m = lower.match(/\bn(\d{1,2})\s*\/\s*(\d{2,4})\b/);
  if (m) {
    const yr = parseInt(m[2]);
    return { year: yr < 100 ? 2000 + yr : yr, month: parseInt(m[1]), conf: 0.90 };
  }
  m = lower.match(/\b(\d{1,2})\s*\/\s*(\d{4})\b/);
  if (m && parseInt(m[1]) <= 12)
    return { year: parseInt(m[2]), month: parseInt(m[1]), conf: 0.85 };
  m = lower.match(/\b((?:20)?(\d{2}))y\b/);
  if (m) {
    const yr = 2000 + parseInt(m[2]);
    if (yr <= 2030) return { year: yr, month: null, conf: m[1].startsWith('20') ? 0.85 : 0.75 };
  }
  m = lower.match(/\b(20[2-3]\d)\b(?!\s*[km])/);
  if (m) return { year: parseInt(m[1]), month: null, conf: 0.60 };
  return { year: null, month: null, conf: 0 };
}

function extractPrice(text) {
  const lower = text.toLowerCase();
  
  // HKD:585000
  let m = lower.match(/\b(hkd|usdt|usd)\s*[:=]\s*([\d,]+)\s*[km]?\b/i);
  if (m) return { price: parseFloat(m[2].replace(/,/g, '')), currency: m[1].toUpperCase(), conf: 0.90 };
  
  // HKD930K (no space)
  m = lower.match(/\b(hkd|usdt|usd)\s*([\d,.]+)\s*[kK]\b/i);
  if (m) return { price: parseFloat(m[2].replace(/,/g, '')) * 1000, currency: m[1].toUpperCase(), conf: 0.90 };
  
  // 240k hkd
  m = lower.match(/\b([\d,.]+)\s*([km])\s*(hkd|usdt|usd|uadt)\b/i);
  if (m) {
    let amt = parseFloat(m[1].replace(/,/g, ''));
    if (m[2].toLowerCase() === 'k') amt *= 1000;
    else amt *= 1000000;
    return { price: amt, currency: m[3].toUpperCase().replace('UADT','USDT'), conf: 0.90 };
  }
  
  // $12,500
  m = lower.match(/\$([\d,.]+)\s*[km]?\b/);
  if (m) {
    let amt = parseFloat(m[1].replace(/,/g, ''));
    if (/k/i.test(m[0])) amt *= 1000;
    return { price: amt, currency: /usd/i.test(lower) ? 'USD' : 'HKD', conf: 0.60 };
  }
  
  // 240k alone
  m = lower.match(/\b([\d,.]+)\s*[kK]\b(?!\s*(hkd|usdt|usd))/);
  if (m) return { price: parseFloat(m[1].replace(/,/g, '')) * 1000, currency: 'HKD', conf: 0.65 };
  
  // 1.45M
  m = lower.match(/\b(\d[\d,.]*)\s*[mM]\b/);
  if (m) {
    const s = m[1].replace(/,/g, '');
    if (s && s !== '.') return { price: parseFloat(s) * 1000000, currency: null, conf: 0.60 };
  }
  
  return { price: null, currency: null, conf: 0 };
}

function detectDialColor(text) {
  const lower = text.toLowerCase();
  for (const [slang, normalized] of Object.entries(COLOR_SLANG).sort((a,b) => b[0].length - a[0].length)) {
    if (new RegExp('\\b' + slang + '\\b', 'i').test(lower))
      return { dial: normalized, conf: 0.80 };
  }
  return { dial: null, conf: 0 };
}

function detectCaseMaterial(text, ref, brand) {
  const lower = text.toLowerCase();
  if (/white gold|wg\b/i.test(lower)) return { material: 'White Gold', conf: 0.90 };
  if (/rose gold|rg\b/i.test(lower)) return { material: 'Rose Gold', conf: 0.90 };
  if (/yellow gold|yg\b/i.test(lower)) return { material: 'Yellow Gold', conf: 0.90 };
  if (/platinum|pt\b/i.test(lower)) return { material: 'Platinum', conf: 0.90 };
  if (/titanium|ti\b/i.test(lower)) return { material: 'Titanium', conf: 0.85 };
  if (/ceramic/i.test(lower)) return { material: 'Ceramic', conf: 0.85 };
  if (/carbon|ntpt|forged carbon/i.test(lower)) return { material: 'Carbon/NTPT', conf: 0.80 };
  if (/stainless steel|steel/i.test(lower)) return { material: 'Stainless Steel', conf: 0.85 };
  
  if (ref && brand) {
    const up = ref.toUpperCase();
    for (const [suffix, mat] of Object.entries(MATERIAL_SUFFIX).sort((a,b) => b[0].length - a[0].length)) {
      if (up.includes(suffix.toUpperCase()) && suffix.length >= 2)
        return { material: mat, conf: 0.70 };
    }
  }
  return { material: null, conf: 0 };
}

function extractWatch(text) {
  const clean = normalizeText(text);
  const { ref, conf: refConf } = extractReference(clean);
  if (!ref) return null;
  
  const { brand, conf: brandConf } = detectBrand(clean, ref);
  const { year, month, conf: yearConf } = extractYear(clean);
  const { price, currency, conf: priceConf } = extractPrice(clean);
  const { dial, conf: dialConf } = detectDialColor(clean);
  const { material: caseMat, conf: caseConf } = detectCaseMaterial(clean, ref, brand);
  
  // Condition
  let condition = null;
  const l = clean.toLowerCase();
  for (const [key, val] of Object.entries(CONDITION_MAP).sort((a,b) => b[0].length - a[0].length)) {
    if (new RegExp('\\b' + key + '\\b', 'i').test(l)) { condition = val; break; }
  }
  if (!condition && /n\d{1,2}\s*\/\s*\d/i.test(l)) condition = 'new';
  if (!condition && /used|pre.owned/i.test(l)) condition = 'pre-owned';
  
  // Box/Papers
  let papers = null, box = null, fullSet = null;
  if (/naked|only watch|only wacth/i.test(l)) { papers = false; box = false; fullSet = false; }
  if (/full set\b(?!.*no box)/i.test(l)) { papers = true; box = true; fullSet = true; }
  if (/full set.*no box/i.test(l)) { papers = true; box = false; fullSet = false; }
  if (/no papers|without papers/i.test(l)) papers = false;
  if (/papers|card|stamped/i.test(l) && papers === null) papers = true;
  if (/no box|without box/i.test(l)) box = false;
  if (/\bbox\b/i.test(l) && box === null) box = true;
  if (/bnib/i.test(l)) { condition = 'new'; papers = true; box = true; fullSet = true; }
  
  // Confidence
  const confidences = [brandConf, refConf, yearConf, priceConf].filter(c => c > 0);
  let overall = confidences.length ? confidences.reduce((a,b) => a+b, 0) / confidences.length : 0;
  if (!year) overall *= 0.85;
  if (!price) overall *= 0.80;
  if (!brand) overall *= 0.75;
  overall = Math.round(Math.min(overall, 1.0) * 100) / 100;
  
  return {
    brand, reference: ref, model_name: null, year, manufacture_month: month,
    price_original: price, currency_original: currency,
    condition, dial_color: dial, case_material: caseMat,
    bracelet_material: null, papers, box, full_set: fullSet,
    movement_type: null, case_size_mm: null,
    seller_notes: null, collaboration: null,
    message_type: /wtb|looking for|need\b|wanted/i.test(l) ? 'WTB' : 'FS',
    extraction_confidence: {
      brand: Math.round(brandConf * 100) / 100,
      reference: Math.round(refConf * 100) / 100,
      price: Math.round(priceConf * 100) / 100,
      year: Math.round(yearConf * 100) / 100,
      overall
    },
    what_i_needed_but_didnt_have: [],
    errors_or_ambiguities: [],
    normalization_notes: null,
    raw_text: text,
  };
}

// ─── Vercel Handler ───

const REF_SUFFIX_DIAL = {
  LN: 'Black', LB: 'Blue', LV: 'Green', CHNR: 'Brown/Black',
  BLNR: 'Blue/Black', BLRO: 'Blue/Red', VTNR: 'Black/Green',
  GRNR: 'Black/Grey', SARU: 'Orange',
};

const REF_DIAL_OVERRIDES = {
  '116500LN': 'White', '126500LN': 'White',
  '116518': 'Champagne', '116519': 'Meteorite',
  '5711/1A': 'Blue', '5712/1A': 'Blue', '5167A': 'Black',
  '5164A': 'Black', '5968A': 'Black', '5968G': 'Green',
  '126334': 'Grey', '126234': 'Grey',
};

function inferDialFromRef(ref) {
  if (!ref) return null;
  const clean = ref.toUpperCase();
  for (const [key, color] of Object.entries(REF_DIAL_OVERRIDES)) {
    if (clean.includes(key.toUpperCase())) return color;
  }
  for (const [suffix, color] of Object.entries(REF_SUFFIX_DIAL)) {
    if (clean.endsWith(suffix.toUpperCase()) || clean.includes('/' + suffix.toUpperCase())) {
      return color;
    }
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  
  try {
    const { messages = [], enrichVision = false } = req.body || {};
    if (!messages.length) return res.status(400).json({ error: 'messages array required' });
    
    const listings = [];
    const stats = { total_messages: messages.length, extracted: 0, high: 0, medium: 0, low: 0, visionEnriched: 0 };
    
    // Multi-line buffer — group messages by sender/time proximity
    // If message looks like a continuation (price/year line after ref line), merge
    let pending = null;
    
    for (let i = 0; i < messages.length; i++) {
      const msg = (messages[i] || '').trim();
      if (!msg) continue;
      
      // Detect multi-line continuation: line with ONLY price/year (no reference)
      if (pending && /^\s*(\d{2,4}y|HKD|USDT|USD|hkd|usdt|usd|\$|[\d,]+[km])\b/i.test(msg) && !hasRef) {
        pending = pending + ' ' + msg;
        continue;
      }
      
      // Flush pending
      if (pending) {
        const result = extractWatch(pending);
        if (result) {
          listings.push(result);
          stats.extracted++;
          const c = result.extraction_confidence.overall;
          if (c >= 0.80) stats.high++;
          else if (c >= 0.50) stats.medium++;
          else stats.low++;
        }
      }
      
      // Check if this line has a reference (start of new listing)
      const hasRef = /\b(\d{4,6}[A-Za-z]{0,6}|RM\d|\d{2,3}[-]\d{2,3})\b/i.test(msg);
      if (hasRef) {
        pending = msg;
      } else {
        pending = null;
      }
    }
    
    // Flush last pending
    if (pending) {
      const result = extractWatch(pending);
      if (result) {
        listings.push(result);
        stats.extracted++;
        const c = result.extraction_confidence.overall;
        if (c >= 0.80) stats.high++;
        else if (c >= 0.50) stats.medium++;
        else stats.low++;
      }
    }
    
    // Vision enrichment for listings without dial color
    if (enrichVision) {
      for (const listing of listings) {
        if (!listing.dial_color && listing.reference) {
          const refDial = inferDialFromRef(listing.reference);
          if (refDial) {
            listing.dial_color = refDial;
            listing.dial_confidence = 0.40;
            listing.dial_source = 'reference-suffix';
            listing.extraction_confidence.overall = Math.round(
              Math.min(listing.extraction_confidence.overall + 0.05, 1.0) * 100
            ) / 100;
            stats.visionEnriched++;
          }
        }
      }
    }
    
    listings.sort((a, b) => b.extraction_confidence.overall - a.extraction_confidence.overall);
    
    res.json({ listings, stats, engine_version: '2.0-js' });
  } catch (e) {
    res.status(500).json({ error: e.message, listings: [], stats: {} });
  }
};

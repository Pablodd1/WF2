/**
 * Client-side luxury watch parser engine
 * Regex-first → confidence score → ≥90% auto-approved, <90% AI fallback
 */

export interface ParsedWatch {
  rawMessage: string;
  brand: string;
  reference: string;
  model: string;
  dialColor: string;
  price: number;
  currency: string;
  condition: string;
  year: number | null;
  confidence: number;
  flags: string[];
  intent: 'SELL' | 'BUY' | 'INQUIRY';
}

// ── Brand catalog ──

// Emoji-based brand markers used by dealers in WhatsApp/Telegram
// (e.g., 🔵 = Patek Philippe, 🟢 = Rolex, 🔴 = Audemars Piguet)
const EMOJI_BRAND_MAP: Record<string, string> = {
  '🔵': 'Patek Philippe',        // blue circle
  '🏮': 'Patek Philippe',        // red lantern (often Patek)
  '🟢': 'Rolex',                 // green circle
  '⚫': 'Rolex',                 // black circle (Submariner)
  '🔴': 'Audemars Piguet',       // red circle
  '🟠': 'Audemars Piguet',       // orange circle
  '🟡': 'Richard Mille',         // yellow circle
  '⚪': 'Vacheron Constantin',   // white circle
  '🔶': 'Vacheron Constantin',   // orange diamond
  '🟣': 'Omega',                 // purple circle
  '🟤': 'IWC',                   // brown circle
  '⚪️': 'Patek Philippe',        // white circle (some dealers use for PP)
  '⭕': 'Patek Philippe',        // hollow circle (Patek Nautilus)
};

const BRAND_PATTERNS: [RegExp, string][] = [
  [/\b(?:patek\s*philippe|patek|pp)\b/i, 'Patek Philippe'],
  [/\b(?:audemars\s*piguet|audemars|ap)\b/i, 'Audemars Piguet'],
  [/\b(?:richard\s*mille|rm)(?=\d)/i, 'Richard Mille'],
  [/\b(?:rolex|rolx?e?x?)\b/i, 'Rolex'],
  [/\b(?:omega)\b/i, 'Omega'],
  [/\b(?:tag\s*heuer|tag)\b/i, 'Tag Heuer'],
  [/\b(?:cartier)\b/i, 'Cartier'],
  [/\b(?:panerai)\b/i, 'Panerai'],
  [/\b(?:jaeger.*lecoultre|jlc)\b/i, 'Jaeger-LeCoultre'],
  [/\b(?:iuc|iwc)\b/i, 'IWC'],
  [/\b(?:hublot)\b/i, 'Hublot'],
  [/\b(?:breitling)\b/i, 'Breitling'],
  [/\b(?:vacheron.*constantin|vc)\b/i, 'Vacheron Constantin'],
  [/\b(?:tudor)\b/i, 'Tudor'],
  [/\b(?:grand.*seiko|gs)\b/i, 'Grand Seiko'],
];

const ROLEX_MODELS = [
  'Submariner', 'Daytona', 'Datejust', 'Day-Date', 'GMT-Master II',
  'GMT-Master', 'Explorer II', 'Explorer', 'Yacht-Master II', 'Yacht-Master',
  'Sea-Dweller', 'Deepsea', 'Sky-Dweller', 'Air-King', 'Milgauss',
  'Cellini', 'Oyster Perpetual', 'Cosmograph',
];

// ── Reference patterns (ordered by specificity) ──

function refMatch(text: string): string {
  // RM references: RM followed by 2-4 digits
  let m = text.match(/\bRM[ -]?(\d{2,4}[A-Za-z0-9-]{0,6})\b/);
  if (m) return 'RM' + m[1];

  // Slash format: 5712/1A, 15400ST, 116610LV
  m = text.match(/\b(\d{4,6}\/[A-Za-z0-9-]{1,6})\b/);
  if (m) return m[1];

  // Rolex: 5-6 digit refs with optional letter suffix (116610LV, 126710BLRO, 1655, etc.)
  // \b doesn't work between digits and letters — match the suffix explicitly
  m = text.match(/\b(116\d{3}[A-Z]{0,4}|126\d{3}[A-Z]{0,4}|114\d{3}[A-Z]?|124\d{3}[A-Z]?|226\d{3}[A-Z]{0,4}|228\d{3}[A-Z]{0,4}|279\d{3}[A-Z]{0,4}|176\d{3}|184\d{3}|118\d{3}|155\d{3}[A-Z]{0,4}|177\d{3}|816\d{3}|190\d{3}|268\d{3}|128\d{3})(?![A-Z])/i);
  if (m) return m[1].toUpperCase();

  // Patek refs: 49xx, 50xx, 51xx, 52xx, 57xx, 59xx, 71xx, 72xx with 1-3 letter suffix (case-insensitive)
  m = text.match(/\b(49\d{2}[A-Z]{1,4}|50\d{2}[A-Z]{1,4}|51\d{2}[A-Z]{1,4}|52\d{2}[A-Z]{1,4}|53\d{2}[A-Z]{1,4}|54\d{2}[A-Z]{1,4}|57\d{2}[A-Z]{1,4}|58\d{2}[A-Z]{1,4}|59\d{2}[A-Z]{1,4}|61\d{2}[A-Z]{1,4}|71\d{2}[A-Z]{1,4}|72\d{2}[A-Z]{1,4})\b/i);
  if (m) return m[1].toUpperCase();

  // AP: 15xxx, 16xxx, 26xxx with optional suffix
  m = text.match(/\b(15\d{3}[A-Za-z]{0,4}|16\d{3}[A-Za-z]{0,4}|26\d{3}[A-Za-z]{0,4})\b/);
  if (m) return m[1];

  // Vacheron Constantin: 47xxx, 82xxx, 4300/4500/6000/7900/81180/85180/4010 patterns
  m = text.match(/\b(47\d{3}[A-Z]?|82\d{3}[A-Z]?|43\d{2}[A-Z]?|45\d{2}[A-Z]?|60\d{2}[A-Z]?|79\d{2}[A-Z]?|81180[A-Z]?|85180[A-Z]?|4010[A-Z]?)\b/);
  if (m) return m[1];

  // IWC: IW followed by digits (IW328904, IW3777)
  m = text.match(/\b(IW\d{4,6})\b/i);
  if (m) return m[1].toUpperCase();

  // Generic: 5-6 digit ref + 1-4 letter suffix (catches AP/RM/VC/Panerai/Omega/Hublot/Tudor)
  m = text.match(/\b(\d{5,6}[A-Z]{1,4})\b/);
  if (m) return m[1];

  // 4-digit vintage refs (not years 1900-2029)
  m = text.match(/\b(\d{4})\b/);
  if (m) {
    const n = parseInt(m[1]);
    if (n < 1900 || n > 2029) return m[1];
    // Year-like numbers (1900-2029) are NOT references, skip
    return '';
  }

  return '';
}

// ── Dial color inference from reference suffix ──

const SUFFIX_DIAL: Record<string, string> = {
  'A': 'Black', 'LB': 'Blue', 'LN': 'Black', 'LV': 'Green', 'CHNR': 'Brown',
  'R': 'Brown', 'G': 'Blue', 'J': 'Champagne', 'P': 'Blue', 'ST': 'Blue',
  'OR': 'Pink', 'TI': 'Grey', 'BC': 'Black', 'BLRO': 'Red Blue',
  'BLNR': 'Blue Black', 'GRNR': 'Green Black', 'RBOW': 'Rainbow',
};

const DIAL_KEYWORDS: [RegExp, string][] = [
  [/\b(?:tiffany|tiffanie|tiff)\s*(?:blue|dial)?\b/i, 'Tiffany'],
  [/\b(?:ice\s*blue|icy\s*blue|light\s*blue|powder\s*blue)\b/i, 'Ice Blue'],
  [/\bmeteorite\b/i, 'Meteorite'],
  [/\bmother\s*(?:of\s*)?pearl\b|mop\b/i, 'Mother of Pearl'],
  [/\bdiamond\s*(?:dial|set|pave)?\b/i, 'Diamond'],
  [/\bskeleton\b/i, 'Skeleton'],
  [/\b(?:blue\s*(?:dial)?)(?!\s*(?:strap|box|card|papers))\b/i, 'Blue'],
  [/\b(?:black\s*(?:dial)?)(?!\s*(?:strap|box|card|papers))\b/i, 'Black'],
  [/\b(?:green\s*(?:dial)?)(?!\s*(?:strap|box|card|papers))\b/i, 'Green'],
  [/\b(?:white\s*(?:dial)?)(?!\s*(?:strap|box|card|papers))\b/i, 'White'],
  [/\b(?:silver\s*(?:dial)?)\b/i, 'Silver'],
  [/\b(?:grey|gray)\s*(?:dial)?\b/i, 'Grey'],
  [/\b(?:brown|chocolate|zebra)\s*(?:dial)?\b/i, 'Brown'],
  [/\b(?:pink|rose)\s*(?:dial)?\b/i, 'Pink'],
  [/\b(?:purple|violet|plum)\s*(?:dial)?\b/i, 'Purple'],
  [/\b(?:yellow|gold)\s*(?:dial)?\b/i, 'Yellow'],
  [/\b(?:orange)\s*(?:dial)?\b/i, 'Orange'],
  [/\b(?:champagne|champ)\s*(?:dial)?\b/i, 'Champagne'],
  [/\bred\s*(?:dial)?\b/i, 'Red'],
];

const CONDITION_PATTERNS: [RegExp, string][] = [
  [/\b(?:brand\s*new|bnib|unworn|unused|nib)\b/i, 'New'],
  [/\b(?:like\s*new|mint|excellent)\b/i, 'New'],
  [/\b(?:pre.owned|used|second.hand)\b/i, 'Used'],
  [/\b(?:fair|good|vintage)\b/i, 'Used'],
];

const CURRENCY_PATTERNS: [RegExp, string][] = [
  [/\bHKD\b/, 'HKD'], [/\bUSD\b/, 'USD'], [/\bEUR\b/, 'EUR'],
  [/\bUSDT\b/, 'USDT'], [/\bGBP\b/, 'GBP'], [/\bCHF\b/, 'CHF'],
  [/\bSGD\b/, 'SGD'], [/\bJPY\b/, 'JPY'], [/\bCNY\b/, 'CNY'],
  [/\bAED\b/, 'AED'], [/\$/, 'USD'], [/€/, 'EUR'], [/£/, 'GBP'],
  [/¥/, 'JPY'],
];

const PRICE_PATTERNS: RegExp[] = [
  // "1.2M HKD", "250k USD", "1.5M USD", "3.5k EUR"
  /([\d,]+\.?\d*)\s*([MmKk])\s*(?:HKD|USD|EUR|CHF|GBP|SGD|USDT|JPY|CNY|AED)\b/i,
  // "HKD 850000", "USD 15000"
  /(?:HKD|USD|EUR|CHF|GBP|SGD|USDT)\s*([\d,]+\.?\d*)\s*([MmKk])?/i,
  // "$125,000", "$15k"
  /\$\s*([\d,]+\.?\d*)\s*([MmKk])?/,
  // "HK$ 970,000"
  /HK\$\s*([\d,]+\.?\d*)\s*([MmKk])?/i,
  // "¥1,200,000"
  /¥\s*([\d,]+)\s*([MmKk])?/,
  // Bare "850k", "1.2M" with no currency (USD default)
  /([\d,]+\.?\d*)\s*([MmKk])\b/,
  // "850000 HKD", "15000 USD" (no thousands suffix)
  /([\d,]+\.?\d*)\s*(?:HKD|USD|EUR|CHF|GBP|SGD|USDT)\b/i,
];

// ── Parser ──

export function parseWatch(raw: string): ParsedWatch {
  // 1. Brand from emoji (BEFORE emoji strip — emojis get removed below)
  let brand = 'Unknown';
  for (const [emoji, name] of Object.entries(EMOJI_BRAND_MAP)) {
    if (raw.includes(emoji)) { brand = name; break; }
  }

  const clean = raw.replace(/[\u{1F000}-\u{1FFFF}]/gu, '').trim();

  // 2. Brand from text patterns
  if (brand === 'Unknown') {
    for (const [re, name] of BRAND_PATTERNS) {
      if (re.test(clean)) { brand = name; break; }
    }
  }
  // Brand from reference prefix if brand still unknown
  if (brand === 'Unknown') {
    // Patek Philippe: 49xx, 50xx, 51xx, 52xx, 53xx, 54xx, 57xx, 58xx, 59xx, 61xx, 71xx, 72xx
    if (/\b(49\d{2}|50\d{2}|51\d{2}|52\d{2}|53\d{2}|54\d{2}|57\d{2}|58\d{2}|59\d{2}|61\d{2}|71\d{2}|72\d{2})/.test(clean)) brand = 'Patek Philippe';
    // Rolex: 116xxx, 126xxx, 166xxx, 226xxx, 114xxx, 124xxx etc.
    else if (/\b(11[46]\d{3}|12[46]\d{3}|16[46]\d{3}|22[68]\d{3}|279\d{3}|118\d{3}|155\d{3}|176\d{3}|177\d{3}|184\d{3}|190\d{3}|268\d{3}|128\d{3}|816\d{3})/.test(clean)) brand = 'Rolex';
    // Rolex extended: 126599, 126710, 26711, 279160, 26715, 26420 (any 6-digit+letter)
    else if (/^\d{6}[A-Z]{2,4}$/.test(clean.trim()) || /\b\d{6}[A-Z]{2,4}\b/.test(clean)) brand = 'Rolex';
    // Audemars Piguet: 15xxx, 16xxx, 26xxx
    else if (/\b(15\d{3}[A-Z]|16\d{3}[A-Z]|26\d{3}[A-Z])/.test(clean)) brand = 'Audemars Piguet';
    // Richard Mille: RM followed by digits
    else if (/RM\d{2,4}/i.test(clean)) brand = 'Richard Mille';
    // IWC: IW followed by digits (IW328904, IW3777)
    else if (/\bIW\d{4,6}\b/i.test(clean)) brand = 'IWC';
    // Cartier: starts with CR, WG, HP, or ends in xxx/xxxx
    else if (/\b(CR\d{3}|WG\d{4}|HP\d{3}|SANTOS|BALLON|TANK|PANTHERE)\b/i.test(clean)) brand = 'Cartier';
    // Omega: starts with 311, 321, 331, special patterns
    else if (/\b(31[0139]\d{3}|32[013]\d{3}|33[012]\d{3}|SEAMASTER|SPEEDMASTER)\b/i.test(clean)) brand = 'Omega';
    // Hublot: HUB, HH, or 301/302/303/304/305 patterns
    else if (/\b(HUB\d{2}|30[12345]\d{3}|CLASSIC|BIG BANG)\b/i.test(clean)) brand = 'Hublot';
    // Panerai: PAM followed by digits
    else if (/\bPAM\d{3,4}\b/i.test(clean)) brand = 'Panerai';
    // Breitling: starts with AB, A1, A2, A3 or ends in chronomat/navitimer
    else if (/\b(AB\d{4}|A[123]\d{4}|CHRONOMAT|NAVITIMER|AVENGER)\b/i.test(clean)) brand = 'Breitling';
    // Vacheron Constantin: starts with 47xxx, reference format
    else if (/\b(47\d{3}|OVERSEAS|PATRIMONY|TRADITIONNELLE)\b/i.test(clean)) brand = 'Vacheron Constantin';
    // Jaeger-LeCoultre: Q followed by digits, or REVERSO
    else if (/\b(Q\d{5,6}|REVERSO|MASTER\s*.*CONTROL)\b/i.test(clean)) brand = 'Jaeger-LeCoultre';
  }

  // 2. Reference
  const reference = refMatch(clean);

  // 3. Model (Rolex-specific)
  let model = '';
  const cleanLC = clean.toLowerCase();
  for (const mdl of ROLEX_MODELS) {
    if (cleanLC.includes(mdl.toLowerCase())) { model = mdl; break; }
  }

  // 4. Dial color
  let dialColor = '';
  for (const [re, color] of DIAL_KEYWORDS) {
    if (re.test(clean)) { dialColor = color; break; }
  }
  // Infer from reference suffix if no dial found
  if (!dialColor && reference) {
    const upperRef = reference.toUpperCase();
    for (const [suffix, color] of Object.entries(SUFFIX_DIAL)) {
      if (upperRef.endsWith(suffix)) { dialColor = color; break; }
      if (upperRef.includes(suffix)) { dialColor = color; break; }
    }
  }

  // 5. Condition
  let condition = 'Unknown';
  for (const [re, c] of CONDITION_PATTERNS) {
    if (re.test(clean)) { condition = c; break; }
  }

  // 6. Year
  let year: number | null = null;
  const yearMatch = clean.match(/\b(20[0-2]\d)\b/);
  if (yearMatch) {
    const y = parseInt(yearMatch[1]);
    if (y >= 1950 && y <= 2030) year = y;
  }

  // 7. Currency
  let currency = '';
  for (const [re, cur] of CURRENCY_PATTERNS) {
    if (re.test(clean)) { currency = cur; break; }
  }
  if (!currency) {
    if (/[+]\d{2}/.test(clean)) currency = 'HKD';
    else currency = 'USD';
  }

  // 8. Price
  let price = 0;
  for (const re of PRICE_PATTERNS) {
    const m = clean.match(re);
    if (m) {
      let val = parseFloat(m[1].replace(/,/g, ''));
      const suffix = (m[2] || '').toLowerCase();
      if (suffix === 'm') val *= 1_000_000;
      else if (suffix === 'k') val *= 1_000;
      // Min 100 (watches start ~$1k), max 10B HKD or equivalent
      if (!isNaN(val) && val >= 100 && val < 10_000_000_000) {
        price = val;
        break;
      }
    }
  }

  // 9. Confidence scoring
  let score = 0;
  const flags: string[] = [];

  // Brand known -> +30
  if (brand !== 'Unknown') { score += 30; }
  else { flags.push('UNKNOWN_BRAND'); }

  // Valid reference found -> +25
  if (reference) { score += 25; }
  else { flags.push('MISSING_REFERENCE'); }

  // Dial color found/inferred -> +20
  if (dialColor) { score += 20; }
  else { flags.push('UNKNOWN_DIAL'); }

  // Price found and realistic -> +20
  if (price > 0 && price < 500_000_000) {
    score += 20;
    if (price >= 5000 && price <= 1_000_000) score += 5;
  } else {
    flags.push('MISSING_PRICE');
  }

  // Currency explicit -> +5
  if (currency && !['', 'USD'].includes(currency)) score += 5;

  // Year found -> +3
  if (year) score += 3;

  // Condition found -> +2
  if (condition !== 'Unknown') score += 2;

  // ── Intent detection ──
  let intent: 'SELL' | 'BUY' | 'INQUIRY' = 'SELL';
  const lc = clean.toLowerCase();
  // Buy intent: looking for, WTB, want to buy, looking, ISO (in search of), need, NTQ
  if (/\b(wtb|want.*buy|looking for|iso |in search of|need |ntq\b|looking to buy|want.*find|hunt|searching for|anyone.*have|who.*sell|where.*buy)\b/i.test(lc)) {
    intent = 'BUY';
  }
  // Inquiry: what is, how much, price check, valuation, worth, question mark
  else if (/\b(how much|what.*price|valuation|worth|price check|quote|pm me|dm me|interested|\\?)\b/i.test(lc)) {
    intent = 'INQUIRY';
  }
  // "NTQ" specifically (No Text Quick) — buyer signaling
  if (/\bntq\b/i.test(lc)) {
    intent = 'BUY';
  }

  return {
    rawMessage: raw,
    brand,
    reference,
    model,
    dialColor: dialColor || 'UNKNOWN',
    price,
    currency,
    condition,
    year,
    confidence: Math.min(100, Math.round(score)),
    flags,
    intent,
  };
}

/**
 * Verdict based on confidence threshold
 */
export function getVerdict(confidence: number): 'AUTO_APPROVED' | 'AI_REVIEW' | 'HUMAN_REVIEW' {
  if (confidence >= 90) return 'AUTO_APPROVED';
  if (confidence >= 60) return 'AI_REVIEW';
  return 'HUMAN_REVIEW';
}

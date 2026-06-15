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
}

// ── Brand catalog ──

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

  // Pure numeric Rolex: 5-6 digit refs starting with known prefixes
  m = text.match(/\b(116\d{3}|126\d{3}|114\d{3}|124\d{3}|226\d{3}|228\d{3}|279\d{3}|176\d{3}|184\d{3}|118\d{3}|155\d{3}|177\d{3}|816\d{3}|190\d{3}|268\d{3}|128\d{3})\b/);
  if (m) return m[1];

  // Patek refs: 49xx, 50xx, 51xx, 52xx, 57xx, 59xx, 71xx, 72xx
  m = text.match(/\b(49\d{2}[A-Za-z0-9\/]*|50\d{2}[A-Za-z0-9\/]*|51\d{2}[A-Za-z0-9\/]*|52\d{2}[A-Za-z0-9\/]*|57\d{2}[A-Za-z0-9\/]*|59\d{2}[A-Za-z0-9\/]*|71\d{2}[A-Za-z0-9\/]*|72\d{2}[A-Za-z0-9\/]*)\b/);
  if (m) return m[1];

  // AP: 15xxx, 16xxx, 26xxx
  m = text.match(/\b(15\d{3}[A-Za-z]{0,4}|16\d{3}[A-Za-z]{0,4}|26\d{3}[A-Za-z]{0,4})\b/);
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
  /(?:HKD|USD|EUR|CHF|GBP|SGD|USDT)\s*([\d,]+\.?\d*)\s*([MmKk])?/,
  /([\d,]+\.?\d*)\s*[Mm]\s*(?:HKD|USD|EUR)/i,
  /(\d+\.?\d*)\s*[Kk]/,
  /\$\s*([\d,]+\.?\d*)/,
  /¥\s*([\d,]+)/,
  /([\d,]+\.?\d*)\s*(?:HKD|USD|EUR)/,
];

// ── Parser ──

export function parseWatch(raw: string): ParsedWatch {
  const clean = raw.replace(/[\u{1F000}-\u{1FFFF}]/gu, '').trim();

  // 1. Brand
  let brand = 'Unknown';
  for (const [re, name] of BRAND_PATTERNS) {
    if (re.test(clean)) { brand = name; break; }
  }
  // Brand from reference prefix if brand unknown
  if (brand === 'Unknown') {
    if (/\b57\d{2}/.test(clean) || /\b59\d{2}/.test(clean) || /\b71\d{2}/.test(clean) || /\b72\d{2}/.test(clean)) brand = 'Patek Philippe';
    else if (/\b116\d{3}/.test(clean) || /\b126\d{3}/.test(clean) || /\b166\d{3}/.test(clean) || /\b226\d{3}/.test(clean)) brand = 'Rolex';
    else if (/\b15\d{3}[A-Z]/.test(clean) || /\b26\d{3}[A-Z]/.test(clean)) brand = 'Audemars Piguet';
    else if (/RM\d{2,4}/i.test(clean)) brand = 'Richard Mille';
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
      if (!isNaN(val) && val > 10 && val < 500_000_000) {
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

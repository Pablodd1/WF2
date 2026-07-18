'use strict';

const CURRENCY_ALIASES = [
  { code: 'USDT', pattern: 'USDT' },
  { code: 'HKD', pattern: 'HKD|HDK|HK\\$|H\\.?K\\.?D\\.?|港币|港幣' },
  { code: 'USD', pattern: 'USD|US\\$|U\\$' },
  { code: 'EUR', pattern: 'EUR|€' },
  { code: 'GBP', pattern: 'GBP|£' },
  { code: 'CHF', pattern: 'CHF' },
  { code: 'SGD', pattern: 'SGD|S\\$' },
  { code: 'CNY', pattern: 'CNY|RMB|CN¥' },
];

const CURRENCY_TOKEN = CURRENCY_ALIASES.map(item => item.pattern).join('|');
const MULTIPLIERS = {
  k: 1_000,
  mil: 1_000,
  m: 1_000_000,
  mn: 1_000_000,
  mill: 1_000_000,
  million: 1_000_000,
  w: 10_000,
  '万': 10_000,
};
const MULTIPLIER_TOKEN = 'million|mill|mil|mn|k|m|w|万';
const USD_PER_UNIT = { USD: 1, USDT: 1, HKD: 1 / 7.8, EUR: 1.08, GBP: 1.27, CHF: 1.12, SGD: 0.74, CNY: 0.138 };

const BRAND_HEADERS = [
  [/\b(?:patek\s*philippe|patek|pp)\b/i, 'Patek Philippe'],
  [/\b(?:audemars\s*piguet|audemars|ap)\b/i, 'Audemars Piguet'],
  [/\b(?:vacheron\s*constantin|vacheron|vc)\b/i, 'Vacheron Constantin'],
  [/\b(?:richard\s*mille|rm)\b/i, 'Richard Mille'],
  [/\brolex\b/i, 'Rolex'],
  [/\bcartier\b/i, 'Cartier'],
  [/\bchopard\b/i, 'Chopard'],
  [/\bomega\b/i, 'Omega'],
  [/\bhublot\b/i, 'Hublot'],
  [/\btudor\b/i, 'Tudor'],
];

function normalizeCurrencyToken(token) {
  const clean = String(token || '').toUpperCase().replace(/\s/g, '');
  if (/^(HKD|HDK|HK\$|H\.?K\.?D\.?)$/.test(clean) || /港币|港幣/.test(token)) return 'HKD';
  if (/^(USD|US\$|U\$)$/.test(clean)) return 'USD';
  if (clean === 'USDT') return 'USDT';
  if (clean === 'EUR' || clean === '€') return 'EUR';
  if (clean === 'GBP' || clean === '£') return 'GBP';
  if (clean === 'CHF') return 'CHF';
  if (clean === 'SGD' || clean === 'S$') return 'SGD';
  if (/^(CNY|RMB|CN¥)$/.test(clean)) return 'CNY';
  return null;
}

function parseNumber(rawNumber, rawMultiplier = '') {
  let token = String(rawNumber || '').trim().replace(/\s/g, '');
  if (!token) return null;

  // Dealer typo: 2.070,000 or 2,070.000 means 2,070,000.
  if (/^\d{1,3}(?:[.,]\d{3}){2,}$/.test(token)) {
    token = token.replace(/[.,]/g, '');
  } else if (/^\d{1,3}[.,]\d{3}$/.test(token) && !rawMultiplier) {
    token = token.replace(/[.,]/g, '');
  } else {
    token = token.replace(/,/g, '');
  }

  const number = Number.parseFloat(token);
  if (!Number.isFinite(number) || number <= 0) return null;
  const multiplier = MULTIPLIERS[String(rawMultiplier || '').toLowerCase()] || 1;
  return Math.round(number * multiplier);
}

function inferContextCurrency(text, existing = null) {
  const explicit = CURRENCY_ALIASES.find(item => new RegExp(`(?:${item.pattern})`, 'i').test(text));
  return explicit?.code || existing;
}

function extractDiscount(text) {
  const match = String(text).match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  return match ? Number.parseFloat(match[1]) : null;
}

function extractRetailPrice(text, discountPercent) {
  if (discountPercent == null) return null;
  const beforeDiscount = String(text).split(/-?\s*\d{1,2}(?:\.\d+)?\s*%/)[0];
  const matches = [...beforeDiscount.matchAll(/\b(\d{1,3}(?:[.,]\d{3})+|\d{4,9})\b/g)];
  if (!matches.length) return null;
  return parseNumber(matches[matches.length - 1][1]);
}

function extractPriceObservations(text, context = {}) {
  const observations = [];
  const seen = new Set();
  const line = String(text || '');

  const add = (raw, rawNumber, multiplier, rawCurrency, index, evidence) => {
    const amount = parseNumber(rawNumber, multiplier);
    const currency = normalizeCurrencyToken(rawCurrency);
    if (!amount || !currency) return;
    const key = `${index}:${amount}:${currency}`;
    if (seen.has(key)) return;
    seen.add(key);
    observations.push({
      price_type: observations.length === 0 ? 'ASK_PRICE' : 'ALT_CURRENCY_PRICE',
      amount_original: amount,
      currency_original: currency,
      amount_usd: Math.round(amount * (USD_PER_UNIT[currency] || 1)),
      is_primary: observations.length === 0,
      raw_price_text: raw.trim(),
      confidence: 98,
      currency_evidence: evidence,
      index,
    });
  };

  const leftCurrency = new RegExp(`(${CURRENCY_TOKEN})\\s*([\\d][\\d.,]*)(?:\\s*(${MULTIPLIER_TOKEN}))?`, 'gi');
  const rightCurrency = new RegExp(`([\\d][\\d.,]*)(?:\\s*(${MULTIPLIER_TOKEN}))?\\s*(${CURRENCY_TOKEN})`, 'gi');

  for (const match of line.matchAll(leftCurrency)) {
    add(match[0], match[2], match[3], match[1], match.index, 'explicit_line_currency');
  }
  for (const match of line.matchAll(rightCurrency)) {
    add(match[0], match[1], match[2], match[3], match.index, 'explicit_line_currency');
  }

  // A bare dollar sign inherits an explicit section/message currency. Without
  // context it remains unresolved instead of silently becoming USD.
  const dollarPattern = new RegExp(`\\$\\s*([\\d][\\d.,]*)(?:\\s*(${MULTIPLIER_TOKEN}))?`, 'gi');
  for (const match of line.matchAll(dollarPattern)) {
    const contextCurrency = context.currency_context || null;
    if (contextCurrency) {
      add(match[0], match[1], match[2], contextCurrency, match.index, 'section_currency');
    }
  }

  if (!observations.length && context.currency_context) {
    const bare = line.match(new RegExp(`\\b(\\d{1,3}(?:[.,]\\d{3})+|\\d+(?:[.,]\\d+)?)\\s*(${MULTIPLIER_TOKEN})\\b`, 'i'));
    if (bare) add(bare[0], bare[1], bare[2], context.currency_context, bare.index, 'section_currency');
  }

  observations.sort((a, b) => a.index - b.index);
  observations.forEach((entry, index) => {
    entry.price_type = index === 0 ? 'ASK_PRICE' : 'ALT_CURRENCY_PRICE';
    entry.is_primary = index === 0;
    delete entry.index;
  });

  const discount_percent = extractDiscount(line);
  const retail_price = extractRetailPrice(line, discount_percent);
  if (observations.length && discount_percent != null) {
    observations[0].discount_percent = discount_percent;
    observations[0].retail_price = retail_price;
  }

  return observations;
}

function detectBrandHeader(line) {
  const match = BRAND_HEADERS.find(([pattern]) => pattern.test(line));
  return match?.[1] || null;
}

function inferBrandFromReference(reference) {
  const ref = String(reference || '').toUpperCase();
  if (/^RM\s*\d/.test(ref)) return 'Richard Mille';
  if (/^(?:15|26|67|77)\d{3}[A-Z]{2}(?:\.|$)/.test(ref)) return 'Audemars Piguet';
  if (/^[245678]\d{3}[VH]\//.test(ref)) return 'Vacheron Constantin';
  if (/^WSSA\d{4}$/.test(ref)) return 'Cartier';
  if (/^\d{3}\.[A-Z]{2}\.\d{4}\.[A-Z]{2}\.\d{4}$/.test(ref)) return 'Hublot';
  if (/^PAM\d/.test(ref)) return 'Panerai';
  if (/^\d{6}[A-Z]{0,5}$/.test(ref)) return 'Rolex';
  if (/^[34567]\d{3}[A-Z]?(?:\/\d[A-Z0-9]*)?(?:-\d{3})?$/.test(ref)) return 'Patek Philippe';
  return null;
}

function isPriceLikeReferenceToken(text, matchIndex, rawToken) {
  const before = text.slice(Math.max(0, matchIndex - 24), matchIndex);
  const after = text.slice(matchIndex + rawToken.length, matchIndex + rawToken.length + 24);
  const compact = String(rawToken).toUpperCase();
  const isBareNumericToken = /^\d{5,6}$/.test(compact);
  const followsPriceLabel = /(?:price|ask(?:ing)?|usd|hkd|usdt|us\$|hk\$|\$)\s*$/i.test(before);
  const hasCurrencySuffix = /^\d{5,6}(?:USD|HKD|USDT)$/.test(compact);
  const precedesCurrencyWord = isBareNumericToken && /^\s*(?:usd|hkd|usdt|us\$|hk\$)\b/i.test(after);
  const hasDirectDollarSuffix = isBareNumericToken && /^\$/.test(after);
  return followsPriceLabel || hasCurrencySuffix || precedesCurrencyWord || hasDirectDollarSuffix;
}

function extractReference(line) {
  const text = String(line);
  const patterns = [
    /\b(RM\s*\d{2,3}(?:-\d{2})?(?:\s*[A-Z0-9]+)?)\b/i,
    /\b((?:15|26|67|77)\d{3}[A-Z]{2}(?:\.[A-Z0-9.]+)?)\b/i,
    /\b([245678]\d{3}[VH]\/[A-Z0-9-]+)\b/i,
    /\b(WSSA\d{4})\b/i,
    /\b(\d{3}\.[A-Z]{2}\.\d{4}\.[A-Z]{2}\.\d{4})\b/i,
    /\b(\d{4}\/\d[A-Z0-9-]*)\b/i,
    /\b([345678]\d{3}[A-Z](?:-\d{3})?)\b/i,
    /\b(PAM\s*\d{3,5})\b/i,
    /\b(\d{5,6}[A-Z]{1,5})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && !isPriceLikeReferenceToken(text, match.index, match[1])) {
      return match[1].replace(/\s/g, '').toUpperCase();
    }
  }

  // A bare six-digit reference is valid for Rolex, but a six-digit asking
  // price (for example "195000 USD") must never create a phantom listing.
  for (const match of text.matchAll(/\b(\d{5,6})\b/g)) {
    if (!isPriceLikeReferenceToken(text, match.index, match[1])) return match[1];
  }
  return null;
}

function looksLikeHeader(line, reference) {
  const text = String(line).trim();
  if (!text || reference) return false;
  return text.length < 100 && (
    Boolean(detectBrandHeader(text))
    || /\b(?:brand\s+new|new|used|coming\s+stock|without\s+box|watch\s+only|full\s+set|only\s+watch\s+and\s+card)\b/i.test(text)
    || /\b(?:HKD|USD|USDT|HK\$)\b|\u6e2f\u5e01|\u6e2f\u5e63/i.test(text)
    || /(?:\bWTB\b|want\s+to\s+buy|looking\s+for|seeking|wanted|\bLF\b|\u6c42\u8d2d|\u6c42\u8cfc|\u6c42\u6536|\u6536\u8d2d|\u5bfb\u627e|\u5c0b\u627e|\u627e\u8868|\u627e\u8ca8)|^\u6536[\uff1a:\s]/i.test(text)
  );
}

function applyHeaderContext(context, line) {
  const next = { ...context };
  const brand = detectBrandHeader(line);
  if (brand) next.brand_context = brand;
  const currency = inferContextCurrency(line, null);
  if (currency) next.currency_context = currency;
  if (/\b(?:brand\s+new|new)\b/i.test(line)) next.condition_context = 'New';
  if (/\bused\b/i.test(line)) next.condition_context = 'Used';
  if (/without\s+box/i.test(line)) next.set_status_context = 'Without Box';
  if (/only\s+watch\s+and\s+card|watch\s+only/i.test(line)) next.set_status_context = 'Watch Only';
  if (/full\s+set/i.test(line)) next.set_status_context = 'Full Set';
  if (/coming\s+stock/i.test(line)) next.listing_status_context = 'COMING';
  if (/(?:\bWTB\b|want\s+to\s+buy|looking\s+for|seeking|wanted|\bLF\b|\u6c42\u8d2d|\u6c42\u8cfc|\u6c42\u6536|\u6536\u8d2d|\u5bfb\u627e|\u5c0b\u627e|\u627e\u8868|\u627e\u8ca8)|^\s*\u6536[\uff1a:\s]/i.test(line)) next.intent_context = 'WTB';
  return next;
}

function inferIntent(line, inherited = null) {
  if (/(?:\bWTB\b|want\s+to\s+buy|looking\s+for|seeking|wanted|\bLF\b|\u6c42\u8d2d|\u6c42\u8cfc|\u6c42\u6536|\u6536\u8d2d|\u5bfb\u627e|\u5c0b\u627e|\u627e\u8868|\u627e\u8ca8)|^\s*\u6536[\uff1a:\s]/i.test(line)) return 'WTB';
  if (/\b(?:sold|withdrawn)\b/i.test(line)) return 'WITHDRAWN';
  return inherited || 'WTS';
}

function segmentDealerMessage(rawMessage) {
  const candidates = [];
  let context = {};
  const lines = String(rawMessage || '')
    .replace(/_x000D_/gi, '\n')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const reference = extractReference(line);
    if (looksLikeHeader(line, reference)) {
      context = applyHeaderContext(context, line);
      continue;
    }
    if (!reference) continue;

    const inferredBrand = inferBrandFromReference(reference);
    const explicitBrand = detectBrandHeader(line);
    candidates.push({
      rawLine: line,
      reference,
      context: {
        ...context,
        brand_context: inferredBrand || explicitBrand || context.brand_context || null,
        intent_context: inferIntent(line, context.intent_context),
      },
      prices: extractPriceObservations(line, context),
    });
  }

  return candidates;
}

module.exports = {
  extractPriceObservations,
  extractReference,
  inferBrandFromReference,
  parseNumber,
  segmentDealerMessage,
};

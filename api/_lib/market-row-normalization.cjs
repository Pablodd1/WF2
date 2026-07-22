'use strict';

const { parseNumber, segmentDealerMessage } = require('./normalization-v4.cjs');

const FX_TO_USD = {
  USD: 1,
  USDT: 1,
  HKD: 1 / 7.8,
  EUR: 1.08,
  GBP: 1.27,
  CHF: 1.12,
  SGD: 0.74,
  CNY: 0.138,
};

const CURRENCY_PATTERNS = {
  USD: ['USDT', 'USD', 'US\\$', 'U\\$'],
  HKD: ['HKD', 'HDK', 'HK\\$', 'H\\.K\\.D\\.?', 'H\\s*K\\s*\\.\\s*D\\.?', 'H\\.\\s*K\\s*\\.?\\s*D\\.?\\$', '港币', '港幣', 'HK\\s*D', 'HD\\s*K'],
  EUR: ['EUR', '€'],
  GBP: ['GBP', '£'],
  CHF: ['CHF'],
  SGD: ['SGD', 'S\\$', '新加坡幣'],
  CNY: ['CNY', 'RMB', 'CN¥', '¥'],
};

function currencyAliasRegexGroup() {
  return Object.values(CURRENCY_PATTERNS)
    .flat()
    .sort((a, b) => b.length - a.length)
    .join('|');
}

function normalizeCurrencyAlias(alias) {
  const normalized = String(alias || '').trim().toUpperCase();
  const normalizedNoMeta = normalized.replace(/\\+/g, '');
  for (const [currency, aliases] of Object.entries(CURRENCY_PATTERNS)) {
    for (const candidate of aliases) {
      const candidatePlain = candidate
        .replace(/\\\\+/g, '')
        .replace(/\\\.?/g, '')
        .replace(/\\s\\*/g, '')
        .toUpperCase();
      if (normalizedNoMeta === candidatePlain) return currency;
      if (/^\\s*HK\\s*D\\s*\\$/i.test(normalized) && currency === 'HKD') return 'HKD';
      if (/^HKD$/i.test(normalized) && currency === 'HKD') return 'HKD';
      if (new RegExp(`^${candidate}$`, 'i').test(alias || '')) return currency;
    }
  }
  return null;
}

function compact(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function currencyRank(currency) {
  const rank = {
    USD: 0,
    USDT: 0,
    EUR: 1,
    GBP: 1,
    CHF: 2,
    HKD: 2,
    SGD: 2,
    CNY: 2,
  };
  return rank[currency] ?? 99;
}

function hasUsdtOrUsdCandidate(candidates) {
  return candidates.some(candidate => candidate.currency === 'USD' || candidate.currency === 'USDT');
}

function looksLikeYearValue(rawNumber) {
  const numeric = Number.parseInt(String(rawNumber).trim(), 10);
  return /^\d{4}$/.test(String(rawNumber).trim()) && numeric >= 1900 && numeric <= 2099;
}

function contextCurrencyForReference(rawMessage, reference) {
  const refs = (Array.isArray(reference) ? reference : [reference]).map(compact).filter(Boolean);
  if (!refs.length) return null;
  const candidate = segmentDealerMessage(rawMessage || '').find(item => refs.includes(compact(item.reference)));
  return candidate?.context?.currency_context || null;
}

function explicitAmount(line, contextCurrency = null) {
  const labels = currencyAliasRegexGroup();
  const multipliers = '(k|m|mn|w|萬|万|mil|mill)';
  const before = new RegExp(`(?:${labels})\\s*[:=$-]?\\s*([\\d][\\d.,]*)(?:\\s*${multipliers})?`, 'gi');
  // Do not let the currency token at the start of the next amount become the
  // suffix of the prior amount (for example "HKD 313K USDT 40.5K").
  const after = new RegExp(`([\\d][\\d.,]*)(?:\\s*${multipliers})?\\s*(?:${labels})(?![A-Z0-9])`, 'gi');
  const plainDollar = new RegExp(`(\\$)\\s*([\\d][\\d.,]*)(?:\\s*${multipliers})?`, 'gi');

  const candidates = [];

  for (const match of line.matchAll(before)) {
    const amount = parseNumber(match[1], match[2]);
    if (amount == null) continue;
    const prefix = match[0].slice(0, match[0].indexOf(match[1])).trim();
    const currency = normalizeCurrencyAlias(prefix);
    if (!currency) continue;
    candidates.push({
      currency,
      amount,
      index: match.index ?? -1,
      isYearLike: looksLikeYearValue(match[1]),
    });
  }

  for (const match of line.matchAll(after)) {
    // "HKD 1.305m USDT 168k" has two prefix-currency prices. Do not interpret
    // USDT as the suffix of the HKD amount simply because it begins the next
    // price token.
    const followingText = line.slice((match.index || 0) + match[0].length);
    if (/^\s*\d[\d.,]*(?:\s*(?:k|m|mn|w|mil|mill|萬|万))?\b/i.test(followingText)) continue;
    const amount = parseNumber(match[1], match[2]);
    if (amount == null) continue;
    const suffix = match[0].slice(match[1].length + (match[2] || '').length).trim();
    const currency = normalizeCurrencyAlias(suffix);
    if (!currency) continue;
    candidates.push({
      currency,
      amount,
      index: match.index ?? -1,
      isYearLike: looksLikeYearValue(match[1]),
    });
  }

  // A bare '$' has no reliable currency by itself. It can inherit only explicit
  // HKD/EUR/etc. evidence on this listing line or its parsed message section.
  for (const match of line.matchAll(plainDollar)) {
    const amount = parseNumber(match[2], match[3]);
    if (amount == null) continue;
    const nearby = line.slice(Math.max(0, match.index - 28), match.index + match[0].length + 28);
    let inferred = null;
    if (/港|HK\s*D|HKD|HK\$/i.test(nearby)) {
      inferred = 'HKD';
    } else if (/€/.test(nearby)) {
      inferred = 'EUR';
    } else if (/£/.test(nearby)) {
      inferred = 'GBP';
    } else if (/¥/.test(nearby)) {
      inferred = 'CNY';
    }
    if (!inferred) inferred = contextCurrency;
    if (!inferred) continue;
    candidates.push({
      currency: inferred,
      amount,
      index: match.index ?? -1,
      isYearLike: looksLikeYearValue(match[2]),
      explicit: false,
      rawCurrency: match[1],
      lineValue: match[0],
    });
  }

  if (!candidates.length) return null;

  const hasUsd = hasUsdtOrUsdCandidate(candidates);
  let candidatesForChoice = candidates;
  if (!hasUsd) {
    const nonYear = candidates.filter(candidate => !candidate.isYearLike);
    if (nonYear.length) {
      candidatesForChoice = nonYear;
    }
  }

  const chosen = (candidatesForChoice && candidatesForChoice.length ? candidatesForChoice : candidates)
    .sort((a, b) => {
      const rankDelta = currencyRank(a.currency) - currencyRank(b.currency);
      if (rankDelta !== 0) return rankDelta;
      if (hasUsd) {
        if (a.currency === 'USD' || a.currency === 'USDT') {
          if (b.currency !== 'USD' && b.currency !== 'USDT') return -1;
        } else if (b.currency === 'USD' || b.currency === 'USDT') {
          return 1;
        }
      }
      return a.index - b.index;
    })[0];

  return { amount: chosen.amount, currency: chosen.currency };
}

function referenceLine(rawMessage, reference) {
  const refs = (Array.isArray(reference) ? reference : [reference]).map(compact).filter(Boolean);
  if (!refs.length) return null;
  return String(rawMessage || '').split(/\r?\n|\r\n/).find(line => refs.some(ref => compact(line).includes(ref))) || null;
}

function referenceBlock(rawMessage, reference) {
  const refs = (Array.isArray(reference) ? reference : [reference]).map(compact).filter(Boolean);
  const lines = String(rawMessage || '').split(/\r?\n|\r\n/);
  const index = lines.findIndex(line => refs.some(ref => compact(line).includes(ref)));
  if (index < 0) return null;
  const block = [lines[index]];
  for (let offset = 1; offset <= 4 && index + offset < lines.length; offset += 1) {
    const next = lines[index + offset].trim();
    if (!next) break;
    const tokens = next.toUpperCase().match(/[A-Z0-9]+(?:\/[A-Z0-9-]+)?/g) || [];
    const containsOtherReference = tokens.some(token => {
      const normalized = compact(token);
      if (refs.some(ref => normalized.includes(ref))) return false;
      if (/^(?:19|20)\d{2}$/.test(normalized)) return false;
      return token.includes('/') || /\d/.test(token) && normalized.length >= 5;
    });
    if (containsOtherReference) break;
    block.push(next);
  }
  return block.join(' ');
}

function normalizeMarketRow(row, reference) {
  const stored = Number(row.price_usd);
  const line = referenceBlock(row.raw_message, reference);
  if (!line) return { ...row, analytics_price_usd: stored, price_normalization: null };
  const explicit = explicitAmount(line, contextCurrencyForReference(row.raw_message, reference));
  if (explicit && FX_TO_USD[explicit.currency] != null) {
    const converted = Math.round(explicit.amount * FX_TO_USD[explicit.currency]);
    const tag = explicit.currency === 'USD'
      ? 'EXPLICIT_USD_FROM_REFERENCE_LINE'
      : explicit.currency === 'HKD'
        ? 'EXPLICIT_HKD_FROM_REFERENCE_LINE'
        : `EXPLICIT_${explicit.currency}_FROM_REFERENCE_LINE`;
    return {
      ...row,
      analytics_price_usd: converted,
      price_normalization: converted !== Math.round(stored) ? tag : null,
    };
  }
  return { ...row, analytics_price_usd: stored, price_normalization: null };
}

module.exports = { normalizeMarketRow, referenceBlock, referenceLine };

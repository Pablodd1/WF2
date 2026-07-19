'use strict';

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text && !/^(?:unknown|null|n\/a)$/i.test(text) ? text : null;
}

function isPriceLike(value) {
  const text = cleanText(value);
  if (!text) return false;
  return /^(?:[$£€¥]\s*)?[\d,.]+(?:\s*(?:k|m|mn|mil|million|w|万))?(?:\s*(?:usd|usdt|hkd|hk\$|eur|gbp|chf|rmb|cny|jpy))?$/i.test(text)
    || /^(?:usd|usdt|hkd|hk\$|eur|gbp|chf|rmb|cny|jpy)\s*[\d,.]+/i.test(text);
}

function sanitizeTradingRecord(record) {
  const issues = [];
  const sanitized = { ...record };
  const brand = cleanText(record.brand);
  const reference = cleanText(record.reference);
  const dial = cleanText(record.dial_color);
  const condition = cleanText(record.condition);

  if (reference && brand && reference.localeCompare(brand, undefined, { sensitivity: 'accent' }) === 0) {
    sanitized.reference = null;
    issues.push('REFERENCE_EQUALS_BRAND');
  } else if (isPriceLike(reference)) {
    sanitized.reference = null;
    issues.push('REFERENCE_PRICE_CONTAMINATION');
  }

  if (isPriceLike(dial)) {
    sanitized.dial_color = null;
    issues.push('DIAL_PRICE_CONTAMINATION');
  }

  if (isPriceLike(condition)) {
    sanitized.condition = null;
    issues.push('CONDITION_PRICE_CONTAMINATION');
  }

  const year = Number(record.year);
  if (record.year != null && (!Number.isInteger(year) || year < 1800 || year > new Date().getUTCFullYear() + 2)) {
    sanitized.year = null;
    issues.push('YEAR_INVALID');
  }

  const price = Number(record.price_usd);
  if (record.price_usd != null && (!Number.isFinite(price) || price <= 0)) {
    sanitized.price_usd = null;
    issues.push('PRICE_INVALID');
  }

  return {
    ...sanitized,
    data_quality_issues: issues,
    data_quality_review_required: issues.length > 0,
  };
}

module.exports = { isPriceLike, sanitizeTradingRecord };

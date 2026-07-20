'use strict';

const { extractReference, inferBrandFromReference, segmentDealerMessage } = require('./normalization-v4.cjs');

function comparable(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function looksLikePriceOrListingText(reference) {
  const value = String(reference || '').trim();
  return /(?:HKD|HDK|USD|USDT|HK\$|US\$|\$)/i.test(value)
    || /^\d+(?:[.,]\d+)?(?:K|M|MIL|MILL|MN)$/i.test(value)
    || /\b(?:NEW|USED|WATCH\s*ONLY|FULL\s*SET|YEAR|ITEM|STOCK)\b/i.test(value);
}

function classifyNonWatch(rawLine) {
  const raw = String(rawLine || '').trim();
  if (/^(?:[_*\s-]*)(?:strap|bracelet|wooden\s+box|watch\s+box|box|link)\b/i.test(raw)
    || /\b(?:wooden\s+box|panthere\s+link)\b/i.test(raw)) return 'ACCESSORY_NOT_WATCH';
  if (/\b(?:birkin|constance|hac\s+o\s+dos)\b/i.test(raw)) return 'NON_WATCH_OR_WRONG_CATEGORY';
  return null;
}

const BRAND_REFERENCE_PATTERNS = [
  [/RICHARDMILLE/, /\b(?:RM\s*)?(\d{2,3}-\d{2})(?:\s+[A-Z]{2})?\b/gi, value => `RM${value}`],
  [/PATEKPHILIPPE|PATEK|PP/, /\b([345678]\d{3}[A-Z]?(?:\/\d[A-Z0-9]*)?(?:-\d{3})?)\b/gi],
  [/AUDEMARSPIGUET|AP/, /\b((?:15|26|67|77)\d{3}[A-Z]{2}(?:\.[A-Z0-9.]+)?)\b/gi],
  [/CARTIER/, /\b(W[A-Z]{3}\d{4})\b/gi],
  [/HUBLOT/, /\b(\d{3}\.[A-Z0-9]{2}\.[A-Z0-9]{4}\.[A-Z0-9]{2}(?:\.[A-Z0-9]{4})?)\b/gi],
  [/VACHERONCONSTANTIN|VACHERON|VC/, /\b((?:\d{4}[VH](?:\/\d{3}[A-Z]-[A-Z0-9]+)?|\d{5}))\b/gi],
  [/OMEGA/, /\b(\d{3}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{3})\b/gi],
  [/TUDOR/, /\b(M?7\d{3}[A-Z0-9]+-\d{4})\b/gi, value => value.startsWith('M') ? value : `M${value}`],
  [/PANERAI/, /\bPAM\s*(\d{3,5})\b/gi, value => `PAM${value.padStart(5, '0')}`],
  [/JAEGERLECOULTRE|JLC/, /\b(Q\d{7})\b/gi],
  [/IWC/, /\b(IW\d{6})\b/gi],
  [/PIAGET/, /\b(G0A\s*\d{5})\b/gi, value => value.replace(/\s/g, '')],
  [/LONGINES/, /\b(L\d\.\d{3}\.\d\.\d{2}\.\d)\b/gi],
  [/BELLROSS/, /\b(BR\s?\d{2}(?:-?\d{2}|[A-Z0-9/-]{5,}))\b/gi, value => value.replace(/\s/g, '')],
];

function brandReferences(brand, rawLine) {
  const brandKey = comparable(brand);
  const rule = BRAND_REFERENCE_PATTERNS.find(([pattern]) => pattern.test(brandKey));
  if (!rule) return [];
  const [, pattern, formatter = value => value] = rule;
  pattern.lastIndex = 0;
  const matches = [];
  for (const match of String(rawLine || '').matchAll(pattern)) {
    const value = formatter(String(match[1] || '').toUpperCase());
    if (value && !matches.includes(value)) matches.push(value);
  }
  return matches;
}

function assessReferenceQuality({ brand, reference, rawLine }) {
  const reasons = [];
  const nonWatchReason = classifyNonWatch(rawLine);
  if (nonWatchReason) reasons.push(nonWatchReason);

  const candidates = segmentDealerMessage(rawLine || '');
  const exactBrandReferences = brandReferences(brand, rawLine);
  if (candidates.length > 1 || exactBrandReferences.length > 1) reasons.push('MULTI_WATCH_STOCK_LIST');

  const extracted = exactBrandReferences.length === 1 ? exactBrandReferences[0] : extractReference(rawLine || '');
  const exported = String(reference || '').trim();
  const exportedKey = comparable(exported);
  const extractedKey = comparable(extracted);
  let proposedReference = null;

  if (!exported) reasons.push('REFERENCE_MISSING');
  if (exported && looksLikePriceOrListingText(exported)) reasons.push('REFERENCE_IS_PRICE_OR_LISTING_TEXT');
  if (exported && comparable(brand) === exportedKey) reasons.push('REFERENCE_IS_BRAND_ONLY');

  if (extracted && extractedKey !== exportedKey && !reasons.includes('MULTI_WATCH_STOCK_LIST')) {
    proposedReference = extracted;
    reasons.push('REFERENCE_CORRECTION_AVAILABLE');
  } else if (!extracted && (reasons.includes('REFERENCE_MISSING')
    || reasons.includes('REFERENCE_IS_PRICE_OR_LISTING_TEXT')
    || reasons.includes('REFERENCE_IS_BRAND_ONLY'))) {
    reasons.push('NEEDS_MANUAL_REVIEW');
  }

  const inferredBrand = inferBrandFromReference(proposedReference || extracted || exported);
  if (inferredBrand && brand && comparable(inferredBrand) !== comparable(brand)) {
    reasons.push('WRONG_BRAND_SUSPECT');
  }

  return {
    proposed_reference: proposedReference,
    extracted_reference: extracted || null,
    reasons: [...new Set(reasons)],
    safe: reasons.length === 0,
  };
}

module.exports = { assessReferenceQuality, brandReferences, classifyNonWatch, looksLikePriceOrListingText };

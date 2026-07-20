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

function assessReferenceQuality({ brand, reference, rawLine }) {
  const reasons = [];
  const nonWatchReason = classifyNonWatch(rawLine);
  if (nonWatchReason) reasons.push(nonWatchReason);

  const candidates = segmentDealerMessage(rawLine || '');
  if (candidates.length > 1) reasons.push('MULTI_WATCH_STOCK_LIST');

  const extracted = extractReference(rawLine || '');
  const exported = String(reference || '').trim();
  const exportedKey = comparable(exported);
  const extractedKey = comparable(extracted);
  let proposedReference = null;

  if (!exported) reasons.push('REFERENCE_MISSING');
  if (exported && looksLikePriceOrListingText(exported)) reasons.push('REFERENCE_IS_PRICE_OR_LISTING_TEXT');
  if (exported && comparable(brand) === exportedKey) reasons.push('REFERENCE_IS_BRAND_ONLY');

  if (extracted && extractedKey !== exportedKey) {
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

module.exports = { assessReferenceQuality, classifyNonWatch, looksLikePriceOrListingText };

'use strict';

const THREE_WATCH_RELEASE_REFERENCES = [
  'Rolex::116610LN',
  'Patek Philippe::5712/1A',
  'Patek Philippe::5712/1A-001',
  'Rolex::126710BLNR',
].join('|');
const FULL_REVIEWED_BRAND_RELEASE = 'ALL_REVIEWED';
const FULL_REVIEWED_BRANDS = new Set(['rolex', 'patek philippe']);
const MIN_RELEASE_CONFIDENCE = 90;

function normalizePublicationReference(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function parsedReferences(value) {
  return [...new Map(String(value || '')
    .split('|')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const separator = entry.indexOf('::');
      if (separator < 1) return null;
      const brand = entry.slice(0, separator).trim();
      const reference = entry.slice(separator + 2).trim();
      const normalizedReference = normalizePublicationReference(reference);
      return [`${brand.toLowerCase()}::${normalizedReference}`, {
        brand,
        reference,
        normalizedReference,
      }];
    })
    .filter(entry => entry && entry[1].brand && entry[1].normalizedReference)).values()];
}

const REVIEWED_RELEASE_REFERENCES = parsedReferences(THREE_WATCH_RELEASE_REFERENCES);

function isFullReviewedBrandRelease(value = process.env.PUBLICATION_REFERENCES) {
  return String(value || '').trim().toUpperCase() === FULL_REVIEWED_BRAND_RELEASE;
}

function publicationReferences(value = process.env.PUBLICATION_REFERENCES) {
  // Deployment configuration may restrict this reviewed release, but it may
  // never add a brand/reference pair. Empty or omitted configuration uses the
  // reviewed defaults; malformed or unknown non-empty configuration fails shut.
  const configured = String(value || '').trim();
  if (isFullReviewedBrandRelease(configured)) return [];
  if (!configured) return REVIEWED_RELEASE_REFERENCES.map(entry => ({ ...entry }));
  const requestedKeys = new Set(parsedReferences(configured).map(entry =>
    `${entry.brand.toLowerCase()}::${entry.reference.toUpperCase()}`));
  return REVIEWED_RELEASE_REFERENCES
    .filter(entry => requestedKeys.has(`${entry.brand.toLowerCase()}::${entry.reference.toUpperCase()}`))
    .map(entry => ({ ...entry }));
}

function isPublicationReferenceAllowed(brand, reference, value = process.env.PUBLICATION_REFERENCES) {
  if (isFullReviewedBrandRelease(value)) {
    return FULL_REVIEWED_BRANDS.has(String(brand || '').trim().toLowerCase())
      && Boolean(normalizePublicationReference(reference));
  }
  const allowed = publicationReferences(value);
  if (!allowed.length) return false;
  const normalizedBrand = String(brand || '').trim().toLowerCase();
  const exactReference = String(reference || '').trim().toUpperCase();
  return allowed.some(entry =>
    entry.brand.toLowerCase() === normalizedBrand
    && entry.reference.toUpperCase() === exactReference);
}

function isReleaseListingEligible(record, value = process.env.PUBLICATION_REFERENCES) {
  const confidence = Number(record?.confidence);
  return Boolean(
    record
    && isPublicationReferenceAllowed(record.brand, record.reference, value)
    && String(record.verdict || '').trim().toUpperCase() === 'APPROVED'
    && Number.isFinite(confidence)
    && confidence >= MIN_RELEASE_CONFIDENCE
  );
}

function publicationReferencesForBrand(brand, value = process.env.PUBLICATION_REFERENCES) {
  const normalizedBrand = String(brand || '').trim().toLowerCase();
  return publicationReferences(value)
    .filter(entry => entry.brand.toLowerCase() === normalizedBrand)
    .map(entry => entry.reference);
}

function publicationReferencePostgrestFilter(value = process.env.PUBLICATION_REFERENCES) {
  const references = [...new Set(publicationReferences(value).map(entry => entry.reference))];
  if (!references.length) return null;
  return `in.(${references.map(reference => `"${reference.replaceAll('"', '')}"`).join(',')})`;
}

module.exports = {
  FULL_REVIEWED_BRAND_RELEASE,
  FULL_REVIEWED_BRANDS,
  MIN_RELEASE_CONFIDENCE,
  THREE_WATCH_RELEASE_REFERENCES,
  isFullReviewedBrandRelease,
  isPublicationReferenceAllowed,
  isReleaseListingEligible,
  normalizePublicationReference,
  publicationReferencePostgrestFilter,
  publicationReferences,
  publicationReferencesForBrand,
};

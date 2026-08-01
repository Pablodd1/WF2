'use strict';

// Controlled release is now OPEN — all brands are publicly accessible.
// Set PUBLICATION_BRANDS env var to re-enable per-brand gating if needed
// for a future controlled rollout (comma or pipe separated).
// When PUBLICATION_BRANDS is unset/empty, ALL brands are allowed.

const CONTROLLED_FILE_RELEASE_BRANDS = [];

function publicationBrands(value = process.env.PUBLICATION_BRANDS) {
  const configured = String(value || '')
    .split(/[|,]/)
    .map(brand => brand.trim())
    .filter(Boolean);
  return [...new Set([...configured, ...CONTROLLED_FILE_RELEASE_BRANDS])];
}

function isPublicationBrandAllowed(brand, value = process.env.PUBLICATION_BRANDS) {
  const allowed = publicationBrands(value);
  // Empty list = all brands allowed (open access)
  if (!allowed.length) return true;
  const normalized = String(brand || '').trim().toLowerCase();
  return allowed.some(candidate => candidate.toLowerCase() === normalized);
}

function publicationBrandPostgrestFilter(value = process.env.PUBLICATION_BRANDS) {
  const allowed = publicationBrands(value);
  // Empty list = no filter (all brands returned)
  if (!allowed.length) return null;
  return `in.(${allowed.map(brand => `"${brand.replaceAll('"', '')}"`).join(',')})`;
}

module.exports = {
  CONTROLLED_FILE_RELEASE_BRANDS,
  isPublicationBrandAllowed,
  publicationBrandPostgrestFilter,
  publicationBrands,
};

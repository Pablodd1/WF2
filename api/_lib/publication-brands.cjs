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
  // OPEN ACCESS — all brands are publicly searchable regardless of env var.
  return true;
}

function publicationBrandPostgrestFilter(value = process.env.PUBLICATION_BRANDS) {
  // OPEN ACCESS — no brand filter applied.
  return null;
}

module.exports = {
  CONTROLLED_FILE_RELEASE_BRANDS,
  isPublicationBrandAllowed,
  publicationBrandPostgrestFilter,
  publicationBrands,
};

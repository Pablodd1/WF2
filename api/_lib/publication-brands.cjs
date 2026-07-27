'use strict';

function publicationBrands(value = process.env.PUBLICATION_BRANDS) {
  return [...new Set(String(value || '')
    .split(/[|,]/)
    .map(brand => brand.trim())
    .filter(Boolean))];
}

function isPublicationBrandAllowed(brand, value = process.env.PUBLICATION_BRANDS) {
  const allowed = publicationBrands(value);
  if (!allowed.length) return true;
  const normalized = String(brand || '').trim().toLowerCase();
  return allowed.some(candidate => candidate.toLowerCase() === normalized);
}

function publicationBrandPostgrestFilter(value = process.env.PUBLICATION_BRANDS) {
  const allowed = publicationBrands(value);
  if (!allowed.length) return null;
  return `in.(${allowed.map(brand => `"${brand.replaceAll('"', '')}"`).join(',')})`;
}

module.exports = {
  isPublicationBrandAllowed,
  publicationBrandPostgrestFilter,
  publicationBrands,
};

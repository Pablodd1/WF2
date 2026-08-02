'use strict';

const MARKET_SOURCE_VIEW = 'reviewed_workbook_market_source_v2';
const PAGE_SIZE = 1000;
const MAX_ROWS_PER_BRAND = 10000;
const MINIMUM_ANALYTICS_SAMPLE = 5;

function clean(value) {
  const text = String(value || '').trim();
  return text && !/^(?:unknown|null|n\/a)$/i.test(text) ? text : '';
}

function rowModel(row) {
  return clean(row.catalog_model) || clean(row.model) || 'Reference-only listings';
}

function rowReference(row) {
  return clean(row.public_reference)
    || clean(row.normalized_reference)
    || clean(row.raw_reference)
    || clean(row.catalog_reference);
}

async function loadReviewedWorkbookBrandRows(client, brand) {
  const rows = [];
  for (let from = 0; from < MAX_ROWS_PER_BRAND; from += PAGE_SIZE) {
    const { data, error } = await client
      .from(MARKET_SOURCE_VIEW)
      .select([
        'id',
        'model',
        'catalog_model',
        'public_reference',
        'raw_reference',
        'normalized_reference',
        'catalog_reference',
        'dial_color',
        'catalog_dial',
        'listing_type',
        'price_evidence_status',
        'verified_price_usd',
      ].join(','))
      .eq('brand_scope', brand)
      .eq('has_complete_identity', true)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

function summarizeReviewedWorkbookModels(rows) {
  const models = new Map();
  for (const row of rows) {
    const reference = rowReference(row);
    if (!reference) continue;
    const model = rowModel(row);
    const current = models.get(model) || { references: new Set(), listing_count: 0 };
    current.references.add(reference);
    current.listing_count += 1;
    models.set(model, current);
  }
  return [...models.entries()]
    .map(([model, value]) => ({
      model,
      reference_count: value.references.size,
      listing_count: value.listing_count,
    }))
    .sort((left, right) => right.listing_count - left.listing_count || left.model.localeCompare(right.model));
}

function summarizeReviewedWorkbookReferences(rows, requestedModel, truncated = false) {
  const references = new Map();
  for (const row of rows) {
    if (rowModel(row) !== requestedModel) continue;
    const reference = rowReference(row);
    if (!reference) continue;
    const current = references.get(reference) || { members: 0, eligiblePrices: [], dials: new Map() };
    current.members += 1;
    const verifiedPrice = Number(row.verified_price_usd);
    if (
      String(row.listing_type || '').toUpperCase() === 'WTS'
      && row.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH'
      && Number.isFinite(verifiedPrice)
      && verifiedPrice > 0
    ) {
      current.eligiblePrices.push(verifiedPrice);
    }
    const dial = clean(row.catalog_dial) || clean(row.dial_color);
    if (dial) current.dials.set(dial, (current.dials.get(dial) || 0) + 1);
    references.set(reference, current);
  }
  return [...references.entries()]
    .map(([reference, value]) => ({
      reference,
      listing_count: value.members,
      eligible_observation_count: value.eligiblePrices.length,
      analytics_ready: value.eligiblePrices.length >= MINIMUM_ANALYTICS_SAMPLE,
      sample_capped: truncated,
      avg_price: value.eligiblePrices.length >= MINIMUM_ANALYTICS_SAMPLE
        ? Math.round(value.eligiblePrices.reduce((sum, price) => sum + price, 0) / value.eligiblePrices.length)
        : null,
      dial_colors: [...value.dials.entries()]
        .map(([dial_color, count]) => ({ dial_color, count }))
        .sort((left, right) => right.count - left.count || left.dial_color.localeCompare(right.dial_color)),
      identity_source: 'OWNER_REVIEWED_WORKBOOK',
    }))
    .sort((left, right) => right.listing_count - left.listing_count || left.reference.localeCompare(right.reference));
}

module.exports = {
  MARKET_SOURCE_VIEW,
  loadReviewedWorkbookBrandRows,
  rowModel,
  rowReference,
  summarizeReviewedWorkbookModels,
  summarizeReviewedWorkbookReferences,
};

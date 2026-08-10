'use strict';

const MARKET_SOURCE_VIEW = 'reviewed_workbook_market_source_v2';

function clean(value) {
  const text = String(value || '').trim();
  return text || null;
}

function mapWorkbookAnalyticsRow(row) {
  const isBundle = String(row.listing_type || '').toUpperCase() === 'BUNDLE';
  const imageCandidate = clean(row.final_image_url) || clean(row.user_image_url);
  const exactImage = !isBundle && (row.has_exact_source_image === true || Boolean(imageCandidate)) ? imageCandidate : null;
  const contactApproved = row.contact_publication_approved === true;
  const verifiedUsd = row.verified_price_usd == null ? null : Number(row.verified_price_usd);
  const hasVerifiedUsd = row.has_verified_usd_price === true
    && Number.isFinite(verifiedUsd)
    && verifiedUsd > 0;
  const priceUsd = hasVerifiedUsd ? verifiedUsd : null;
  return {
    id: row.id,
    brand: clean(row.supplied_brand) || clean(row.canonical_brand) || clean(row.brand_scope),
    model: clean(row.model) || clean(row.catalog_model),
    reference: clean(row.public_reference) || clean(row.normalized_reference)
      || clean(row.raw_reference) || clean(row.catalog_reference),
    dial_color: clean(row.dial_color) || clean(row.catalog_dial),
    condition: clean(row.condition),
    price_raw: row.source_price_amount == null ? null : Number(row.source_price_amount),
    price_usd: priceUsd,
    verified_price_usd: verifiedUsd,
    has_verified_usd_price: hasVerifiedUsd,
    currency: clean(row.source_currency),
    raw_message: clean(row.raw_message),
    flags: {},
    created_at: row.posting_date || row.imported_at || null,
    listing_date: row.posting_date || null,
    source: 'REVIEWED_WORKBOOK_INVENTORY',
    source_type: 'owner_reviewed_workbook',
    year: null,
    listing_type: clean(row.listing_type) || 'WTS',
    dealer_id: null,
    owner_reviewed_identity: true,
    analytics_currency_status: priceUsd === null ? 'CURRENCY_UNVERIFIED' : 'VERIFIED',
    source_price_amount: row.source_price_amount == null ? null : Number(row.source_price_amount),
    source_currency: clean(row.source_currency),
    workbook_source_file: clean(row.source_file),
    workbook_source_row_number: row.source_row_number == null ? null : Number(row.source_row_number),
    workbook_source_record_id: clean(row.source_record_id),
    thumbnail_url: exactImage,
    image_urls: exactImage ? [exactImage] : [],
    has_images: Boolean(exactImage),
    seller_name: clean(row.seller_name) || clean(row.posted_by),
    seller_phone: clean(row.seller_phone) || clean(row.phone_number),
    contact_publication_approved: contactApproved,
    verdict: clean(row.verdict) || clean(row.verification_status) || 'APPROVED',
    confidence: row.confidence == null ? 100 : Number(row.confidence),
    listing_status: clean(row.listing_status) || clean(row.verification_status) || 'ACTIVE',
    source_file: clean(row.source_file),
    source_row_number: row.source_row_number == null ? null : Number(row.source_row_number),
  };
}

const WORKBOOK_COLUMNS = [
  'id,source_file,source_row_number,source_record_id,posting_date,raw_message,listing_type',
  'brand_scope,supplied_brand,canonical_brand,model,catalog_model,raw_reference',
  'normalized_reference,catalog_reference,public_reference,dial_color,catalog_dial,condition',
  'source_price_amount,source_currency,price_evidence_status,confidence,verification_status',
  'user_image_url,verified_price_usd,imported_at,has_exact_source_image,has_verified_usd_price',
  'reference_search_key,has_complete_identity,seller_name,seller_phone,contact_publication_approved,verdict,listing_status',
].join(',');

const LEGACY_WORKBOOK_COLUMNS = WORKBOOK_COLUMNS
  .replace('seller_name,seller_phone,', 'posted_by,phone_number,')
  .replace(',verdict,listing_status', '');

function isMissingColumnError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || error || '');
  return /42703|does not exist/i.test(`${code} ${message}`);
}

async function executeAnalyticsQuery(client, columns, { brand, keys, limit }) {
  let query = client
    .from(MARKET_SOURCE_VIEW)
    .select(columns)
    .eq('brand_scope', clean(brand))
    .in('reference_search_key', keys)
    .neq('verification_status', 'QUARANTINED_SOURCE_CONFLICT')
    .eq('has_complete_identity', true)
    .eq('has_verified_usd_price', true)
    .eq('listing_type', 'WTS');

  for (const value of ['multiple', 'multi', 'mixed']) {
    query = query.not('dial_color', 'ilike', value);
    query = query.not('model', 'ilike', value);
  }

  return query
    .order('posting_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(Math.min(10000, Math.max(1, Number(limit) || 10000)));
}

async function executeDemandLaneQuery(client, columns, { brand, keys, limit, hasImage }) {
  return client
    .from(MARKET_SOURCE_VIEW)
    .select(columns)
    .eq('brand_scope', clean(brand))
    .in('reference_search_key', keys)
    .in('listing_type', ['WTB', 'NTQ'])
    .eq('has_exact_source_image', hasImage)
    .order('id', { ascending: false })
    .limit(Math.min(501, Math.max(1, Number(limit) || 101)));
}

async function loadReviewedWorkbookAnalyticsRows(client, { brand, referenceKeys, limit = 10000 }) {
  const keys = [...new Set((referenceKeys || []).map(clean).filter(Boolean))];
  if (!clean(brand) || !keys.length) return [];

  let { data, error } = await executeAnalyticsQuery(client, WORKBOOK_COLUMNS, {
    brand, keys, limit,
  });
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await executeAnalyticsQuery(client, LEGACY_WORKBOOK_COLUMNS, {
      brand, keys, limit,
    }));
  }

  if (error) throw error;
  return (data || []).map(mapWorkbookAnalyticsRow);
}

async function loadReviewedWorkbookDemandRows(client, { brand, referenceKeys, limit = 100 }) {
  const keys = [...new Set((referenceKeys || []).map(clean).filter(Boolean))];
  if (!clean(brand) || !keys.length) return [];
  const boundedLimit = Math.min(500, Math.max(1, Number(limit) || 100));

  let { data: imageData, error } = await executeDemandLaneQuery(client, WORKBOOK_COLUMNS, {
    brand, keys, limit: boundedLimit + 1, hasImage: true,
  });
  if (error && isMissingColumnError(error)) {
    ({ data: imageData, error } = await executeDemandLaneQuery(client, LEGACY_WORKBOOK_COLUMNS, {
      brand, keys, limit: boundedLimit + 1, hasImage: true,
    }));
  }
  if (error) throw error;

  const imageRows = imageData || [];
  let combinedRows = imageRows.slice(0, boundedLimit);
  let sampleCapped = imageRows.length > boundedLimit;
  if (!sampleCapped && combinedRows.length < boundedLimit) {
    const remaining = boundedLimit - combinedRows.length;
    let noImageResult = await executeDemandLaneQuery(client, WORKBOOK_COLUMNS, {
      brand, keys, limit: remaining + 1, hasImage: false,
    });
    if (noImageResult.error && isMissingColumnError(noImageResult.error)) {
      noImageResult = await executeDemandLaneQuery(client, LEGACY_WORKBOOK_COLUMNS, {
        brand, keys, limit: remaining + 1, hasImage: false,
      });
    }
    if (noImageResult.error) throw noImageResult.error;
    const noImageRows = noImageResult.data || [];
    sampleCapped = noImageRows.length > remaining;
    combinedRows = combinedRows.concat(noImageRows.slice(0, remaining));
  }

  const mappedRows = combinedRows.map(mapWorkbookAnalyticsRow);
  mappedRows.sampleCapped = sampleCapped;
  return mappedRows;
}

async function loadReviewedWorkbookListing(client, id) {
  const executeListingQuery = columns => client
    .from(MARKET_SOURCE_VIEW)
    .select(columns)
    .eq('id', id)
    .eq('has_complete_identity', true)
    .eq('has_verified_usd_price', true)
    .eq('listing_type', 'WTS')
    .maybeSingle();
  let { data, error } = await executeListingQuery(WORKBOOK_COLUMNS);
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await executeListingQuery(LEGACY_WORKBOOK_COLUMNS));
  }
  if (error) throw error;
  return data ? mapWorkbookAnalyticsRow(data) : null;
}

module.exports = {
  MARKET_SOURCE_VIEW,
  WORKBOOK_COLUMNS,
  LEGACY_WORKBOOK_COLUMNS,
  isMissingColumnError,
  loadReviewedWorkbookAnalyticsRows,
  loadReviewedWorkbookDemandRows,
  loadReviewedWorkbookListing,
  mapWorkbookAnalyticsRow,
};


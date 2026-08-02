'use strict';

const MARKET_SOURCE_VIEW = 'reviewed_workbook_market_source';

function clean(value) {
  const text = String(value || '').trim();
  return text || null;
}

function mapWorkbookAnalyticsRow(row) {
  // Images: prefer exact source match, fall back to user_image_url if present.
  // reviewed-market-inventory uses has_images as the gating flag —
  // has_exact_source_image is a stricter subset that may not be set.
  const imageUrl = clean(row.front_image) || clean(row.user_image_url) || null;
  return {
    id: row.id,
    brand: clean(row.supplied_brand) || clean(row.canonical_brand) || clean(row.brand_scope),
    model: clean(row.model) || clean(row.catalog_model),
    reference: clean(row.public_reference) || clean(row.normalized_reference)
      || clean(row.raw_reference) || clean(row.catalog_reference),
    dial_color: clean(row.dial_color) || clean(row.catalog_dial),
    condition: clean(row.condition),
    price_raw: row.source_price_amount == null ? null : Number(row.source_price_amount),
    price_usd: Number(row.verified_price_usd) || Number(row.workbook_price_usd) || null,
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
    confidence: row.confidence == null ? 100 : Number(row.confidence),
    verdict: 'APPROVED',
    listing_status: 'ACTIVE',
    owner_reviewed_identity: true,
    analytics_currency_status: 'VERIFIED',
    source_price_amount: row.source_price_amount == null ? null : Number(row.source_price_amount),
    source_currency: clean(row.source_currency),
    workbook_source_file: clean(row.source_file),
    workbook_source_row_number: row.source_row_number == null ? null : Number(row.source_row_number),
    workbook_source_record_id: clean(row.source_record_id),
    thumbnail_url: imageUrl,
    image_urls: imageUrl ? [imageUrl] : [],
    has_images: Boolean(imageUrl),
    // User / dealer / verification fields
    seller_name: clean(row.seller_name) || null,
    seller_phone: clean(row.seller_phone) || null,
    contact_publication_approved: row.contact_publication_approved === true,
    verdict: clean(row.verdict) || 'APPROVED',
    confidence: row.confidence == null ? 100 : Number(row.confidence),
    listing_status: clean(row.listing_status) || 'ACTIVE',
    source_file: clean(row.source_file),
    source_row_number: row.source_row_number == null ? null : Number(row.source_row_number),
  };
}

const WORKBOOK_COLUMNS = [
  'id,source_file,source_row_number,source_record_id,posting_date,raw_message,listing_type',
  'brand_scope,supplied_brand,canonical_brand,model,catalog_model,raw_reference',
  'normalized_reference,catalog_reference,public_reference,dial_color,catalog_dial,condition',
  'source_price_amount,source_currency,price_evidence_status,confidence,verification_status',
  'user_image_url,front_image,workbook_price_usd,verified_price_usd,imported_at,has_exact_source_image,has_verified_usd_price',
  'reference_search_key,has_complete_identity,seller_name,seller_phone,contact_publication_approved,verdict,listing_status',
].join(',');

async function loadReviewedWorkbookAnalyticsRows(client, { brand, referenceKeys, limit = 10000 }) {
  const keys = [...new Set((referenceKeys || []).map(clean).filter(Boolean))];
  if (!clean(brand) || !keys.length) return [];
  const { data, error } = await client
    .from(MARKET_SOURCE_VIEW)
    .select(WORKBOOK_COLUMNS)
    // brand_scope may be null in early workbook imports — filter by reference
    .in('reference_search_key', keys)
    .eq('has_complete_identity', true)
    .eq('listing_type', 'WTS')
    // without verified price so images are available in the analytics feed.
    .order('posting_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
  if (error) throw error;
  return (data || []).map(mapWorkbookAnalyticsRow).filter(row => (
    row.brand && row.model && row.reference && row.dial_color
      && Number.isFinite(row.price_usd) && row.price_usd > 0
  ));
}

async function loadReviewedWorkbookListing(client, id) {
  const { data, error } = await client
    .from(MARKET_SOURCE_VIEW)
    .select(WORKBOOK_COLUMNS)
    .eq('id', id)
    .eq('has_complete_identity', true)
    .eq('has_verified_usd_price', true)
    .maybeSingle();
  if (error) throw error;
  return data ? mapWorkbookAnalyticsRow(data) : null;
}

module.exports = {
  MARKET_SOURCE_VIEW,
  WORKBOOK_COLUMNS,
  loadReviewedWorkbookAnalyticsRows,
  loadReviewedWorkbookListing,
  mapWorkbookAnalyticsRow,
};

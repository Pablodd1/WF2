'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

const ALLOWED_BRANDS = new Set(['Rolex', 'Patek Philippe']);
const REVIEW_BUCKETS = new Map([
  ['release-ready', 'READY_FOR_IDENTITY_REVIEW'],
]);
const SCAN_SIZE = 100;
const MAX_SCANNED_PER_PAGE = 1000;
const SELECT_FIELDS = [
  'record_id',
  'identity_status',
  'brand',
  'model',
  'reference',
  'dial_color',
  'condition',
  'year',
  'price_raw',
  'price_usd',
  'currency',
  'listing_type',
  'verdict',
  'confidence',
  'raw_message',
  'source',
  'source_type',
  'listing_date',
  'created_at',
  'seller_name',
  'seller_phone',
  'dealer_id',
  'thumbnail_url',
  'image_urls',
  'has_images',
  'prior_identity_evidence',
  'flags',
].join(',');

function normalizedFlags(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === 'object') return Object.keys(value);
  return [];
}

function passesStaticReleaseGates(row) {
  if (!String(row?.raw_message || '').trim()) return false;
  if (String(row?.verdict || '').toUpperCase() !== 'APPROVED') return false;
  const confidence = Number(row?.confidence);
  if (!Number.isFinite(confidence) || confidence < 90) return false;
  const listingType = String(row?.listing_type || '').toUpperCase();
  if (!['WTS', 'WTB', 'NTQ'].includes(listingType)) return false;
  if (normalizedFlags(row?.flags).includes('BUNDLE_SPLIT_REQUIRED')) return false;
  if (String(row?.record_id || '').startsWith('preview_demo_')) return false;
  return true;
}

async function loadLedgerBlocks(client, rows) {
  const ids = rows.map(row => row.record_id);
  if (!ids.length) return { bundleIds: new Set(), duplicateIds: new Set() };
  const [shadowResult, duplicateResult] = await Promise.all([
    client
      .from('normalization_shadow_v4')
      .select('source_record_id,candidate_count,change_flags')
      .in('source_record_id', ids),
    client
      .from('duplicate_review_candidates')
      .select('duplicate_id')
      .eq('status', 'SUPPRESSED')
      .in('duplicate_id', ids),
  ]);
  if (shadowResult.error) throw shadowResult.error;
  if (duplicateResult.error) throw duplicateResult.error;
  const bundleIds = new Set((shadowResult.data || [])
    .filter(row => Number(row.candidate_count) > 1
      || normalizedFlags(row.change_flags).includes('BUNDLE_SPLIT_REQUIRED'))
    .map(row => row.source_record_id));
  const duplicateIds = new Set((duplicateResult.data || []).map(row => row.duplicate_id));
  return { bundleIds, duplicateIds };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const limit = Math.max(1, Math.min(Number.parseInt(req.query?.limit || '50', 10) || 50, 100));
  const brand = String(req.query?.brand || '').trim();
  const reference = String(req.query?.reference || '').trim().slice(0, 80);
  const identityStatus = String(req.query?.status || '').trim().toUpperCase();
  const bucket = String(req.query?.bucket || 'release-ready').trim().toLowerCase();
  const after = String(req.query?.after || '').trim();
  if (brand && !ALLOWED_BRANDS.has(brand)) {
    return res.status(400).json({ error: 'Brand must be Rolex or Patek Philippe' });
  }
  if (identityStatus && !['UNVERIFIED', 'CONFLICT'].includes(identityStatus)) {
    return res.status(400).json({ error: 'Status must be UNVERIFIED or CONFLICT' });
  }
  if (!REVIEW_BUCKETS.has(bucket)) {
    return res.status(400).json({ error: 'Only the bounded release-ready identity lane is interactive' });
  }
  if (after && !/^[A-Za-z0-9_-]{1,200}$/.test(after)) {
    return res.status(400).json({ error: 'Invalid review cursor' });
  }

  try {
    const actionable = [];
    let scanCursor = after || null;
    let scanned = 0;
    let exhausted = false;
    while (actionable.length <= limit && scanned < MAX_SCANNED_PER_PAGE && !exhausted) {
      let query = auth.client
        .from('two_brand_identity_review_queue')
        .select(SELECT_FIELDS)
        .order('record_id', { ascending: false })
        .limit(SCAN_SIZE);
      if (scanCursor) query = query.lt('record_id', scanCursor);
      if (brand) query = query.eq('brand', brand);
      if (reference) query = query.eq('reference', reference);
      if (identityStatus) query = query.eq('identity_status', identityStatus);
      const { data, error } = await query;
      if (error) throw error;
      const rows = data || [];
      if (!rows.length) {
        exhausted = true;
        break;
      }
      scanned += rows.length;
      scanCursor = rows.at(-1).record_id;
      const staticCandidates = rows.filter(passesStaticReleaseGates);
      const { bundleIds, duplicateIds } = await loadLedgerBlocks(auth.client, staticCandidates);
      for (const row of staticCandidates) {
        if (bundleIds.has(row.record_id) || duplicateIds.has(row.record_id)) continue;
        actionable.push({
          ...row,
          release_blockers: row.identity_status === 'CONFLICT' ? ['IDENTITY_CONFLICT'] : [],
          review_disposition: 'READY_FOR_IDENTITY_REVIEW',
        });
      }
      exhausted = rows.length < SCAN_SIZE;
    }

    const items = actionable.slice(0, limit);
    let nextCursor = null;
    if (actionable.length > limit && items.length) {
      nextCursor = items.at(-1).record_id;
    } else if (!exhausted && scanCursor) {
      nextCursor = scanCursor;
    }
    return res.status(200).json({
      status: 'ok',
      limit,
      total: null,
      count: items.length,
      scanned,
      hasMore: Boolean(nextCursor),
      nextCursor,
      items,
      scope: ['Rolex', 'Patek Philippe'],
      bucket,
      reviewDisposition: REVIEW_BUCKETS.get(bucket),
      countStatus: 'Global actionable membership is evaluated asynchronously; this endpoint scans at most 1,000 unresolved rows per page.',
      decisionContract: 'A signed reviewer decision changes only listing_identity_reviews. Raw evidence remains immutable.',
    });
  } catch (error) {
    console.error('[identity-review-queue]', error);
    return res.status(500).json({ error: 'Identity review queue is unavailable' });
  }
};

module.exports.ALLOWED_BRANDS = ALLOWED_BRANDS;
module.exports.MAX_SCANNED_PER_PAGE = MAX_SCANNED_PER_PAGE;
module.exports.REVIEW_BUCKETS = REVIEW_BUCKETS;
module.exports.SELECT_FIELDS = SELECT_FIELDS;
module.exports.loadLedgerBlocks = loadLedgerBlocks;
module.exports.passesStaticReleaseGates = passesStaticReleaseGates;

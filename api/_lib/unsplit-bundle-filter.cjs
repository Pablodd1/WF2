'use strict';

const { segmentDealerMessage } = require('./normalization-v4.cjs');

function hasStoredBundleFlag(row) {
  const flags = row?.flags;
  if (Array.isArray(flags)) return flags.includes('BUNDLE_SPLIT_REQUIRED');
  return Boolean(flags && typeof flags === 'object' && flags.BUNDLE_SPLIT_REQUIRED);
}

function deterministicCandidateCount(row) {
  if (hasStoredBundleFlag(row)) return 2;
  return segmentDealerMessage(row?.raw_message || '').length;
}

async function loadShadowBundleParentIds(client, rows) {
  const ids = [...new Set((rows || []).map(row => String(row?.id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Set();
  try {
    const { data, error } = await client.rpc('unsplit_bundle_parent_ids', {
      p_source_record_ids: ids,
    });
    if (error) throw error;
    return new Set((data || []).map(row => String(row.source_record_id || '').trim()).filter(Boolean));
  } catch (error) {
    // The raw-message gate remains active while a preview deployment is still
    // applying the supporting RPC. Never promote on an RPC failure.
    console.warn('[bundle-filter] shadow lookup unavailable:', error.message);
    return new Set();
  }
}

function bundleCandidateCount(row, shadowBundleIds) {
  if (shadowBundleIds?.has(String(row?.id || ''))) return 2;
  return deterministicCandidateCount(row);
}

module.exports = {
  bundleCandidateCount,
  deterministicCandidateCount,
  hasStoredBundleFlag,
  loadShadowBundleParentIds,
};

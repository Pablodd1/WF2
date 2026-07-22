'use strict';

const { analyzeRecord } = require('../shadow-reprocess/shadow-reprocess.cjs');

function likelyBundle(raw) {
  const text = String(raw || '');
  const refs = text.match(/\b\d{3,6}(?:\/[0-9A-Z-]{1,12})?(?:-[0-9A-Z]{1,8})?\b/gi) || [];
  return new Set(refs.map(value => value.toUpperCase())).size >= 3 || text.split(/\r?\n/).filter(Boolean).length >= 8;
}

function auditCandidates(row) {
  if (!likelyBundle(row.raw_message)) return [{ ...row, bundle_parent_id: null, bundle_candidate_index: null }];
  const analyzed = analyzeRecord(row);
  if (analyzed.candidate_count < 2) return [];
  return analyzed.proposed_candidates.map((candidate, index) => ({
    ...row,
    id: `${row.id}#${index + 1}`,
    brand: candidate.brand || row.brand,
    reference: candidate.reference || null,
    dial_color: candidate.dial_color || null,
    condition: candidate.condition || row.condition,
    price_usd: candidate.price_usd || null,
    currency: candidate.currency || null,
    listing_type: candidate.listing_type || row.listing_type,
    raw_message: candidate.raw_line,
    bundle_parent_id: row.id,
    bundle_candidate_index: index + 1,
  }));
}

module.exports = { auditCandidates, likelyBundle };

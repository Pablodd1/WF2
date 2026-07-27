'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');
const {
  confirmCatalogCandidate,
  rawSupportsExactReference,
} = require('./_lib/catalog-confirmation.cjs');
const { sameOrigin, sha256 } = require('./_lib/review-packets.cjs');

const ALLOWED_BRANDS = new Set(['Rolex', 'Patek Philippe']);
const RPC_DECISIONS = {
  APPROVE: 'HUMAN_APPROVED',
  CONFLICT: 'CONFLICT',
};

function text(value, maxLength = 200) {
  const normalized = String(value || '').trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function validateDecisionBody(body) {
  const recordId = text(body?.recordId);
  const decision = String(body?.decision || '').trim().toUpperCase();
  const reason = text(body?.reason, 1000);
  if (!recordId) return { error: 'Valid recordId required' };
  if (!RPC_DECISIONS[decision]) return { error: 'decision must be APPROVE or CONFLICT' };
  if (!reason || reason.length < 12) return { error: 'reason must contain 12 to 1000 characters' };
  if (decision === 'CONFLICT') return { value: { recordId, decision, reason, canonical: {} } };

  const canonical = {
    brand: text(body?.canonical?.brand, 80),
    model: text(body?.canonical?.model, 160),
    reference: text(body?.canonical?.reference, 80),
    dial_color: text(body?.canonical?.dial_color, 80),
  };
  if (Object.values(canonical).some(value => !value)) {
    return { error: 'Approval requires brand, model, reference, and dial color' };
  }
  if (!ALLOWED_BRANDS.has(canonical.brand)) {
    return { error: 'Approval is restricted to Rolex and Patek Philippe' };
  }
  return { value: { recordId, decision, reason, canonical } };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Invalid request origin' });
  const auth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const validation = validateDecisionBody(req.body);
  if (validation.error) return res.status(400).json({ error: validation.error });

  const { recordId, decision, reason, canonical } = validation.value;
  try {
    const { data: queueRow, error: queueError } = await auth.client
      .from('two_brand_identity_review_queue')
      .select('record_id,identity_status,brand,model,reference,dial_color,raw_message,source,source_type,release_blockers,prior_identity_evidence,review_disposition')
      .eq('record_id', recordId)
      .maybeSingle();
    if (queueError) throw queueError;
    if (!queueRow) {
      return res.status(409).json({ error: 'Identity review item changed or is no longer pending; reload the queue' });
    }
    if (queueRow.review_disposition !== 'READY_FOR_IDENTITY_REVIEW') {
      return res.status(409).json({
        error: `This item is routed to ${queueRow.review_disposition || 'another review lane'}; resolve that blocker before identity review`,
      });
    }
    if (!text(queueRow.raw_message, 1_000_000)) {
      return res.status(409).json({ error: 'Immutable raw evidence is missing; this listing cannot be approved' });
    }

    let catalog = null;
    if (decision === 'APPROVE') {
      if (!rawSupportsExactReference(queueRow.raw_message, canonical.reference)) {
        return res.status(409).json({
          error: 'The exact canonical reference is not present in the raw listing; use CONFLICT or correct the proposed reference',
        });
      }
      catalog = confirmCatalogCandidate(canonical);
      if (!catalog.confirmed || catalog.dialConfirmed === false) {
        return res.status(409).json({
          error: catalog.dialReason || catalog.reason || 'Catalog identity could not be confirmed',
        });
      }
    }

    const operatorId = auth.user.email || auth.user.id;
    if (!operatorId) return res.status(403).json({ error: 'Authenticated operator identity required' });
    const evidence = {
      review_surface: 'two_brand_identity_review_queue',
      record_id: recordId,
      raw_message_sha256: sha256(queueRow.raw_message),
      exact_reference_present_in_raw: decision === 'APPROVE'
        ? rawSupportsExactReference(queueRow.raw_message, canonical.reference)
        : null,
      source: queueRow.source || null,
      source_type: queueRow.source_type || null,
      prior_identity_status: queueRow.identity_status,
      prior_identity_evidence: queueRow.prior_identity_evidence || {},
      release_blockers_at_review: queueRow.release_blockers || [],
      review_disposition_at_review: queueRow.review_disposition,
      catalog_confirmation: catalog,
      reviewer_role: auth.role,
    };
    const { data: result, error: rpcError } = await auth.client.rpc('apply_listing_identity_review', {
      p_record_id: recordId,
      p_decision: RPC_DECISIONS[decision],
      p_operator_id: operatorId,
      p_reason: reason,
      p_canonical: canonical,
      p_evidence: evidence,
    });
    if (rpcError) throw rpcError;

    const { data: published, error: publicationError } = await auth.client
      .from('two_brand_verified_trading_release')
      .select('id')
      .eq('id', recordId)
      .maybeSingle();
    if (publicationError) throw publicationError;
    return res.status(200).json({
      status: 'ok',
      result,
      identity_status: RPC_DECISIONS[decision],
      customer_publishable: Boolean(published),
      remaining_release_blockers: published ? [] : queueRow.release_blockers || [],
    });
  } catch (error) {
    console.error('[identity-review-decision]', error);
    return res.status(500).json({ error: 'Identity review decision failed' });
  }
};

module.exports.rawSupportsExactReference = rawSupportsExactReference;
module.exports.validateDecisionBody = validateDecisionBody;

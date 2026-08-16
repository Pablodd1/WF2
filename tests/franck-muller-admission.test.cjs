'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const intake = require('../tools/intake/prepare-franck-muller-admission.cjs');

function source(overrides = {}) {
  return {
    listing_id: 'wf-fm-001', source_message_id: 'message-001', raw_message: 'Franck Muller 8880 WTS $12,000',
    source_posted_at: '2026-08-16T12:00:00Z', seller_source_id: 'seller-001', seller_name_source: 'Seller',
    source_brand_text: 'Franck Muller', intent: 'WTS', category: 'WATCH', source_currency: 'USD',
    normalized_price_usd: 12000, fx_source: 'SOURCE_EXPLICIT_USD', fx_rate_date: '2026-08-16', image_count_source: 1,
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    final_brand: 'Franck Muller', final_model: 'Vanguard', final_reference: 'V45', dial_normalized: 'Black', identity_status: 'VERIFIED',
    bundle_status: 'SINGLE_CANDIDATE', image_status: 'VERIFIED', duplicate_decision: 'COUNT',
    trading_floor_status: 'PUBLISH', price_research_status: 'ELIGIBLE', ...overrides,
  };
}

test('Franck Muller intake accepts only a fully verified single-watch admission', () => {
  const result = intake.classifyRow(source(), decision());
  assert.equal(result.trading_floor_candidate, true);
  assert.equal(result.price_research_candidate, true);
  assert.equal(result.disposition, 'REVIEW_REQUIRED');
});

test('Franck Muller intake holds a publish-marked row whose identity remains under review', () => {
  const result = intake.classifyRow(source(), decision({ identity_status: 'REVIEW_REQUIRED' }));
  assert.equal(result.trading_floor_candidate, false);
  assert.equal(result.disposition, 'HOLD_FOR_REVIEW');
  assert.match(result.reasons.join('|'), /IDENTITY_REVIEW_REQUIRED/);
});

test('Franck Muller intake never treats a currency token as a reference', () => {
  const result = intake.classifyRow(source(), decision({ final_reference: '18500HKD' }));
  assert.equal(result.trading_floor_candidate, false);
  assert.match(result.reasons.join('|'), /REFERENCE_UNRESOLVED_OR_PRICE_TOKEN/);
});

test('Franck Muller intake holds foreign brand rows even if the decision ledger says publish', () => {
  const result = intake.classifyRow(source({ source_brand_text: 'Rolex' }), decision({ final_brand: 'Rolex' }));
  assert.equal(result.trading_floor_candidate, false);
  assert.match(result.reasons.join('|'), /BRAND_SCOPE_MISMATCH/);
});

test('shared admission contract accepts another explicitly selected brand only', () => {
  const tagDecision = decision({ final_brand: 'TAG Heuer', final_model: 'Carrera', final_reference: 'CBL2111' });
  const accepted = intake.classifyRow(source({ source_brand_text: 'TAG Heuer' }), tagDecision, 'TAG Heuer');
  const rejected = intake.classifyRow(source({ source_brand_text: 'TAG Heuer' }), tagDecision, 'Breguet');
  assert.equal(accepted.trading_floor_candidate, true);
  assert.equal(rejected.trading_floor_candidate, false);
  assert.match(rejected.reasons.join('|'), /BRAND_SCOPE_MISMATCH/);
});

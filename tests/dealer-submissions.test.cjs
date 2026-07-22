'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateSubmission } = require('../api/dealer-submissions.js');

test('requires approved watch identity fields and WTS price', () => {
  const invalid = validateSubmission({ intent: 'WTS', category: 'WATCH', raw_message: 'Rolex for sale' });
  assert.match(invalid.error, /brand, model, reference, dial_color, price_amount/);

  const valid = validateSubmission({
    intent: 'WTS', category: 'WATCH', raw_message: 'Rolex Daytona 116500LN white USD 30000',
    brand: 'Rolex', model: 'Daytona', reference: '116500LN', dial_color: 'White',
    price_amount: '30000', currency: 'USD',
  });
  assert.equal(valid.error, undefined);
  assert.equal(valid.claimed.price_amount, 30000);
});

test('allows a WTB watch request without an asking price', () => {
  const valid = validateSubmission({
    intent: 'WTB', category: 'WATCH', raw_message: 'WTB Patek 5712/1A blue',
    brand: 'Patek Philippe', model: 'Nautilus', reference: '5712/1A', dial_color: 'Blue',
  });
  assert.equal(valid.error, undefined);
  assert.equal(valid.claimed.price_amount, null);
});

test('submission migration is service-role only and review-gated', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260721010000_dealer_listing_submissions.sql'), 'utf8');
  assert.match(migration, /REVOKE ALL ON public\.dealer_listing_submissions FROM anon, authenticated/i);
  assert.match(migration, /DEFAULT 'PENDING_REVIEW'/i);
  assert.doesNotMatch(migration, /GRANT INSERT ON public\.dealer_listing_submissions TO authenticated/i);
});

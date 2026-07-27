'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const trading = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'pages', 'TradingFloor.tsx'),
  'utf8',
);
const research = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'pages', 'PriceResearch.tsx'),
  'utf8',
);

test('Trading Floor uses the same safe listing evidence source as Price Research', () => {
  assert.match(trading, /\/api\/price-research-listing\?id=/);
  assert.match(research, /\/api\/price-research-listing\?id=/);
  assert.match(trading, /publicListing\.id !== listing\.id/);
  assert.match(research, /payload\.listing\?\.id !== row\.id/);
  assert.match(trading, /evidence\?\.image_urls/);
  assert.match(trading, /Array\.isArray\(publicListing\.image_urls\)/);
  assert.doesNotMatch(trading, /tradingListing\.image_urls/);
  assert.match(research, /detail\?\.image_urls/);
});

test('both customer details show contact-redacted original evidence and display-safe seller data', () => {
  for (const page of [trading, research]) {
    assert.match(page, /Original listing/);
    assert.match(page, /contact redacted|CONTACT REDACTED/i);
    assert.match(page, /dealer_name/);
    assert.match(page, /dealer_company/);
    assert.match(page, /dealer_profile_url/);
    assert.doesNotMatch(page, /seller_phone/);
  }
});

test('both customer details compare the selected listing with its exact price cohort', () => {
  for (const page of [trading, research]) {
    assert.match(page, /Price when posted/);
    assert.match(page, /dataKey="avg_price"/);
    assert.match(page, /dataKey="selected_price"/);
    assert.match(page, /monthly/);
    assert.match(page, /dial/i);
    assert.match(page, /condition/i);
  }
});

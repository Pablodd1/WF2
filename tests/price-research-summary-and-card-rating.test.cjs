'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api', 'price-research.js'), 'utf8');
const research = fs.readFileSync(path.join(root, 'src', 'pages', 'PriceResearch.tsx'), 'utf8');
const floor = fs.readFileSync(path.join(root, 'src', 'pages', 'TradingFloor.tsx'), 'utf8');

test('compact Price Research summaries retain exact-cohort gates and truthful readiness', () => {
  assert.match(api, /req\.query\.summaryOnly/);
  assert.match(api, /summary_only: true/);
  assert.match(api, /total_tracked_listings: totalTrackedListings/);
  assert.match(api, /wts_eligible_analytics_count: wtsEligibleAnalyticsCount/);
  assert.match(api, /analytics_ready: summary\.analytics_ready/);
  assert.match(api, /stats: summary\.analytics_ready \? summary\.stats : null/);
  assert.match(api, /representative_image_url: representativeImage/);
  assert.match(api, /analytics_dimensions: \['brand', 'reference', 'dial_color'\]/);
});

test('reference tiles use exact Price Research counts and reject cross-reference responses', () => {
  assert.match(research, /summaryOnly: 'true'/);
  assert.match(research, /returnedKey !== requestedKey/);
  assert.match(research, /Exact reference evidence mismatch/);
  assert.match(research, /total_tracked_listings/);
  assert.match(research, /representative_image_url/);
  assert.match(research, /analytics withheld \(minimum 2 qualified\)/);
  assert.match(research, /exact cohort/);
});

test('Trading Floor cards always label price rating separately from dealer rating', () => {
  assert.match(floor, /Price rating: \{cardPriceRatingLabel\}/);
  assert.match(floor, /displayedCardPriceRating\.rating\.code === 'NOT_RATED'/);
  assert.match(floor, /listing\.price_research_eligible === true/);
  assert.match(floor, /summaryOnly: 'true'/);
  assert.match(floor, /comparableReferenceKey\(returnedReference\) !== comparableReferenceKey\(reference\)/);
  assert.match(floor, /rateMarketPrice\(listing\.price_usd, stats, count\)/);
  assert.match(floor, /<ListingDealerEvidence/);
});

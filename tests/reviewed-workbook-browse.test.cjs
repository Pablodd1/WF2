'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  summarizeReviewedWorkbookModels,
  summarizeReviewedWorkbookReferences,
} = require('../api/_lib/reviewed-workbook-browse.cjs');

const rows = [
  { id: '1', model: 'PanoMaticInverse', public_reference: '90-03-64-64-04', dial_color: 'Skeleton', listing_type: 'WTS' },
  { id: '2', model: 'PanoMaticInverse', public_reference: '90-03-64-64-04', dial_color: 'Black', listing_type: 'WTS' },
  { id: '3', model: 'Senator', public_reference: '1-49-13-15-15-04', dial_color: 'Skeleton', listing_type: 'WTS' },
];

test('reviewed workbook brands without a local catalog still expose their real models', () => {
  assert.deepEqual(summarizeReviewedWorkbookModels(rows), [
    { model: 'PanoMaticInverse', reference_count: 1, listing_count: 2 },
    { model: 'Senator', reference_count: 1, listing_count: 1 },
  ]);
});

test('reviewed workbook references keep unverified prices out of analytics', () => {
  const references = summarizeReviewedWorkbookReferences(rows, 'PanoMaticInverse');
  assert.equal(references.length, 1);
  assert.equal(references[0].listing_count, 2);
  assert.equal(references[0].eligible_observation_count, 0);
  assert.equal(references[0].avg_price, null);
  assert.deepEqual(references[0].dial_colors, [
    { dial_color: 'Black', count: 1 },
    { dial_color: 'Skeleton', count: 1 },
  ]);
});

test('Price Research opens a supplied brand and Trading Floor hides internal evidence badges', () => {
  const research = fs.readFileSync(path.join(__dirname, '..', 'src/pages/PriceResearch.tsx'), 'utf8');
  const floor = fs.readFileSync(path.join(__dirname, '..', 'src/pages/TradingFloor.tsx'), 'utf8');
  assert.match(research, /const \[pBrand, setPBrand\] = useState\(initialBrand\)/);
  assert.match(research, /if \(initialBrand && !initialReference\) void loadModels\(initialBrand\)/);
  assert.match(research, /onChange=\{event => void loadModels\(event\.target\.value\)\}/);
  assert.doesNotMatch(floor, /aria-label="Listing evidence"|EvidenceIndicators|Source contact supplied|Source-supplied listing image/);
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('primary navigation uses one Workspace entry and the clean Hire Fi rail', () => {
  const header = read('src/components/MarketHeader.tsx');
  const rail = read('src/components/HireFiScrollRail.tsx');

  assert.match(header, /label: 'WORKSPACE', to: '\/dealer\/workspace'/);
  assert.doesNotMatch(header, /label: 'DEALER LOGIN'|label: 'ACCOUNT'/);
  assert.match(header, /label: 'POST ITEM', to: '\/dealer\/post'/);
  assert.match(rail, /Let Fi search the world/);
  assert.match(rail, /sm:text-base/);
  assert.doesNotMatch(rail, /Instagram|Facebook|Linkedin|Twitter/);
});

test('Trading Floor preserves source text and orders price intelligence before poster details', () => {
  const floor = read('src/pages/TradingFloor.tsx');

  assert.match(floor, /listing\.raw_message \?\? listing\.raw_line \?\? listing\.description/);
  assert.match(floor, />Original raw message</);
  assert.match(floor, /order-2 rounded-md border[\s\S]*>Price Rating</);
  assert.match(floor, /order-3 rounded-md border[\s\S]*>Posted by</);
  assert.match(floor, /listing\.intent \|\| listing\.listing_type/);
  assert.match(floor, /label="Source image only"/);
  assert.match(floor, /label="Price supplied"/);
  assert.match(floor, /Location/);
});

test('Price Research uses dial colors, closed methodology, images, and complete fallback evidence', () => {
  const research = read('src/pages/PriceResearch.tsx');

  assert.doesNotMatch(research, /\['white', 'white dial', 'silver'[\s\S]*return NAVY/);
  assert.match(research, /fill=\{dialChartColor\(dial\.dial_color\)\}/);
  assert.match(research, /dialChartStroke\(dial\.dial_color\)/);
  assert.match(research, /key=\{`methodology-/);
  assert.doesNotMatch(research, /<details open/);
  assert.match(research, /row\.display_image_url/);
  assert.match(research, /Source listing image unavailable/);
  assert.match(research, /const rawSourceMessage = detail\?\.raw_message \?\? summary\.raw_message \?\? summary\.raw_line/);
  assert.match(research, /void fetch\(contactEndpoint[\s\S]*setListingSeller/);
  assert.match(research, /<DetailCard title="Original listing"/);
  assert.match(research, /<DetailCard title="Posted by"/);
});

test('Workspace includes official community access and install guidance without invented group links', () => {
  const portal = read('src/pages/DealerPortal.tsx');
  const groups = read('src/components/JoinGroupsCta.tsx');
  const index = read('index.html');
  const manifest = JSON.parse(read('public/manifest.webmanifest'));

  assert.match(portal, /B2B Watch Trading Chat/);
  assert.match(portal, /Community discussions and announcements/);
  assert.match(portal, /Signed Estate and Branded Jewelry/);
  assert.match(portal, /Rolex US Sales/);
  assert.match(portal, /href=\{GROUPS_URL\}/);
  assert.match(groups, /export const GROUPS_URL = 'https:\/\/watchfacts\.com\//);
  assert.match(portal, /beforeinstallprompt/);
  assert.match(portal, /Add to Home Screen/);
  assert.match(index, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.equal(manifest.display, 'standalone');
});

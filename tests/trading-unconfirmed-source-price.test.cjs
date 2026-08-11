'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260811170000_trading_floor_unconfirmed_source_price.sql'),
  'utf8',
);
const trading = fs.readFileSync(path.join(root, 'src', 'pages', 'TradingFloor.tsx'), 'utf8');

test('forward view labels retained bare-dollar evidence without promoting it to USD', () => {
  assert.match(migration, /currency_evidence = 'bare_dollar_unconfirmed'/);
  assert.match(migration, /THEN '\$' \|\| l\.price_normalized::text/);
  assert.match(migration, /WHEN l\.price_normalized > 0 AND l\.currency_normalized IS NULL[\s\S]*THEN 'CURRENCY_UNCONFIRMED'/);
  assert.match(migration, /WHEN l\.currency_normalized IN \('USD', 'USDT'\) AND l\.price_usd > 0[\s\S]*THEN 'SOURCE_EXPLICIT_USD_MATCH'/);
  assert.match(migration, /WHEN upper\(COALESCE\(l\.verdict, ''\)\) = 'APPROVED'[\s\S]*l\.currency_normalized IN \('USD', 'USDT'\)[\s\S]*THEN l\.price_usd/);
});

test('Trading Floor distinguishes currency-unconfirmed evidence from no supplied price', () => {
  assert.match(trading, /price_evidence_status\)\.toUpperCase\(\) === 'CURRENCY_UNCONFIRMED'/);
  assert.match(trading, /currency \$\{currencyUnconfirmed \? 'not confirmed' : 'not supplied'\}/);
  assert.match(trading, /: 'Price not supplied'/);
});

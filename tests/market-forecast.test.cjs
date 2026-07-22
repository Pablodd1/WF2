'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildThreeMonthForecast } = require('../api/_lib/market-forecast.cjs');

const monthly = [
  { month: '2026-01', min_price: 90, avg_price: 100, max_price: 110 },
  { month: '2026-02', min_price: 100, avg_price: 110, max_price: 120 },
  { month: '2026-03', min_price: 110, avg_price: 120, max_price: 130 },
];

test('does not forecast the all-conditions view', () => {
  const forecast = buildThreeMonthForecast(monthly, { enabled: false, observationCount: 10 });
  assert.equal(forecast.available, false);
  assert.equal(forecast.points.length, 0);
});

test('builds three clearly projected months for a selected condition', () => {
  const forecast = buildThreeMonthForecast(monthly, { enabled: true, observationCount: 5 });
  assert.equal(forecast.available, true);
  assert.deepEqual(forecast.points.map(point => point.month), ['2026-04', '2026-05', '2026-06']);
  assert.ok(forecast.points.every(point => point.projected));
  assert.ok(forecast.points.every(point => point.min_price <= point.avg_price && point.avg_price <= point.max_price));
});

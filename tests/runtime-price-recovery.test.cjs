'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { explicitObservation, recoverObservation, recoverRecordPrices } = require('../api/_lib/runtime-price-recovery.cjs');

test('recovers only explicit currency evidence and never promotes a bare dollar token', async () => {
  assert.equal(explicitObservation('RM11 complete set $150,000'), null);
  const rows = await recoverRecordPrices([
    { id: 'usd', raw_message: 'RM11-01 153000 USDT', price_usd: null },
    { id: 'bare', raw_message: 'RM11 complete set $150,000', price_usd: null },
  ]);
  assert.equal(rows[0].price_usd, 153000);
  assert.equal(rows[0].source_currency, 'USDT');
  assert.equal(rows[1].price_usd, null);
});

test('converts explicit non-USD evidence only with a dated named snapshot', () => {
  const observation = explicitObservation('RM11-01 1.187M HKD');
  assert.equal(recoverObservation(observation, null), null);
  const recovered = recoverObservation(observation, {
    observed_at: '2026-08-13T00:00:00Z',
    source: 'European Central Bank reference rates',
    usd_per_unit: { HKD: 0.128 },
  });
  assert.equal(recovered.price_usd, 151936);
  assert.equal(recovered.source_currency, 'HKD');
  assert.equal(recovered.fx_date, '2026-08-13T00:00:00Z');
});

test('leaves existing verified prices unchanged', async () => {
  const [row] = await recoverRecordPrices([{ raw_message: 'RM11 200000 USDT', price_usd: 190000 }]);
  assert.equal(row.price_usd, 190000);
  assert.equal(row.runtime_price_recovery_applied, undefined);
});

test('never reintroduces a reference token that an earlier safety gate rejected as price', async () => {
  const [row] = await recoverRecordPrices([{
    id: 'rm-reference-token',
    raw_message: 'NTQ/ RM 001',
    price_usd: null,
    price_raw: null,
    currency: null,
    source_price_amount: null,
    source_currency: null,
    price_evidence_status: 'REFERENCE_TOKEN_AS_PRICE',
  }], {
    snapshot: {
      observed_at: '2026-08-13T00:00:00Z',
      source: 'European Central Bank reference rates',
      usd_per_unit: { MYR: 0.24 },
    },
  });

  assert.equal(row.price_usd, null);
  assert.equal(row.price_raw, null);
  assert.equal(row.currency, null);
  assert.equal(row.source_price_amount, null);
  assert.equal(row.source_currency, null);
  assert.equal(row.runtime_price_recovery_applied, undefined);
});

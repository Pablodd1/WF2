'use strict';

const { Readable } = require('node:stream');
const csv = require('csv-parser');

const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'HKD', 'GBP', 'CHF', 'CNY', 'JPY', 'SGD'];

async function parseEcbRates(csvText) {
  const latest = new Map();
  await new Promise((resolve, reject) => {
    Readable.from([csvText])
      .pipe(csv())
      .on('data', row => {
        const currency = String(row.CURRENCY || '').toUpperCase();
        const value = Number(row.OBS_VALUE);
        const date = String(row.TIME_PERIOD || '');
        if (!SUPPORTED_CURRENCIES.includes(currency) || !Number.isFinite(value) || value <= 0 || !date) return;
        if (!latest.has(currency) || date > latest.get(currency).date) latest.set(currency, { date, value });
      })
      .on('end', resolve)
      .on('error', reject);
  });

  const usdPerEur = latest.get('USD');
  if (!usdPerEur) throw new Error('ECB response did not include USD');
  const rates = { USD: 1, EUR: 1 / usdPerEur.value };
  for (const currency of SUPPORTED_CURRENCIES) {
    if (currency === 'USD' || currency === 'EUR') continue;
    const quote = latest.get(currency);
    if (quote) rates[currency] = quote.value / usdPerEur.value;
  }
  const observedAt = [...latest.values()].map(item => item.date).sort().at(-1) || usdPerEur.date;
  return { observedAt, rates };
}

function convertCurrency(amount, from, to, rates) {
  const numeric = Number(amount);
  const fromRate = Number(rates?.[from]);
  const toRate = Number(rates?.[to]);
  if (!Number.isFinite(numeric) || !Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0 || toRate <= 0) return null;
  return (numeric / fromRate) * toRate;
}

module.exports = { SUPPORTED_CURRENCIES, convertCurrency, parseEcbRates };

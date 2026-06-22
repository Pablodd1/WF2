/**
 * PRICE RESEARCH API — /api/price-research
 * 
 * Per-reference market intelligence from live WatchFacts production DB.
 * Query: GET /api/price-research?reference=52506&dial=Ice%20Blue&months=6
 */

import { execSync } from 'child_process';

const MYSQL_HOST = '161.35.0.209';
const MYSQL_PORT = '3306';
const MYSQL_USER = 'john';
const MYSQL_PASS = 'U0aeAr1zFt2\\';

function mysql(query, timeout = 15000) {
  const env = { ...process.env, MYSQL_PWD: MYSQL_PASS };
  const esc = query.replace(/'/g, "'\\''");
  const cmd = `mysql -h ${MYSQL_HOST} -P ${MYSQL_PORT} -u ${MYSQL_USER} --connect-timeout=5 --quick --batch -e '${esc}'`;
  const result = execSync(cmd, { timeout, maxBuffer: 50 * 1024 * 1024, encoding: 'utf-8', env });
  return result;
}

function parseTSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split('\t');
  const rows = lines.slice(1).map(line => {
    const cols = line.split('\t');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cols[i] || null; });
    return obj;
  });
  return { headers, rows };
}

const FX = { HKD: 7.8, USD: 1, USDT: 1, EUR: 0.92, GBP: 0.79, CHF: 0.89, SGD: 1.35, JPY: 150, AED: 3.67 };

function toUSD(amount, currency) {
  if (!amount || !currency) return null;
  const rate = FX[currency.toUpperCase()] || 1;
  return Math.round(parseFloat(amount) / rate);
}

function extractPrice(text) {
  if (!text) return null;
  const patterns = [
    { re: /(?:HKD|HK\$|hkd)\s*([\d.,]+)\s*([kKmM])?/i, cur: 'HKD' },
    { re: /\$\s*([\d.,]+)\s*([kKmM])?/i, cur: 'USD' },
    { re: /([\d.,]+)\s*(?:USDT|usdt)\b/i, cur: 'USDT' },
    { re: /([\d.,]+)\s*(?:EUR|eur|€)/i, cur: 'EUR' },
    { re: /([\d.,]+)\s*(?:GBP|gbp|£)/i, cur: 'GBP' },
    { re: /([\d.,]+)\s*(?:AED|aed)/i, cur: 'AED' },
  ];
  for (const { re, cur } of patterns) {
    const m = text.match(re);
    if (m) {
      let val = parseFloat(m[1].replace(/,/g, ''));
      const suf = (m[2] || '').toLowerCase();
      if (suf === 'm') val *= 1_000_000;
      else if (suf === 'k') val *= 1_000;
      return { price: Math.round(val), currency: cur, priceUSD: toUSD(Math.round(val), cur) };
    }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const reference = url.searchParams.get('reference');
  const dial = url.searchParams.get('dial') || null;
  const months = parseInt(url.searchParams.get('months') || '6', 10);

  if (!reference) {
    return res.status(400).json({ error: 'reference parameter required' });
  }

  try {
    // 1) Reference info from catalog
    let brand = 'Unknown', model = 'Unknown';
    try {
      const r = parseTSV(mysql(
        `SELECT b.value as brand, m.value as model FROM thecollective_catalogs.references r JOIN thecollective_catalogs.models m ON r.model_id=m.id JOIN thecollective_catalogs.brands b ON m.brand_id=b.id WHERE r.value='${reference}' LIMIT 1`
      ));
      if (r.rows[0]) { brand = r.rows[0].brand; model = r.rows[0].model; }
    } catch {}

    // 2) Dial colors
    let dialColors = [], primaryDial = null;
    try {
      const d = parseTSV(mysql(
        `SELECT valid_colors, primary_color FROM thecollective_inventory.reference_color_catalog WHERE normalized_reference='${reference}' LIMIT 1`
      ));
      if (d.rows[0]) {
        try { dialColors = JSON.parse(d.rows[0].valid_colors || '[]'); } catch {}
        primaryDial = d.rows[0].primary_color;
      }
    } catch {}

    // 3) FS count
    let fsCount = 0;
    try {
      const f = parseTSV(mysql(
        `SELECT COUNT(*) as cnt FROM thecollective_inventory.auction_watches WHERE normalized_reference='${reference}'`
      ));
      fsCount = parseInt(f.rows[0]?.cnt || '0', 10);
    } catch {}

    // 4) Market indicators
    let marketData = {};
    try {
      const m = parseTSV(mysql(
        `SELECT * FROM thecollective_inventory.market_reference_indicators_current WHERE normalized_reference='${reference}' LIMIT 1`
      ));
      if (m.rows[0]) marketData = m.rows[0];
    } catch {}

    // 5) Listings
    let listingsRaw = [];
    try {
      const lr = parseTSV(mysql(
        `SELECT title, dial_color, year, front_image, created_at FROM thecollective_inventory.auction_watches WHERE normalized_reference='${reference}' LIMIT 200`
      ));
      listingsRaw = lr.rows;
    } catch {}

    // 6) Process listings
    const listings = listingsRaw.map(row => {
      const p = extractPrice(row.title);
      return {
        title: row.title,
        dial: row.dial_color,
        year: row.year,
        imageUrl: row.front_image,
        price: p?.price || null,
        currency: p?.currency || null,
        priceUSD: p?.priceUSD || null,
        date: row.created_at,
      };
    }).filter(l => l.priceUSD && l.priceUSD > 100 && l.priceUSD < 5000000);

    // 7) Statistics
    const prices = listings.map(l => l.priceUSD).sort((a, b) => a - b);
    const q1 = prices[Math.floor(prices.length * 0.25)] || prices[0];
    const q3 = prices[Math.floor(prices.length * 0.75)] || prices[prices.length - 1];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    const filtered = prices.filter(p => p >= lowerBound && p <= upperBound);

    // Dedup
    const seen = new Set();
    const uniqueListings = listings.filter(l => {
      const key = `${l.priceUSD}_${(l.title || '').slice(0, 40)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Monthly chart buckets
    const monthlyBuckets = {};
    for (const l of uniqueListings) {
      if (!l.date) continue;
      const month = l.date.slice(0, 7);
      if (!monthlyBuckets[month]) monthlyBuckets[month] = [];
      monthlyBuckets[month].push(l.priceUSD);
    }
    const chartData = Object.entries(monthlyBuckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, vals]) => ({
        month,
        min: Math.min(...vals),
        avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
        max: Math.max(...vals),
        count: vals.length,
      }));

    const currentStats = filtered.length > 0 ? {
      min: filtered[0],
      avg: Math.round(filtered.reduce((a, b) => a + b, 0) / filtered.length),
      max: filtered[filtered.length - 1],
      count: filtered.length,
    } : null;

    const priceDriftPct = marketData.price_drift_pct
      ? parseFloat(marketData.price_drift_pct)
      : (chartData.length >= 2
        ? parseFloat((((chartData[chartData.length - 1].avg - chartData[0].avg) / chartData[0].avg) * 100).toFixed(2))
        : null);

    return res.status(200).json({
      success: true,
      reference,
      brand,
      model,
      dialColors,
      primaryDial,
      liquidity: { fsCount },
      pricing: {
        current: currentStats,
        drift: priceDriftPct,
        min: marketData.min_fs_price_recent ? parseInt(marketData.min_fs_price_recent) : null,
        avg: marketData.avg_fs_price_recent ? parseInt(marketData.avg_fs_price_recent) : null,
        max: marketData.max_fs_price_recent ? parseInt(marketData.max_fs_price_recent) : null,
      },
      chart: chartData,
      listings: uniqueListings.slice(0, 50),
      totalListings: uniqueListings.length,
      outliers: listings.length - uniqueListings.length + (prices.length - filtered.length),
      duplicates: listings.length - uniqueListings.length,
    });
  } catch (e) {
    console.error('[price-research]', e.message);
    return res.status(500).json({ error: e.message });
  }
}

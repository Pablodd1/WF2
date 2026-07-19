/**
 * BATCH IMPORT API — /api/batch-import
 * MySQL → Supabase direct import using mysql2 Node.js driver
 * No shell commands, no password escaping issues.
 */
const { createClient } = require('@supabase/supabase-js');
const { requireServiceToken } = require('./_lib/require-service-token.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!requireServiceToken(req, res)) return;

  const limit = Math.min(500, Math.max(1, Number.parseInt(String(req.body?.limit || 100), 10) || 100));
  const table = String(req.body?.table || 'wts').toLowerCase();
  const offset = Math.max(0, Number.parseInt(String(req.body?.offset || 0), 10) || 0);
  if (!['wts', 'wtb'].includes(table)) return res.status(400).json({ error: 'table must be wts or wtb' });

  try {
    const legacyDb = {
      host: process.env.LEGACY_DB_HOST,
      port: Number(process.env.LEGACY_DB_PORT || 3306),
      user: process.env.LEGACY_DB_USER,
      password: process.env.LEGACY_DB_PASSWORD,
      database: process.env.LEGACY_DB_NAME,
    };
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

    if (Object.values(legacyDb).some((value) => value === undefined || value === '')) {
      return res.status(503).json({ error: 'Legacy database migration is not configured' });
    }
    if (!process.env.SUPABASE_URL || !supabaseKey) {
      return res.status(503).json({ error: 'Supabase server configuration is missing' });
    }

    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection({
      ...legacyDb,
      connectTimeout: 30000,
    });

    let rows;
    if (table === 'wts') {
      [rows] = await conn.execute(
        `SELECT title, brand, reference, price, dial_color, condition_id, created_on, from_number, from_name, region
         FROM auctions
         WHERE brand IS NOT NULL AND brand != '' 
         AND reference IS NOT NULL AND reference != '' 
         AND price > 0
         AND title NOT LIKE '%WTB%' AND title NOT LIKE '%WANT TO BUY%'
         ORDER BY created_on DESC LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    } else {
      [rows] = await conn.execute(
        `SELECT title, brand, reference, price, dial_color, condition_id, created_on, from_number, from_name, region
         FROM auctions
         WHERE title IS NOT NULL 
         AND (title LIKE '%WTB%' OR title LIKE '%WANT TO BUY%' OR title LIKE '%LOOKING FOR%')
         ORDER BY created_on DESC LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    }
    await conn.end();

    if (!rows || rows.length === 0) {
      return res.status(200).json({ success: true, fetched: 0, inserted: 0, table, note: 'empty' });
    }

    // Insert into Supabase
    const supabase = createClient(
      process.env.SUPABASE_URL,
      supabaseKey,
      { auth: { persistSession: false } }
    );

    const condMap = { '1': 'New', '2': 'Like New', '3': 'Excellent', '4': 'Good', '5': 'Unworn', '6': 'Used' };
    let inserted = 0, errors = 0;
    let batch = [];

    for (const r of rows) {
      let curr = 'USD';
      const t = (r.title || '').toUpperCase();
      if (/💰/.test(t) || /\bHKD\b|HK\$/.test(t)) curr = 'HKD';
      else if (/\bUSDT\b/.test(t)) curr = 'USDT';
      else if (/\bEUR\b|€/.test(t)) curr = 'EUR';
      else if (/\bGBP\b|£/.test(t)) curr = 'GBP';
      else if (/\bAED\b/.test(t)) curr = 'AED';

      const rate = { HKD: 0.128, USDT: 1.0, EUR: 1.08, GBP: 1.27, AED: 0.272, USD: 1.0 }[curr] || 1.0;
      const price = parseFloat(r.price) || 0;

      batch.push({
        brand: (r.brand || 'Unknown').trim(),
        reference: (r.reference || null),
        price_raw: price || null,
        price_usd: Math.round(price * rate),
        currency: curr,
        dial_color: r.dial_color || null,
        condition: condMap[r.condition_id] || '',
        year: r.created_on ? new Date(r.created_on).getFullYear() : null,
        raw_message: (r.title || '').trim(),
        source: 'mysql_auctions',
        verdict: table === 'wts' ? 'APPROVED' : 'HUMAN',
        confidence: table === 'wts' ? 95 : 80,
        listing_type: table === 'wtb' ? 'WTB' : 'WTS',
        created_at: r.created_on || new Date().toISOString(),
      });

      if (batch.length >= 100) {
        const { error } = await supabase.from('watch_records').upsert(batch, { onConflict: 'id', ignoreDuplicates: true });
        if (error) { errors += batch.length; } else { inserted += batch.length; }
        batch = [];
      }
    }

    if (batch.length > 0) {
      const { error } = await supabase.from('watch_records').upsert(batch, { onConflict: 'id', ignoreDuplicates: true });
      if (error) errors += batch.length;
      else inserted += batch.length;
    }

    res.status(200).json({ success: true, fetched: rows.length, inserted, errors, table, offset });
  } catch (e) {
    res.status(500).json({ error: e.message.substring(0, 400) });
  }
};

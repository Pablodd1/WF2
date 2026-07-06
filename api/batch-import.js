/**
 * BATCH IMPORT API — /api/batch-import
 * Direct MySQL → Supabase import
 */
const { writeFileSync, unlinkSync } = require('fs');
const { execSync } = require('child_process');
const os = require('os');
const path = require('path');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const limit = Math.min(req.body?.limit || 100, 500);
  const table = req.body?.table || 'wts';
  const offset = req.body?.offset || 0;
  let cnfFile = null;

  try {
    cnfFile = path.join(os.tmpdir(), `.mycnf_${Date.now()}`);
    writeFileSync(cnfFile, '[client]\nhost=161.35.0.209\nport=3306\nuser=john\npassword="U0aeAr1zFt2\'"\n');

    // Use single quotes in SQL to avoid shell escaping nightmares
    const sqlFile = path.join(os.tmpdir(), `.sql_${Date.now()}`);
    
    if (table === 'wts') {
      writeFileSync(sqlFile, `SELECT title, brand, reference, price, dial_color, condition_id, created_on, from_number, from_name, region FROM auctions WHERE brand IS NOT NULL AND brand != '' AND reference IS NOT NULL AND reference != '' AND price > 0 AND title NOT LIKE '%WTB%' AND title NOT LIKE '%WANT TO BUY%' ORDER BY created_on DESC LIMIT ${limit} OFFSET ${offset};`);
    } else {
      writeFileSync(sqlFile, `SELECT title, brand, reference, price, dial_color, condition_id, created_on, from_number, from_name, region FROM auctions WHERE title IS NOT NULL AND (title LIKE '%WTB%' OR title LIKE '%WANT TO BUY%' OR title LIKE '%LOOKING FOR%') ORDER BY created_on DESC LIMIT ${limit} OFFSET ${offset};`);
    }

    const output = execSync(
      `mysql --defaults-extra-file=${cnfFile} -B --quick -D thecollective_inventory < ${sqlFile} 2>/dev/null`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, timeout: 300000 }
    );
    unlinkSync(sqlFile);

    const lines = output.trim().split('\n');
    if (lines.length < 2) {
      return res.status(200).json({ success: true, fetched: 0, inserted: 0, table });
    }

    const headers = lines[0].split('\t');
    const rows = lines.slice(1).map(l => {
      const cols = l.split('\t');
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (cols[i] || '').trim(); });
      return obj;
    });

    // Now insert into Supabase via the existing client
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    const condMap = { '1': 'New', '2': 'Like New', '3': 'Excellent', '4': 'Good', '5': 'Unworn', '6': 'Used' };
    let inserted = 0, errors = 0;
    let batch = [];

    for (const r of rows) {
      let curr = 'USD';
      const t = (r.title || '').toUpperCase();
      if (t.includes('\u{1F4B0}') || /\bHKD\b|HK\$/.test(t)) curr = 'HKD';
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
        year: (r.created_on || '').substring(0, 4) || null,
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

    if (cnfFile) try { unlinkSync(cnfFile); } catch {}

    res.status(200).json({ success: true, fetched: rows.length, inserted, errors, table, offset });
  } catch (e) {
    if (cnfFile) try { unlinkSync(cnfFile); } catch {}
    res.status(500).json({ error: e.message.substring(0, 500) });
  }
};

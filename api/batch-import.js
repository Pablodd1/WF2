/**
 * BATCH IMPORT API — /api/batch-import
 * Direct MySQL → Supabase import endpoint
 * Uses temp .my.cnf file to handle password with special chars
 */
const { getClient } = require('./_lib/supabase');
const { execSync } = require('child_process');
const { writeFileSync, unlinkSync } = require('fs');
const os = require('os');
const path = require('path');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const limit = req.body?.limit || 100;
  const table = req.body?.table || 'wts';
  const offset = req.body?.offset || 0;
  let cnfFile = null;

  try {
    // Write .my.cnf with password
    cnfFile = path.join(os.tmpdir(), `.mycnf_import_${Date.now()}`);
    writeFileSync(cnfFile, '[client]\nhost=161.35.0.209\nport=3306\nuser=john\npassword="U0aeAr1zFt2\'"\n');

    const whereClause = table === 'wts'
      ? `WHERE brand IS NOT NULL AND brand != "" AND reference IS NOT NULL AND reference != "" AND price > 0 AND title NOT LIKE "%WTB%" AND title NOT LIKE "%WANT TO BUY%"`
      : `WHERE title IS NOT NULL AND (title LIKE "%WTB%" OR title LIKE "%WANT TO BUY%" OR title LIKE "%LOOKING FOR%")`;

    const sql = `SELECT title, brand, reference, price, dial_color, condition_id, created_on, from_number, from_name, region FROM auctions ${whereClause} ORDER BY created_on DESC LIMIT ${limit} OFFSET ${offset}`;

    const output = execSync(
      `mysql --defaults-extra-file=${cnfFile} -B --quick -D thecollective_inventory -e "${sql.replace(/"/g, '\\"')}" 2>/dev/null`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, timeout: 300000 }
    );

    // Parse TSV
    const lines = output.trim().split('\n');
    if (lines.length < 2) {
      return res.status(200).json({ success: true, fetched: 0, inserted: 0, errors: 0, table, note: 'no rows returned' });
    }
    const headers = lines[0].split('\t');
    const rows = lines.slice(1).map(l => {
      const cols = l.split('\t');
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (cols[i] || '').trim(); });
      return obj;
    });

    const condMap = { '1': 'New', '2': 'Like New', '3': 'Excellent', '4': 'Good', '5': 'Unworn', '6': 'Used' };
    const client = getClient();
    let inserted = 0, errors = 0;
    let batch = [];

    for (const r of rows) {
      let curr = 'USD';
      const t = (r.title || '').toUpperCase();
      if (t.includes('💰') || /\bHKD\b|HK\$/.test(t)) curr = 'HKD';
      else if (/\bUSDT\b/.test(t)) curr = 'USDT';
      else if (/\bEUR\b|€/.test(t)) curr = 'EUR';
      else if (/\bGBP\b|£/.test(t)) curr = 'GBP';
      else if (/\bAED\b/.test(t)) curr = 'AED';

      const rate = { HKD: 0.128, USDT: 1.0, EUR: 1.08, GBP: 1.27, AED: 0.272, USD: 1.0 }[curr] || 1.0;
      const price = parseFloat(r.price) || 0;
      const priceUSD = Math.round(price * rate);

      batch.push({
        brand: (r.brand || 'Unknown').trim(),
        reference: (r.reference || null),
        price_raw: price || null,
        price_usd: priceUSD,
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
        const { error } = await client.from('watch_records').upsert(batch, { onConflict: 'id', ignoreDuplicates: true });
        if (error) { errors += batch.length; } else { inserted += batch.length; }
        batch = [];
      }
    }

    if (batch.length > 0) {
      const { error } = await client.from('watch_records').upsert(batch, { onConflict: 'id', ignoreDuplicates: true });
      if (error) errors += batch.length;
      else inserted += batch.length;
    }

    if (cnfFile) unlinkSync(cnfFile);

    res.status(200).json({ success: true, fetched: rows.length, inserted, errors, table, offset });
  } catch (e) {
    if (cnfFile) try { unlinkSync(cnfFile); } catch {}
    res.status(500).json({ error: e.message });
  }
};

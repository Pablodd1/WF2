#!/usr/bin/env node
/**
 * MySQL → Supabase Batch Import
 * 
 * Shell-based extraction (mysql CLI), Node.js processing + Supabase insert.
 * 
 * Usage:
 *   node scripts/import-mysql-auctions.cjs --dry-run --limit 100
 *   node scripts/import-mysql-auctions.cjs --limit 5000
 *   node scripts/import-mysql-auctions.cjs --all  # 594K records
 */
const { execSync } = require('child_process');
const { writeFileSync, unlinkSync } = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = 50;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 5000;
const offsetIdx = args.indexOf('--offset');
const OFFSET = offsetIdx >= 0 ? parseInt(args[offsetIdx + 1], 10) : 0;

// ── MySQL CLI wrapper ──
function mysqlFetch(sql) {
  const tmpFile = `/tmp/wf_import_${Date.now()}.tsv`;
  try {
    const cmd = `mysql -h 161.35.0.209 -P 3306 -u john -p'U0aeAr1zFt2\\'' -B -D thecollective_inventory --quick --batch -e "${sql.replace(/"/g, '\\"')}" 2>/dev/null > ${tmpFile}`;
    execSync(cmd, { timeout: 300000 });
    const content = require('fs').readFileSync(tmpFile, 'utf-8');
    unlinkSync(tmpFile);
    return content.trim();
  } catch (e) {
    try { unlinkSync(tmpFile); } catch {}
    console.error('MySQL fetch failed:', e.message.substring(0, 200));
    return null;
  }
}

function parseTSV(text) {
  const lines = text.split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const cols = line.split('\t');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cols[i] || ''; });
    return obj;
  });
}

// ── Main ──
async function main() {
  console.log('='.repeat(60));
  console.log('MySQL → Supabase Batch Import');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | Limit: ${LIMIT.toLocaleString()} | Offset: ${OFFSET}`);
  if (!DRY_RUN && !SUPABASE_KEY) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY required for live mode. Use --dry-run.');
    process.exit(1);
  }

  // Count
  console.log('\nCounting eligible records...');
  const countText = mysqlFetch("SELECT COUNT(*) as total FROM auctions WHERE brand IS NOT NULL AND brand != '' AND reference IS NOT NULL AND reference != '' AND price > 0 AND title IS NOT NULL AND title != ''");
  const countRows = parseTSV(countText || '');
  const total = parseInt((countRows[0] || {}).total || 0);
  console.log(`Eligible: ${total.toLocaleString()} records`);

  // Fetch
  console.log(`Fetching ${LIMIT.toLocaleString()} records...`);
  const sql = `SELECT id, title, brand, reference, normalized_reference, dial_color, condition_id, price, year, box, papers, status, created_on, from_number, from_name, region FROM auctions WHERE brand IS NOT NULL AND brand != '' AND reference IS NOT NULL AND reference != '' AND price > 0 AND title IS NOT NULL AND title != '' ORDER BY created_on DESC LIMIT ${LIMIT} OFFSET ${OFFSET}`;
  const dataText = mysqlFetch(sql);
  if (!dataText) { console.error('No data'); process.exit(1); }

  const rows = parseTSV(dataText);
  console.log(`Fetched: ${rows.length.toLocaleString()} records`);

  const condMap = { '1': 'New', '2': 'Like New', '3': 'Excellent', '4': 'Good', '5': 'Unworn', '6': 'Used' };
  let inserted = 0, skipped = 0, errors = 0;
  let batch = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const title = r.title || '';

    let currency = 'USD';
    const t = title.toUpperCase();
    if (/💰/.test(t)) currency = 'HKD';
    else if (/\bHKD\b|HK\$/.test(t)) currency = 'HKD';
    else if (/\bUSDT\b/.test(t)) currency = 'USDT';
    else if (/\bEUR\b|€/.test(t)) currency = 'EUR';
    else if (/\bGBP\b|£/.test(t)) currency = 'GBP';
    else if (/\bAED\b/.test(t)) currency = 'AED';
    else if (/\bCHF\b/.test(t)) currency = 'CHF';

    const rate = { HKD: 0.128, USDT: 1.0, EUR: 1.08, GBP: 1.27, AED: 0.272, CHF: 1.13, USD: 1.0 }[currency] || 1.0;
    const price = parseFloat(r.price) || 0;
    const priceUSD = Math.round(price * rate);
    const condition = condMap[r.condition_id] || 'Used';
    const year = r.year ? String(r.year).substring(0, 4) : (r.created_on || '').substring(0, 4);
    const brand = r.brand || 'Unknown';
    const ref = r.normalized_reference || r.reference || '';

    let score = 25;
    if (ref) score += 25;
    if (price > 0) score += 20;
    if (r.dial_color) score += 10;
    if (condition) score += 8;
    if (year) score += 7;
    if (currency) score += 5;
    const verdict = score >= 90 ? 'APPROVED' : 'HUMAN';

    const record = {
      brand, reference: ref || null, price_raw: price || null, price_usd: priceUSD || null,
      currency, dial_color: r.dial_color || null, condition, year: year || null,
      box: r.box || null, papers: r.papers || null,
      raw_message: title, source: 'mysql_auctions', listing_type: 'WTS', verdict,
      is_multi: false, llm_used: false, jass_version: 'v4.0-import',
      confidence: score, received_at: r.created_on || new Date().toISOString(),
      channel_id: `mysql_${r.from_number || r.id || 'unknown'}`,
    };

    if (DRY_RUN) {
      if (i < 5) console.log(`  ${brand} ${ref} $${priceUSD.toLocaleString()} score=${score} ${verdict}`);
      inserted++;
    } else {
      batch.push(record);
      if (batch.length >= BATCH_SIZE || i === rows.length - 1) {
        const result = await upsertBatch(batch);
        inserted += result.inserted;
        errors += result.errors;
        console.log(`  Batch ${Math.floor(i/BATCH_SIZE)+1}: +${result.inserted} · ${errors} err`);
        batch = [];
        await sleep(200); // rate limit buffer
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Done: ${inserted.toLocaleString()} inserted, ${errors} errors`);
  console.log(`Remaining: ${(total - OFFSET - rows.length).toLocaleString()}`);
}

async function upsertBatch(batch) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/watch_records`, {
      method: 'POST', headers: {
        'Content-Type': 'application/json', 'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      }, body: JSON.stringify(batch),
    });
    if (resp.ok) return { inserted: batch.length, errors: 0 };
    const err = await resp.text();
    console.error(`  Supabase: ${err.substring(0, 150)}`);
    return { inserted: 0, errors: batch.length };
  } catch (e) {
    console.error(`  Network: ${e.message}`);
    return { inserted: 0, errors: batch.length };
  }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error(e.message); process.exit(1); });

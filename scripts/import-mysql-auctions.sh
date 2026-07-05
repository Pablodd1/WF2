#!/bin/bash
# MySQL → Supabase Batch Import
# Usage: bash scripts/import-mysql-auctions.sh [limit] [--live]
set -e

LIMIT="${1:-100}"
LIVE="${2:-}"

CNF="/tmp/.mycf_import_$$"
SQLF="/tmp/.sql_import_$$"
TSVF="/tmp/wf_import_$$.tsv"

cat > "$CNF" << 'ENDCNF'
[client]
host=161.35.0.209
port=3306
user=john
password="U0aeAr1zFt2'"
ENDCNF

echo "=== MySQL → Supabase Batch Import ==="
echo "Limit: $LIMIT | Mode: ${LIVE:+LIVE}${LIVE:-DRY RUN}"

# Count
TOTAL=$(mysql --defaults-extra-file="$CNF" -B -N -e "SELECT COUNT(*) FROM thecollective_inventory.auctions WHERE brand IS NOT NULL AND brand != '' AND reference IS NOT NULL AND reference != '' AND price > 0 AND title IS NOT NULL AND title != ''" 2>/dev/null)
echo "Eligible: ${TOTAL:-0} records"

# SQL file
cat > "$SQLF" << EOF
SELECT title, brand, reference, normalized_reference, dial_color, condition_id, price, box, papers, created_on, from_number, from_name, region
FROM thecollective_inventory.auctions
WHERE brand IS NOT NULL AND brand != ''
AND reference IS NOT NULL AND reference != ''
AND price > 0
AND title IS NOT NULL AND title != ''
ORDER BY created_on DESC
LIMIT ${LIMIT};
EOF

mysql --defaults-extra-file="$CNF" -B --quick < "$SQLF" 2>/dev/null > "$TSVF"
COUNT=$(tail -n +2 "$TSVF" | wc -l)
echo "Extracted: $COUNT records"

echo ""
echo "First 3:"
head -4 "$TSVF" | column -t -s $'\t'

if [ "$LIVE" = "--live" ]; then
  echo ""
  echo "=== Inserting $COUNT records into Supabase ==="
  
  export TMPFILE="$TSVF"
  node -e "
    const fs = require('fs');
    const lines = fs.readFileSync(process.env.TMPFILE, 'utf8').trim().split('\n');
    const headers = lines[0].split('\t');
    const rows = lines.slice(1).map(l => {
      const cols = l.split('\t');
      const obj = {}; headers.forEach((h,i) => obj[h] = (cols[i]||'').trim()); return obj;
    });
    
    const condMap = {'1':'New','2':'Like New','3':'Excellent','4':'Good','5':'Unworn','6':'Used'};
    const SUPABASE = process.env.SUPABASE_URL || 'https://bptrvfncppbjnchsaxtb.supabase.co';
    const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY not set'); process.exit(1); }
    
    async function main() {
      let batch = []; let inserted = 0, errors = 0;
      
      for (const r of rows) {
        let curr = 'USD';
        const t = (r.title||'').toUpperCase();
        if (/\\u{1F4B0}/u.test(t)) curr = 'HKD';
        else if (/\\bHKD\\b|HK\\\$/.test(t)) curr = 'HKD';
        else if (/\\bUSDT\\b/.test(t)) curr = 'USDT';
        else if (/\\bEUR\\b|€/.test(t)) curr = 'EUR';
        else if (/\\bGBP\\b|£/.test(t)) curr = 'GBP';
        else if (/\\bAED\\b/.test(t)) curr = 'AED';
        
        const rate = {HKD:0.128,USDT:1.0,EUR:1.08,GBP:1.27,AED:0.272,USD:1.0}[curr]||1.0;
        const price = parseFloat(r.price)||0;
        const priceUSD = Math.round(price*rate);
        const year = (r.created_on||'').substring(0,4);
        
        let score = 25;
        if (r.reference||r.normalized_reference) score += 25;
        if (price>0) score += 20;
        if (r.dial_color) score += 10;
        score += 8;
        if (year) score += 7;
        if (curr) score += 5;
        
        batch.push({
          brand: r.brand||'Unknown', reference: r.normalized_reference || r.reference || null,
          price_raw: price||null, price_usd: priceUSD||null, currency: curr,
          dial_color: r.dial_color||null, condition: condMap[r.condition_id]||'Used',
          year: year||null, box: r.box||null, papers: r.papers||null,
          raw_message: r.title||'',
          source: 'mysql_auctions', listing_type: 'WTS',
          verdict: score>=90?'APPROVED':'HUMAN',
          is_multi: false, jass_version: 'v4.0-import', confidence: score,
          received_at: r.created_on || new Date().toISOString(),
          channel_id: 'mysql_' + (r.from_number||'unknown'),
        });
        
        if (batch.length >= 50 || batch.length === rows.length) {
          const resp = await fetch(SUPABASE+'/rest/v1/watch_records', {
            method: 'POST',
            headers: {'Content-Type':'application/json','apikey':KEY,'Authorization':'Bearer '+KEY,'Prefer':'resolution=merge-duplicates,return=minimal'},
            body: JSON.stringify(batch),
          });
          if (resp.ok) inserted += batch.length;
          else { errors += batch.length; console.error('ERR:'+(await resp.text()).substring(0,100)); }
          process.stdout.write('.');
          batch = [];
          await new Promise(r => setTimeout(r, 200));
        }
      }
      console.log('\\nDone: '+inserted+' inserted, '+errors+' errors');
    }
    main().catch(e => { console.error(e.message); process.exit(1); });
  "
fi

rm -f "$CNF" "$SQLF" "$TSVF"
echo ""
echo "✅ Complete"

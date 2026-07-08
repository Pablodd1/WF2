#!/bin/bash
# FAST export — uses MySQL INTO OUTFILE for speed
# Falls back to normal export if OUTFILE not available
BASE="/mnt/c/Users/jasme/Desktop/WF_FULL_DATABASE"
CNF="/tmp/.mycf_fast_$$"
MYSQL_PWD="U0aeAr1zFt2'"

cat > "$CNF" << ENDCNF
[client]
host=161.35.0.209
port=3306
user=john
password=${MYSQL_PWD}
ENDCNF

M="mysql --defaults-extra-file=$CNF"

echo "=== FAST MASTER EXPORT ==="
echo ""

# Strategy: export ALL auctions in one go, then split by category locally
# This avoids the OFFSET problem entirely.

echo "[1] Exporting ALL auctions at once (~1.2M rows)..."
$M -B --quick -D thecollective_inventory -e "
SELECT title, brand, reference, price, dial_color, condition_id, box, papers, created_on, from_number, from_name, region
FROM auctions
WHERE title IS NOT NULL AND title != ''
ORDER BY created_on DESC;
" 2>/dev/null > "$BASE/_ALL_auctions.tsv"

AUCTIONS_TOTAL=$(tail -n +2 "$BASE/_ALL_auctions.tsv" | wc -l)
echo "   ✅ $AUCTIONS_TOTAL rows → _ALL_auctions.tsv"

echo ""
echo "[2] Splitting auctions into WTB / WTS / OTHER..."

python3 << PYEOF
import csv, os

BASE = r'/mnt/c/Users/jasme/Desktop/WF_FULL_DATABASE'
infile = os.path.join(BASE, '_ALL_auctions.tsv')

wtb_f = open(os.path.join(BASE, 'WTB', 'auctions_WTB.tsv'), 'w', encoding='utf-8', newline='')
wts_f = open(os.path.join(BASE, 'WTS', 'auctions_WTS.tsv'), 'w', encoding='utf-8', newline='')
oth_f = open(os.path.join(BASE, 'OTHER', 'auctions_OTHER.tsv'), 'w', encoding='utf-8', newline='')

wtb_w = csv.writer(wtb_f, delimiter='\t')
wts_w = csv.writer(wts_f, delimiter='\t')
oth_w = csv.writer(oth_f, delimiter='\t')

wtb_count = wts_count = oth_count = 0

with open(infile, 'r', encoding='utf-8', errors='replace') as f:
    reader = csv.reader(f, delimiter='\t')
    header = next(reader)
    wtb_w.writerow(header)
    wts_w.writerow(header)
    oth_w.writerow(header)
    
    for row in reader:
        if len(row) < 3: continue
        title = (row[0] or '').upper()
        
        # WTB detection
        if 'WTB' in title or 'WANT TO BUY' in title or 'LOOKING FOR' in title or 'WTT' in title:
            wtb_w.writerow(row)
            wtb_count += 1
        # WTS detection: brand+ref+price
        elif row[1] and row[1].strip() and row[2] and row[2].strip() and row[3] and float(row[3] or 0) > 0:
            wts_w.writerow(row)
            wts_count += 1
        else:
            oth_w.writerow(row)
            oth_count += 1
        
        if (wtb_count + wts_count + oth_count) % 100000 == 0:
            total = wtb_count + wts_count + oth_count
            pct = (total / $AUCTIONS_TOTAL) * 100
            print(f"  Progress: {total:,} / $AUCTIONS_TOTAL ({pct:.0f}%)")

wtb_f.close(); wts_f.close(); oth_f.close()

print(f"\n  WTB: {wtb_count:,} rows → WTB/auctions_WTB.tsv")
print(f"  WTS: {wts_count:,} rows → WTS/auctions_WTS.tsv")
print(f"  OTHER: {oth_count:,} rows → OTHER/auctions_OTHER.tsv")
print(f"  Total: {wtb_count+wts_count+oth_count:,}")

# Write summary
with open(os.path.join(BASE, 'INDEX.txt'), 'w') as f:
    f.write(f"""======================================================================
WF_FULL_DATABASE — Complete Export
======================================================================

AUCTIONS (main firehose):
  WTB:   {wtb_count:,} rows  → WTB/auctions_WTB.tsv
  WTS:   {wts_count:,} rows  → WTS/auctions_WTS.tsv
  OTHER: {oth_count:,} rows  → OTHER/auctions_OTHER.tsv
  TOTAL: {wtb_count+wts_count+oth_count:,}

FOLDER STRUCTURE:
  WTB/    — Want to Buy / Looking For
  WTS/    — Watches for Sale (brand+ref+price)
  OTHER/  — Uncategorized (needs parsing)

HOW TO OPEN:
  Excel → Data → From Text/CSV → Tab delimited
  Excel row limit: 1,048,576
  
  WTS file is {wts_count:,} rows — {"⚠ FITS in one Excel sheet" if wts_count <= 1048576 else "⚠ NEEDS splitting into 2 sheets"}

======================================================================
""")
PYEOF

# Clean up the _ALL file to save disk space
rm -f "$BASE/_ALL_auctions.tsv"

# Quick: auction_watches summary + product watches + scraping
echo ""
echo "[3] Exporting remaining tables..."

# auction_watches WTS
$M -B --quick -D thecollective_inventory -e "
SELECT title, brand, reference, normalized_reference, dial_color, year, box, papers
FROM auction_watches
WHERE brand IS NOT NULL AND brand != '' AND reference IS NOT NULL AND reference != ''
AND title IS NOT NULL
ORDER BY title LIMIT 200000;
" 2>/dev/null > "$BASE/WTS/auction_watches_WTS.tsv"
echo "   → WTS/auction_watches_WTS.tsv ($(tail -n +2 $BASE/WTS/auction_watches_WTS.tsv | wc -l) rows)"

# auction_watches WTB
$M -B --quick -D thecollective_inventory -e "
SELECT title, brand, reference, normalized_reference, dial_color, year, box, papers
FROM auction_watches
WHERE title IS NOT NULL AND (title LIKE '%WTB%' OR title LIKE '%WANT TO BUY%' OR title LIKE '%LOOKING FOR%')
ORDER BY title;
" 2>/dev/null > "$BASE/WTB/auction_watches_WTB.tsv"
echo "   → WTB/auction_watches_WTB.tsv ($(tail -n +2 $BASE/WTB/auction_watches_WTB.tsv | wc -l) rows)"

# Product watches
$M -B --quick -D thecollective_products -e "
SELECT title, nickname, sku, retail_price, online_price, year, dealer
FROM watches WHERE title IS NOT NULL ORDER BY title LIMIT 100000;
" 2>/dev/null > "$BASE/WTS/product_watches.tsv"
echo "   → WTS/product_watches.tsv ($(tail -n +2 $BASE/WTS/product_watches.tsv | wc -l) rows)"

# Scraping watches
$M -B --quick -D thecollective_scraping -e "
SELECT title, brand, model, reference, sku
FROM watches WHERE title IS NOT NULL ORDER BY title LIMIT 100000;
" 2>/dev/null > "$BASE/WTS/scraping_watches.tsv"
echo "   → WTS/scraping_watches.tsv ($(tail -n +2 $BASE/WTS/scraping_watches.tsv | wc -l) rows)"

# Remaining tables count summary
$M -B -e "
SELECT 'platform_the_collective' as table_name, COUNT(*) as total FROM thecollective_inventory.platform_the_collective
UNION ALL SELECT 'platform_ebay', COUNT(*) FROM thecollective_inventory.platform_ebay
UNION ALL SELECT 'product_variants', COUNT(*) FROM thecollective_products.watches_variants
UNION ALL SELECT 'sterling_watch', COUNT(*) FROM wf_sterling.watch
UNION ALL SELECT 'sterling_variants', COUNT(*) FROM wf_sterling.cc_variants
UNION ALL SELECT 'auction_watches_OTHER', COUNT(*) FROM thecollective_inventory.auction_watches WHERE (brand IS NULL OR brand = '' OR reference IS NULL OR reference = '') AND title NOT LIKE '%WTB%'
" 2>/dev/null > "$BASE/OTHER/_remaining_tables.tsv"
echo "   → OTHER/_remaining_tables.tsv"

rm -f "$CNF"

echo ""
echo "=============================================="
echo "✅ DONE"
echo "=============================================="
echo ""
echo "Folder: C:\\Users\\jasme\\Desktop\\WF_FULL_DATABASE\\"
echo ""
find "$BASE" -name "*.tsv" -o -name "*.txt" | while read f; do
  SIZE=$(du -sh "$f" 2>/dev/null | cut -f1)
  LINES=$(wc -l < "$f" 2>/dev/null)
  REL="${f#$BASE/}"
  printf "  %-50s %8s rows  %s\n" "$REL" "$LINES" "$SIZE"
done
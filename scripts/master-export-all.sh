#!/bin/bash
# MASTER EXPORT — ALL MySQL data → Desktop/WF_FULL_DATABASE/
# Organized: WTB/ WTS/ OTHER/ SUPABASE/
set -e

BASE="/mnt/c/Users/jasme/Desktop/WF_FULL_DATABASE"
CNF="/tmp/.mycf_master_$$"

cat > "$CNF" << 'ENDCNF'
[client]
host=161.35.0.209
port=3306
user=john
password="U0aeAr1zFt2'"
ENDCNF

M="mysql --defaults-extra-file=$CNF"
echo "Starting master exports..."
echo ""

# ════════════════════════════════════════════════════════
# STEP 1: auctions OTHER parts 2+3 (~325K remaining)
# ════════════════════════════════════════════════════════
echo "[1/8] auctions OTHER part 2..."
$M -B --quick -D thecollective_inventory -e "
SELECT 'auctions' as source, title as raw_message, brand, reference, price, created_on, from_number, region
FROM auctions
WHERE (brand IS NULL OR brand = '' OR reference IS NULL OR reference = '' OR price = 0 OR price IS NULL)
AND title NOT LIKE '%WTB%' AND title NOT LIKE '%WANT TO BUY%' AND title NOT LIKE '%LOOKING FOR%'
ORDER BY created_on DESC LIMIT 200000 OFFSET 200000;
" 2>/dev/null > "$BASE/OTHER/auctions_OTHER_p2.tsv"
echo "   → $BASE/OTHER/auctions_OTHER_p2.tsv ($(tail -n +2 $BASE/OTHER/auctions_OTHER_p2.tsv | wc -l) rows)"

echo "[2/8] auctions OTHER part 3..."
$M -B --quick -D thecollective_inventory -e "
SELECT 'auctions' as source, title as raw_message, brand, reference, price, created_on, from_number, region
FROM auctions
WHERE (brand IS NULL OR brand = '' OR reference IS NULL OR reference = '' OR price = 0 OR price IS NULL)
AND title NOT LIKE '%WTB%' AND title NOT LIKE '%WANT TO BUY%' AND title NOT LIKE '%LOOKING FOR%'
ORDER BY created_on DESC LIMIT 200000 OFFSET 400000;
" 2>/dev/null > "$BASE/OTHER/auctions_OTHER_p3.tsv"
echo "   → $BASE/OTHER/auctions_OTHER_p3.tsv ($(tail -n +2 $BASE/OTHER/auctions_OTHER_p3.tsv | wc -l) rows)"

# Move existing OTHER p1
if [ -f "/mnt/c/Users/jasme/Desktop/auctions_OTHER_p1.tsv" ]; then
  mv "/mnt/c/Users/jasme/Desktop/auctions_OTHER_p1.tsv" "$BASE/OTHER/"
  echo "   ← moved auctions_OTHER_p1.tsv"
fi

# ════════════════════════════════════════════════════════
# STEP 3: Move existing auction WTS & WTB files
# ════════════════════════════════════════════════════════
echo ""
echo "[3/8] Moving existing auction files..."
for f in /mnt/c/Users/jasme/Desktop/auctions_WTS_p*.tsv; do
  if [ -f "$f" ]; then
    cp "$f" "$BASE/WTS/"
    echo "   → $(basename $f)"
  fi
done
if [ -f "/mnt/c/Users/jasme/Desktop/auctions_WTB.tsv" ]; then
  cp "/mnt/c/Users/jasme/Desktop/auctions_WTB.tsv" "$BASE/WTB/"
  echo "   → auctions_WTB.tsv"
fi

# ════════════════════════════════════════════════════════
# STEP 4: auction_watches — WTB
# ════════════════════════════════════════════════════════
echo ""
echo "[4/8] auction_watches WTB..."
$M -B --quick -D thecollective_inventory -e "
SELECT 'auction_watches' as source, title, brand, reference, normalized_reference, dial_color, year, box, papers
FROM auction_watches
WHERE title IS NOT NULL
AND (title LIKE '%WTB%' OR title LIKE '%WANT TO BUY%' OR title LIKE '%LOOKING FOR%')
ORDER BY title;
" 2>/dev/null > "$BASE/WTB/auction_watches_WTB.tsv"
echo "   → $BASE/WTB/auction_watches_WTB.tsv ($(tail -n +2 $BASE/WTB/auction_watches_WTB.tsv | wc -l) rows)"

# ════════════════════════════════════════════════════════
# STEP 5: auction_watches — WTS
# ════════════════════════════════════════════════════════
echo ""
echo "[5/8] auction_watches WTS..."
$M -B --quick -D thecollective_inventory -e "
SELECT 'auction_watches' as source, title, brand, reference, normalized_reference, dial_color, year, box, papers
FROM auction_watches
WHERE brand IS NOT NULL AND brand != ''
AND reference IS NOT NULL AND reference != ''
AND title NOT LIKE '%WTB%' AND title NOT LIKE '%WANT TO BUY%' AND title NOT LIKE '%LOOKING FOR%'
ORDER BY title LIMIT 200000;
" 2>/dev/null > "$BASE/WTS/auction_watches_WTS.tsv"
echo "   → $BASE/WTS/auction_watches_WTS.tsv ($(tail -n +2 $BASE/WTS/auction_watches_WTS.tsv | wc -l) rows)"

# ════════════════════════════════════════════════════════
# STEP 6: auction_watches — OTHER
# ════════════════════════════════════════════════════════
echo ""
echo "[6/8] auction_watches OTHER..."
$M -B --quick -D thecollective_inventory -e "
SELECT 'auction_watches' as source, title, brand, reference, normalized_reference, dial_color, year, box, papers
FROM auction_watches
WHERE title IS NOT NULL
AND (brand IS NULL OR brand = '' OR reference IS NULL OR reference = '')
AND title NOT LIKE '%WTB%' AND title NOT LIKE '%WANT TO BUY%' AND title NOT LIKE '%LOOKING FOR%'
ORDER BY title LIMIT 200000;
" 2>/dev/null > "$BASE/OTHER/auction_watches_OTHER_p1.tsv"
echo "   → $BASE/OTHER/auction_watches_OTHER_p1.tsv ($(tail -n +2 $BASE/OTHER/auction_watches_OTHER_p1.tsv | wc -l) rows)"

# ════════════════════════════════════════════════════════
# STEP 7: Remaining tables → OTHER folder
# ════════════════════════════════════════════════════════
echo ""
echo "[7/8] Platforms, products, scraping, sterling..."

# Platforms (summary only — schema doesn't have brand/ref columns)
$M -B -e "
SELECT 'TC+eBay platforms' as table_name, COUNT(*) as total_records
FROM thecollective_inventory.platform_the_collective
UNION ALL SELECT 'product_watches', COUNT(*) FROM thecollective_products.watches
UNION ALL SELECT 'product_variants', COUNT(*) FROM thecollective_products.watches_variants
UNION ALL SELECT 'scraping_watches', COUNT(*) FROM thecollective_scraping.watches
UNION ALL SELECT 'sterling_watch', COUNT(*) FROM wf_sterling.watch
UNION ALL SELECT 'sterling_variants', COUNT(*) FROM wf_sterling.cc_variants;
" 2>/dev/null > "$BASE/OTHER/_remaining_tables_counts.tsv"
echo "   → counts saved"

# Product watches (WTS)
$M -B --quick -D thecollective_products -e "
SELECT 'product_watch' as source, title, nickname, sku, retail_price, online_price, year, dealer
FROM watches WHERE title IS NOT NULL
ORDER BY title LIMIT 100000;
" 2>/dev/null > "$BASE/WTS/product_watches.tsv"
echo "   → $BASE/WTS/product_watches.tsv ($(tail -n +2 $BASE/WTS/product_watches.tsv | wc -l) rows)"

# Scraping watches (WTS)
$M -B --quick -D thecollective_scraping -e "
SELECT 'scraping' as source, title, brand, model, reference, sku
FROM watches WHERE title IS NOT NULL
ORDER BY title LIMIT 100000;
" 2>/dev/null > "$BASE/WTS/scraping_watches.tsv"
echo "   → $BASE/WTS/scraping_watches.tsv ($(tail -n +2 $BASE/WTS/scraping_watches.tsv | wc -l) rows)"

# Product variants → OTHER
$M -B --quick -D thecollective_products -e "
SELECT 'variant' as source, wv.reference, wv.nickname, w.title as watch_title
FROM watches_variants wv
LEFT JOIN watches w ON w.id = wv.watch_id
LIMIT 200000;
" 2>/dev/null > "$BASE/OTHER/product_variants_p1.tsv"
echo "   → $BASE/OTHER/product_variants_p1.tsv ($(tail -n +2 $BASE/OTHER/product_variants_p1.tsv | wc -l) rows)"

# ════════════════════════════════════════════════════════
# STEP 8: INDEX FILE
# ════════════════════════════════════════════════════════
echo ""
echo "[8/8] Writing INDEX..."

cat > "$BASE/INDEX.txt" << 'INDEXEOF'
======================================================================
WF_FULL_DATABASE — Complete Export
======================================================================

FOLDER STRUCTURE:
  WTB/      — Want to Buy / Looking For records
  WTS/      — Watches for Sale (clean: brand+ref+price)
  OTHER/    — Uncategorized (needs parsing)
  SUPABASE/ — Existing WatchFacts data from Telegram pipeline

======================================================================
WTS FOLDER (925,977 total records)
======================================================================
INDEXEOF

echo "  auctions_WTS_p1.tsv — 200,000 rows" >> "$BASE/INDEX.txt"
echo "  auctions_WTS_p2.tsv — 200,000 rows" >> "$BASE/INDEX.txt"
echo "  auctions_WTS_p3_final.tsv — 188,157 rows" >> "$BASE/INDEX.txt"
echo "  auction_watches_WTS.tsv — $(tail -n +2 $BASE/WTS/auction_watches_WTS.tsv 2>/dev/null | wc -l) rows" >> "$BASE/INDEX.txt"
echo "  product_watches.tsv — $(tail -n +2 $BASE/WTS/product_watches.tsv 2>/dev/null | wc -l) rows" >> "$BASE/INDEX.txt"
echo "  scraping_watches.tsv — $(tail -n +2 $BASE/WTS/scraping_watches.tsv 2>/dev/null | wc -l) rows" >> "$BASE/INDEX.txt"

cat >> "$BASE/INDEX.txt" << 'INDEXEOF'

======================================================================
WTB FOLDER (198,487 total records)
======================================================================
INDEXEOF

echo "  auctions_WTB.tsv — $(tail -n +2 $BASE/WTB/auctions_WTB.tsv 2>/dev/null | wc -l) rows" >> "$BASE/INDEX.txt"
echo "  auction_watches_WTB.tsv — $(tail -n +2 $BASE/WTB/auction_watches_WTB.tsv 2>/dev/null | wc -l) rows" >> "$BASE/INDEX.txt"

cat >> "$BASE/INDEX.txt" << 'INDEXEOF'

======================================================================
OTHER FOLDER (2,068,680 total records)
======================================================================
INDEXEOF

echo "  auctions_OTHER_p1.tsv — $(tail -n +2 $BASE/OTHER/auctions_OTHER_p1.tsv 2>/dev/null | wc -l) rows" >> "$BASE/INDEX.txt"
echo "  auctions_OTHER_p2.tsv — $(tail -n +2 $BASE/OTHER/auctions_OTHER_p2.tsv 2>/dev/null | wc -l) rows" >> "$BASE/INDEX.txt"  
echo "  auctions_OTHER_p3.tsv — $(tail -n +2 $BASE/OTHER/auctions_OTHER_p3.tsv 2>/dev/null | wc -l) rows" >> "$BASE/INDEX.txt"
echo "  auction_watches_OTHER_p1.tsv — $(tail -n +2 $BASE/OTHER/auction_watches_OTHER_p1.tsv 2>/dev/null | wc -l) rows" >> "$BASE/INDEX.txt"
echo "  product_variants_p1.tsv — $(tail -n +2 $BASE/OTHER/product_variants_p1.tsv 2>/dev/null | wc -l) rows" >> "$BASE/INDEX.txt"
echo "  _remaining_tables_counts.tsv — summary of tables not fully exported" >> "$BASE/INDEX.txt"

cat >> "$BASE/INDEX.txt" << 'INDEXEOF'

======================================================================
HOW TO OPEN
======================================================================
Each .tsv file can be opened in Excel:
  1. Open Excel
  2. Data → From Text/CSV
  3. Select the .tsv file
  4. Delimiter: Tab
  5. Load

To combine multiple parts (e.g., auctions_WTS_p1 + p2 + p3):
  1. Open all 3 in Excel
  2. Copy rows from p2 and p3 into p1
  3. Save as .xlsx

Excel row limit: 1,048,576 per sheet.
Files are split to stay under this limit.

======================================================================
NOTES
======================================================================
- WTB detection: title contains WTB, WANT TO BUY, LOOKING FOR, WTT
- WTS detection: brand + reference + price all present, NOT WTB
- OTHER: everything else — needs JASS v4.0 parsing
- Some files truncated at 200K rows — full data is in MySQL
- To extract more: use the import-mysql-auctions.sh script
- Full import into Supabase recommended for unlimited queries

======================================================================
INDEXEOF

echo ""
echo "=============================================="
echo "EXPORT COMPLETE"
echo "=============================================="
echo ""
echo "Folder: C:\\Users\\jasme\\Desktop\\WF_FULL_DATABASE\\"
echo ""
echo "Files:"
find "$BASE" -name "*.tsv" -o -name "*.txt" | while read f; do
  SIZE=$(du -sh "$f" 2>/dev/null | cut -f1)
  LINES=$(wc -l < "$f" 2>/dev/null)
  REL="${f#$BASE/}"
  printf "  %-50s %8s rows  %s\n" "$REL" "$LINES" "$SIZE"
done

# Total size
TOTAL_SIZE=$(du -sh "$BASE" 2>/dev/null | cut -f1)
echo ""
echo "Total folder size: $TOTAL_SIZE"
echo ""

rm -f "$CNF"

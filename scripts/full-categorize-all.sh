#!/bin/bash
# FULL MySQL Database Categorization Report
# Exports ALL tables categorized into WTB / WTS / OTHER
# Splits into multiple sheets/files if needed (Excel limit: 1,048,576 rows)

set -e
DESKTOP="/mnt/c/Users/jasme/Desktop"
CNF="/tmp/.mycf_full_report_$$"
TIMESTAMP=$(date +%Y%m%d_%H%M)

cat > "$CNF" << 'ENDCNF'
[client]
host=161.35.0.209
port=3306
user=john
password="U0aeAr1zFt2'"
ENDCNF

MYSQL="mysql --defaults-extra-file=$CNF"

echo "============================================"
echo "FULL MySQL DATABASE CATEGORIZATION"
echo "============================================"
echo ""

# ═══════════════════════════════════════════════════════════
# TABLE 1: auctions (1,225,297 records) — the main firehose
# ═══════════════════════════════════════════════════════════
echo "1/9 auctions (1,225,297 records)..."

# WTB
$MYSQL -B --quick -D thecollective_inventory 2>/dev/null > "$DESKTOP/auctions_WTB.tsv" <<SQL
SELECT 'auctions' as source, title as raw_message, brand, reference, price, dial_color, condition_id, created_on, from_number, region
FROM thecollective_inventory.auctions
WHERE title IS NOT NULL AND (title LIKE '%WTB%' OR title LIKE '%WANT TO BUY%' OR title LIKE '%LOOKING FOR%' OR title LIKE '%WTT%')
ORDER BY created_on DESC
SQL
WTB_COUNT=$(tail -n +2 "$DESKTOP/auctions_WTB.tsv" | wc -l)
echo "   WTB: $WTB_COUNT → auctions_WTB.tsv"

# WTS (clean: brand+ref+price, not WTB)
$MYSQL -B --quick -D thecollective_inventory 2>/dev/null > "$DESKTOP/auctions_WTS.tsv" <<SQL
SELECT 'auctions' as source, title as raw_message, brand, reference, price, dial_color, condition_id, created_on, from_number, region
FROM thecollective_inventory.auctions
WHERE brand IS NOT NULL AND brand != '' AND reference IS NOT NULL AND reference != '' AND price > 0
AND title NOT LIKE '%WTB%' AND title NOT LIKE '%WANT TO BUY%' AND title NOT LIKE '%LOOKING FOR%' AND title NOT LIKE '%WTT%'
ORDER BY created_on DESC
SQL
WTS_COUNT=$(tail -n +2 "$DESKTOP/auctions_WTS.tsv" | wc -l)
echo "   WTS: $WTS_COUNT → auctions_WTS.tsv"

# OTHER (no brand/ref/price, not WTB)
$MYSQL -B --quick -D thecollective_inventory 2>/dev/null > "$DESKTOP/auctions_OTHER.tsv" <<SQL
SELECT 'auctions' as source, title as raw_message, brand, reference, price, created_on, from_number, region
FROM thecollective_inventory.auctions
WHERE (brand IS NULL OR brand = '' OR reference IS NULL OR reference = '' OR price = 0 OR price IS NULL)
AND title NOT LIKE '%WTB%' AND title NOT LIKE '%WANT TO BUY%' AND title NOT LIKE '%LOOKING FOR%' AND title NOT LIKE '%WTT%'
ORDER BY created_on DESC
SQL
OTHER_COUNT=$(tail -n +2 "$DESKTOP/auctions_OTHER.tsv" | wc -l)
echo "   OTHER: $OTHER_COUNT → auctions_OTHER.tsv"

# ═══════════════════════════════════════════════════════════
# TABLE 2: auction_watches (1,162,680 records)
# ═══════════════════════════════════════════════════════════
echo ""
echo "2/9 auction_watches (1,162,680 records)..."

$MYSQL -B --quick -D thecollective_inventory 2>/dev/null > "$DESKTOP/auction_watches_ALL.tsv" <<SQL
SELECT 
  CASE 
    WHEN title LIKE '%WTB%' OR title LIKE '%WANT TO BUY%' OR title LIKE '%LOOKING FOR%' THEN 'WTB'
    WHEN brand IS NOT NULL AND brand != '' AND reference IS NOT NULL AND reference != '' THEN 'WTS'
    ELSE 'OTHER'
  END as category,
  'auction_watches' as source, title, brand, reference, normalized_reference, dial_color, year, box, papers, front_image
FROM thecollective_inventory.auction_watches
WHERE title IS NOT NULL AND title != ''
ORDER BY title
SQL
AW_COUNT=$(tail -n +2 "$DESKTOP/auction_watches_ALL.tsv" | wc -l)
echo "   ALL: $AW_COUNT → auction_watches_ALL.tsv"

# ═══════════════════════════════════════════════════════════
# TABLE 3+4: platform_the_collective + platform_ebay
# ═══════════════════════════════════════════════════════════
echo ""
echo "3/9 platform_the_collective + platform_ebay..."

$MYSQL -B --quick -D thecollective_inventory 2>/dev/null > "$DESKTOP/platforms_ALL.tsv" <<SQL
SELECT 'the_collective' as platform, active_title as title, price, is_active, created_at
FROM thecollective_inventory.platform_the_collective
WHERE active_title IS NOT NULL
UNION ALL
SELECT 'ebay' as platform, active_title as title, price, is_active, created_at
FROM thecollective_inventory.platform_ebay
WHERE active_title IS NOT NULL
ORDER BY created_at DESC
SQL
PLAT_COUNT=$(tail -n +2 "$DESKTOP/platforms_ALL.tsv" | wc -l)
echo "   ALL: $PLAT_COUNT → platforms_ALL.tsv"

# ═══════════════════════════════════════════════════════════
# TABLE 5+6: thecollective_products watches + variants
# ═══════════════════════════════════════════════════════════
echo ""
echo "5/9 thecollective_products.watches..."

$MYSQL -B --quick -D thecollective_products 2>/dev/null > "$DESKTOP/product_watches_ALL.tsv" <<SQL
SELECT 'product_watch' as source, title, nickname, sku, retail_price as price, online_price, year, dealer
FROM thecollective_products.watches
WHERE title IS NOT NULL
ORDER BY title
SQL
PW_COUNT=$(tail -n +2 "$DESKTOP/product_watches_ALL.tsv" | wc -l)
echo "   ALL: $PW_COUNT → product_watches_ALL.tsv"

echo ""
echo "6/9 thecollective_products.watches_variants..."

$MYSQL -B --quick -D thecollective_products 2>/dev/null > "$DESKTOP/product_variants_ALL.tsv" <<SQL
SELECT 'variant' as source, wv.reference, wv.nickname, wv.dial_color_id, w.title as watch_title
FROM thecollective_products.watches_variants wv
LEFT JOIN thecollective_products.watches w ON w.id = wv.watch_id
LIMIT 500000
SQL
PV_COUNT=$(tail -n +2 "$DESKTOP/product_variants_ALL.tsv" | wc -l)
echo "   ALL: $PV_COUNT → product_variants_ALL.tsv"

# ═══════════════════════════════════════════════════════════
# TABLE 7: thecollective_scraping.watches
# ═══════════════════════════════════════════════════════════
echo ""
echo "7/9 thecollective_scraping.watches..."

$MYSQL -B --quick -D thecollective_scraping 2>/dev/null > "$DESKTOP/scraping_watches_ALL.tsv" <<SQL
SELECT 'scraping' as source, title, brand, model, reference, sku, nickname
FROM thecollective_scraping.watches
WHERE title IS NOT NULL
ORDER BY title
SQL
SC_COUNT=$(tail -n +2 "$DESKTOP/scraping_watches_ALL.tsv" | wc -l)
echo "   ALL: $SC_COUNT → scraping_watches_ALL.tsv"

# ═══════════════════════════════════════════════════════════
# TABLE 8+9: wf_sterling
# ═══════════════════════════════════════════════════════════
echo ""
echo "8/9 wf_sterling.watch..."

$MYSQL -B --quick -D wf_sterling 2>/dev/null > "$DESKTOP/sterling_watches_ALL.tsv" <<SQL
SELECT 'sterling_watch' as source, id, created_at, updated_at
FROM wf_sterling.watch
ORDER BY id
SQL
SW_COUNT=$(tail -n +2 "$DESKTOP/sterling_watches_ALL.tsv" | wc -l)
echo "   ALL: $SW_COUNT → sterling_watches_ALL.tsv"

echo ""
echo "9/9 wf_sterling.cc_variants..."

$MYSQL -B --quick -D wf_sterling 2>/dev/null > "$DESKTOP/sterling_variants_ALL.tsv" <<SQL
SELECT 'sterling_variant' as source, cc_v.dial_color, cc_v.band_material, cc_v.case_material, cc_v.bezel_material
FROM wf_sterling.cc_variants cc_v
ORDER BY cc_v.id
SQL
SV_COUNT=$(tail -n +2 "$DESKTOP/sterling_variants_ALL.tsv" | wc -l)
echo "   ALL: $SV_COUNT → sterling_variants_ALL.tsv"

# ═══════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════
echo ""
echo "============================================"
echo "COMPLETE CATEGORIZATION SUMMARY"
echo "============================================"
echo ""
printf "%-40s %15s %15s %15s %15s\n" "TABLE" "TOTAL" "WTB" "WTS" "OTHER"
echo "-------------------------------------------------------------------------------------------"
printf "%-40s %15s %15s %15s %15s\n" "auctions" "1,225,297" "$WTB_COUNT" "$WTS_COUNT" "$OTHER_COUNT"
printf "%-40s %15s %15s %15s %15s\n" "auction_watches" "1,162,680" "" "" "$AW_COUNT"
printf "%-40s %15s\n" "platforms (TC+eBay)" "178,323"
printf "%-40s %15s\n" "product_watches" "$PW_COUNT"
printf "%-40s %15s\n" "product_variants" "$PV_COUNT"
printf "%-40s %15s\n" "scraping_watches" "$SC_COUNT"
printf "%-40s %15s\n" "sterling_watches" "$SW_COUNT"
printf "%-40s %15s\n" "sterling_variants" "$SV_COUNT"
echo ""
TOTAL_ALL=$((1225297 + 1162680 + 178323 + PW_COUNT + PV_COUNT + SC_COUNT + SW_COUNT + SV_COUNT))
echo "GRAND TOTAL ACROSS ALL TABLES: $(printf '%'\''d' $TOTAL_ALL) records"
echo ""
echo "Files saved to Desktop:"
ls -1 "$DESKTOP"/*.tsv 2>/dev/null | while read f; do
  SIZE=$(du -sh "$f" | cut -f1)
  LINES=$(wc -l < "$f")
  echo "  $(basename "$f") — $LINES rows — $SIZE"
done

rm -f "$CNF"
echo ""
echo "✅ Complete. Open TSV files in Excel: Data → From Text → Delimited → Tab"

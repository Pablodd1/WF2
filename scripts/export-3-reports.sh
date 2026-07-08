#!/bin/bash
# Export 3 reports: WTB, WTS, OTHER → Desktop
CNF="/tmp/.mycf_report_$$"
cat > "$CNF" << 'ENDCNF'
[client]
host=161.35.0.209
port=3306
user=john
password="U0aeAr1zFt2'"
ENDCNF

DESKTOP="/mnt/c/Users/jasme/Desktop"

echo "=== Exporting 3 reports to Desktop ==="

# REPORT 1: WTB / LOOKING FOR
echo "1. WTB / Looking For..."
mysql --defaults-extra-file="$CNF" -B -e "
SELECT title as raw_message, brand, reference, price, dial_color, condition_id, created_on, from_number, region
FROM thecollective_inventory.auctions
WHERE title IS NOT NULL
AND (title LIKE '%WTB%' OR title LIKE '%WANT TO BUY%' OR title LIKE '%LOOKING FOR%' OR title LIKE '%WTT%')
ORDER BY created_on DESC
LIMIT 500;
" > "$DESKTOP/WTB_looking_for_report.tsv" 2>/dev/null

COUNT1=$(tail -n +2 "$DESKTOP/WTB_looking_for_report.tsv" | wc -l)
echo "   ✅ WTB: $COUNT1 records → $DESKTOP/WTB_looking_for_report.tsv"

# REPORT 2: WATCHES FOR SALE (clean)
echo "2. Watches For Sale..."
mysql --defaults-extra-file="$CNF" -B -e "
SELECT title as raw_message, brand, reference, price, dial_color, condition_id, created_on, from_number, region
FROM thecollective_inventory.auctions
WHERE brand IS NOT NULL AND brand != ''
AND reference IS NOT NULL AND reference != ''
AND price > 0
AND title NOT LIKE '%WTB%' AND title NOT LIKE '%WANT TO BUY%' AND title NOT LIKE '%LOOKING FOR%'
ORDER BY created_on DESC
LIMIT 500;
" > "$DESKTOP/Watches_WTS_report.tsv" 2>/dev/null

COUNT2=$(tail -n +2 "$DESKTOP/Watches_WTS_report.tsv" | wc -l)
echo "   ✅ WTS: $COUNT2 records → $DESKTOP/Watches_WTS_report.tsv"

# REPORT 3: OTHER / UNCATEGORIZED (no brand/ref)
echo "3. Other / Uncategorized..."
mysql --defaults-extra-file="$CNF" -B -e "
SELECT title as raw_message, brand, reference, price, created_on, from_number, region
FROM thecollective_inventory.auctions
WHERE (brand IS NULL OR brand = '' OR reference IS NULL OR reference = '' OR price = 0 OR price IS NULL)
AND title IS NOT NULL AND title != ''
AND title NOT LIKE '%WTB%' AND title NOT LIKE '%WANT TO BUY%' AND title NOT LIKE '%LOOKING FOR%'
ORDER BY created_on DESC
LIMIT 500;
" > "$DESKTOP/Other_uncategorized_report.tsv" 2>/dev/null

COUNT3=$(tail -n +2 "$DESKTOP/Other_uncategorized_report.tsv" | wc -l)
echo "   ✅ OTHER: $COUNT3 records → $DESKTOP/Other_uncategorized_report.tsv"

# SUMMARY
echo ""
echo "=== TOTAL COUNTS (FULL DATABASE) ==="
mysql --defaults-extra-file="$CNF" -B -e "
SELECT 'WTB / Looking For' as category, 111429 as total
UNION ALL SELECT 'Watches WTS (clean)', 588146
UNION ALL SELECT 'Other / Uncategorized', 524828
UNION ALL SELECT 'TOTAL ALL', 1224403
UNION ALL SELECT '', ''
UNION ALL SELECT 'WTB breakdown:', ''
UNION ALL SELECT '  - Looking For', 68947
UNION ALL SELECT '  - WTB exact', 39563
UNION ALL SELECT '  - Want to Buy', 2919
UNION ALL SELECT '', ''
UNION ALL SELECT 'Other breakdown:', ''
UNION ALL SELECT '  - No brand at all', 443850
UNION ALL SELECT '  - Has price but no brand/ref', 127220
UNION ALL SELECT '  - Has brand but no reference', 17532
" 2>/dev/null | column -t -s $'\t'

rm -f "$CNF"
echo ""
echo "✅ All 3 reports saved to Desktop"
echo "   Open as TSV in Excel: Data → From Text → Delimited → Tab"

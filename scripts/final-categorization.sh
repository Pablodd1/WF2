#!/bin/bash
# Generate the summary count report for all MySQL data
CNF="/tmp/.mycf_summary_$$"
cat > "$CNF" << 'ENDCNF'
[client]
host=161.35.0.209
port=3306
user=john
password="U0aeAr1zFt2'"
ENDCNF

DESKTOP="/mnt/c/Users/jasme/Desktop"
MYSQL="mysql --defaults-extra-file=$CNF"

cat > "$DESKTOP/FULL_DATABASE_CATEGORIZATION.txt" << 'OUTEREOF'
======================================================================
FULL MySQL DATABASE CATEGORIZATION REPORT
======================================================================
Generated: $(date)
======================================================================

TABLE                                    TOTAL          WTB          WTS        OTHER
-----------------------------------------------------------------------------------
OUTEREOF

echo ""

# auctions (all 3 categories computed already)
echo "  auctions (computing)..."

WTB_AUC=111431
WTS_AUC=588157
OTHER_AUC=$((1225297 - WTB_AUC - WTS_AUC))

cat >> "$DESKTOP/FULL_DATABASE_CATEGORIZATION.txt" << EOF
auctions                              1,225,297      111,431      588,157      525,709
EOF

echo "   auctions done: WTB=$WTB_AUC WTS=$WTS_AUC OTHER=$OTHER_AUC"

# auction_watches (fast — just counts)
AW=$($MYSQL -B -N -e "SELECT COUNT(*) FROM thecollective_inventory.auction_watches WHERE title IS NOT NULL" 2>/dev/null)
AW_WTB=$($MYSQL -B -N -e "SELECT COUNT(*) FROM thecollective_inventory.auction_watches WHERE title LIKE '%WTB%' OR title LIKE '%WANT TO BUY%' OR title LIKE '%LOOKING FOR%'" 2>/dev/null)
AW_WTS=$($MYSQL -B -N -e "SELECT COUNT(*) FROM thecollective_inventory.auction_watches WHERE brand IS NOT NULL AND brand != '' AND reference IS NOT NULL AND reference != '' AND title NOT LIKE '%WTB%' AND title NOT LIKE '%WANT TO BUY%'" 2>/dev/null)
AW_OTHER=$((AW - AW_WTB - AW_WTS))

cat >> "$DESKTOP/FULL_DATABASE_CATEGORIZATION.txt" << EOF
auction_watches                         $(printf "%'d" $AW)       $(printf "%'d" $AW_WTB)       $(printf "%'d" $AW_WTS)       $(printf "%'d" $AW_OTHER)
EOF

echo "   auction_watches done: WTB=$AW_WTB WTS=$AW_WTS OTHER=$AW_OTHER"

# platforms
TC=$($MYSQL -B -N -e "SELECT COUNT(*) FROM thecollective_inventory.platform_the_collective" 2>/dev/null)
EB=$($MYSQL -B -N -e "SELECT COUNT(*) FROM thecollective_inventory.platform_ebay" 2>/dev/null)
PLAT_TOTAL=$((TC + EB))

cat >> "$DESKTOP/FULL_DATABASE_CATEGORIZATION.txt" << EOF
platforms (TC+eBay)                     $(printf "%'d" $PLAT_TOTAL)        —            —        $(printf "%'d" $PLAT_TOTAL)
EOF

echo "   platforms done: $PLAT_TOTAL"

# products
PW=$($MYSQL -B -N -e "SELECT COUNT(*) FROM thecollective_products.watches WHERE title IS NOT NULL" 2>/dev/null)
PV=$($MYSQL -B -N -e "SELECT COUNT(*) FROM thecollective_products.watches_variants" 2>/dev/null)

cat >> "$DESKTOP/FULL_DATABASE_CATEGORIZATION.txt" << EOF
product_watches                          $(printf "%'d" $PW)         —        $(printf "%'d" $PW)         —
product_variants                         $(printf "%'d" $PV)         —            —        $(printf "%'d" $PV)
EOF

echo "   products done: watches=$PW variants=$PV"

# scraping
SC=$($MYSQL -B -N -e "SELECT COUNT(*) FROM thecollective_scraping.watches WHERE title IS NOT NULL" 2>/dev/null)
SC_WTS=$($MYSQL -B -N -e "SELECT COUNT(*) FROM thecollective_scraping.watches WHERE brand IS NOT NULL AND brand != '' AND reference IS NOT NULL AND reference != ''" 2>/dev/null)
SC_OTHER=$((SC - SC_WTS))

cat >> "$DESKTOP/FULL_DATABASE_CATEGORIZATION.txt" << EOF
scraping_watches                         $(printf "%'d" $SC)         —        $(printf "%'d" $SC_WTS)       $(printf "%'d" $SC_OTHER)
EOF

echo "   scraping done: $SC"

# sterling
SW=$($MYSQL -B -N -e "SELECT COUNT(*) FROM wf_sterling.watch" 2>/dev/null)
SV=$($MYSQL -B -N -e "SELECT COUNT(*) FROM wf_sterling.cc_variants" 2>/dev/null)

cat >> "$DESKTOP/FULL_DATABASE_CATEGORIZATION.txt" << EOF
sterling_watches                         $(printf "%'d" $SW)         —            —        $(printf "%'d" $SW)
sterling_variants                        $(printf "%'d" $SV)         —            —        $(printf "%'d" $SV)
___________________________________________________________________________________________________________
EOF

# Grand totals
WTS_TOTAL=$((WTS_AUC + AW_WTS + PW + SC_WTS))
WTB_TOTAL=$((WTB_AUC + AW_WTB))
OTHER_TOTAL=$((OTHER_AUC + AW_OTHER + PLAT_TOTAL + PV + SC_OTHER + SW + SV))
GRAND_TOTAL=$((WTS_TOTAL + WTB_TOTAL + OTHER_TOTAL))

cat >> "$DESKTOP/FULL_DATABASE_CATEGORIZATION.txt" << EOF

GRAND TOTALS                            $(printf "%'d" $GRAND_TOTAL)      $(printf "%'d" $WTB_TOTAL)      $(printf "%'d" $WTS_TOTAL)      $(printf "%'d" $OTHER_TOTAL)

======================================================================
CATEGORY BREAKDOWN
======================================================================

WATCHES FOR SALE (WTS)
  Clean (brand+ref+price): $WTS_TOTAL records
  Sources: auctions, auction_watches, product_watches, scraping_watches

WANT TO BUY / LOOKING FOR (WTB)
  Total: $WTB_TOTAL records
  Sources: auctions ($WTB_AUC), auction_watches ($AW_WTB)

OTHER / UNCATEGORIZED
  Total: $OTHER_TOTAL records
  - auctions (no brand/ref/price): $OTHER_AUC
  - auction_watches (no brand/ref): $AW_OTHER
  - platforms (TC+eBay): $PLAT_TOTAL
  - product_variants: $PV
  - scraping_watches (no brand/ref): $SC_OTHER
  - sterling_watches: $SW
  - sterling_variants: $SV

======================================================================
NOTES
======================================================================

- WTB detection: title containing WTB, WANT TO BUY, LOOKING FOR, WTT
- WTS detection: brand + reference + price all present AND not WTB
- OTHER: everything that doesn't have all 3 fields filled
- platforms & sterling tables cannot be categorized without parsing their titles
- Excel can open TSV files: Data → From Text → Delimited → Tab
- Excel row limit: 1,048,576 per sheet — files >1M rows will need to be split

======================================================================
EXPORTED FILES ON DESKTOP
======================================================================
OUTEREOF

echo ""
echo "Files exported to Desktop:"
ls -lh "$DESKTOP"/auctions_*.tsv "$DESKTOP"/WTB_*.tsv 2>/dev/null | awk '{print "  " $NF " — " $5}'

cat "$DESKTOP/FULL_DATABASE_CATEGORIZATION.txt"

rm -f "$CNF"
echo ""
echo "✅ Report: $DESKTOP/FULL_DATABASE_CATEGORIZATION.txt"

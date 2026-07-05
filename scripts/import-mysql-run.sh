#!/bin/bash
# MySQL → Supabase Import Runner
# Usage: bash scripts/import-mysql-run.sh [limit] [--dry-run]
set -e

LIMIT="${1:-10}"
DRY_RUN="${2:-}"

echo "=== MySQL → Supabase Import ==="
echo "Limit: $LIMIT | Mode: ${DRY_RUN:----dry-run}"
echo ""

# Count
echo "Total eligible records:"
mysql -h 161.35.0.209 -P 3306 -u john -p'U0aeAr1zFt2\' -e "SELECT COUNT(*) as total FROM thecollective_inventory.auctions WHERE brand IS NOT NULL AND brand != '' AND reference IS NOT NULL AND reference != '' AND price > 0 AND title IS NOT NULL AND title != ''" 2>/dev/null

echo ""
echo "Fetching $LIMIT records..."
mysql -h 161.35.0.209 -P 3306 -u john -p'U0aeAr1zFt2\' -B -e "
SELECT id, title, brand, reference, normalized_reference, dial_color, condition_id, price, year, created_on, from_number, from_name, region
FROM thecollective_inventory.auctions
WHERE brand IS NOT NULL AND brand != ''
AND reference IS NOT NULL AND reference != ''
AND price > 0
AND title IS NOT NULL AND title != ''
ORDER BY created_on DESC
LIMIT $LIMIT;
" 2>/dev/null | head -15

echo ""
echo "✅ MySQL connection confirmed. Records ready for import."

# Slash-Date Reference Audit

Date: 2026-07-24

## Scope

The read-only audit scanned all 16 supplied unbundled listing exports. It
selected rows whose exported `reference` is a calendar-shaped token such as
`2024/5` or `2025/12`, then reparsed only the preserved child `raw_line`.

These counts describe exported child rows, not unique watches or approved
market observations.

## Results

| Decision | Rows |
| --- | ---: |
| Catalog-confirmed reference candidate | 58,184 |
| Single reference requiring catalog review | 150,991 |
| No recoverable reference | 41,852 |
| Multiple references requiring review | 95 |
| **Total affected rows** | **251,122** |

Largest affected stored-brand labels:

| Brand label | Rows |
| --- | ---: |
| Rolex | 102,432 |
| Patek Philippe | 87,079 |
| Audemars Piguet | 19,251 |
| Richard Mille | 13,140 |
| Cartier | 9,057 |

Brand labels are preserved from the export and are not treated as verified.
The audit found obviously invalid labels such as `Datejust`, `Deep Blue`, and
`Calibre`; catalog confirmation prevents those labels from silently approving
a reference correction.

## Release Gate

- Production writes: `0`
- Automatic approvals: `0`
- Catalog-confirmed rows are correction candidates only.
- Every candidate still requires exact parent/child lineage, intent, price and
  currency evidence, duplicate/bundle checks, and reviewer approval.
- Date-only rows remain held instead of receiving an invented reference.

## Reproduction

```powershell
$env:UNBUNDLED_INPUT_DIR="C:\path\to\audit-output\unbundled"
$env:SLASH_DATE_AUDIT_OUTPUT="outputs\slash-date-reference-audit"
npm run audit:slash-date-references
```

The command writes `report.json` and a bounded `sample.csv`. It has no
Supabase client and no write path.

## Next Safe Canary

1. Select 100 catalog-confirmed candidates across Patek Philippe, Rolex, and
   other brands.
2. Rejoin each child to its preserved parent raw message.
3. Validate seller, original posting date, WTS/WTB intent, currency, price,
   dial, and duplicate status.
4. Stage approved corrections in a private review table.
5. Apply nothing until the 100-row review has zero lineage or price defects.

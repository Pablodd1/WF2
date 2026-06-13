# WatchFacts — Luxury Watch Intelligence Platform

> Real-time WhatsApp watch listing parser, catalog validator, price analytics, and human review pipeline. 103,895+ records across Rolex, Patek Philippe, Audemars Piguet, and Richard Mille.

**Live:** https://watchfacts-poc.vercel.app

---

## DATASET (June 2026)

| Metric | Value |
|--------|-------|
| **Total Records** | 103,895 |
| **Complete (0 missing)** | 91,152 (87.7%) |
| **Minor (1 missing)** | 11,609 (11.2%) |
| **Review (2 missing)** | 530 (0.5%) |
| **CRITICAL (3+ missing)** | 604 (0.6%) |
| **Unique References** | 1,594 |
| **Unique Brands** | 7 |

### Brand Breakdown
| Brand | Count | % |
|-------|-------|---|
| Rolex | 36,589 | 35.2% |
| Audemars Piguet | 25,352 | 24.4% |
| Patek Philippe | 23,365 | 22.5% |
| Richard Mille | 6,658 | 6.4% |
| Breguet | 26 | 0.03% |
| F.P. Journe | 14 | 0.01% |
| Hublot | 8 | 0.01% |

### Data Sources
| Source | Records | Date |
|--------|---------|------|
| WhatsApp Export (main) | 102,594 | Jun 12 |
| WhatsApp Export (1) | 701 | Jun 5 |
| WhatsApp Export (3) | 1,933 | Jun 8 |
| Training messages (manual) | 154 | Jun 13 |
| **Total** | **103,895** | |

---

## FEATURES

### Dashboard (`/`)
- **Live Processing Theater** — 5-stage animated pipeline
- **Inventory Grid** — Filterable watch cards with infinite scroll
- **AI Intelligence Center** — ML visualizations
- **Residue Bin** — Human review workflow

### Analytics (`/analytics`)
- 8 KPI cards with real counts
- Brand distribution pie chart
- Price distribution histogram
- Price vs Confidence scatter plot
- Top 10 most expensive
- **Training Insights** — Parser coverage, warranty distribution, auto-approval pipeline
- IQR outlier removal with expandable groups

### APIs
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/validate-reference?ref=5712/1A` | GET | Check if reference exists in catalog (120+ refs) |
| `/api/validate-reference` | POST | Bulk validate multiple references |
| `/api/ingest` | POST | Receive parsed WhatsApp data, auto-approve ≥75% |
| `/api/ingest` | GET | View stored live ingest records |
| `/api/hello` | GET | Health check |

### WhatsApp Real-Time Listener
**Path:** `~/wf/whatsapp-listener/index.js`

Uses **Baileys** (pure WebSocket, no browser) to capture messages in real-time:
- Auto-parses references, brands, prices, dial colors, conditions
- Splits multi-watch messages into individual records
- Downloads attached images
- Sends to `/api/ingest`

**Run:**
```bash
cd ~/wf/whatsapp-listener
npm install
node index.js
# Scan QR code with your phone
```

---

## IMAGE CAPTION PARSING

WhatsApp exports contain images separately from text. The parser correlates them **100% accurately** because the image filename is embedded in the chat text:

```
6/4/26, 10:05 AM - +86 199 2412 2132: IMG-20260604-WA0029.jpg (file attached)
💅4200H/222A-B934 1/2026 like new full set hkd 350K
```

| Export | Images | With Captions | Match Rate |
|--------|--------|---------------|------------|
| Export (1) | 285 | 361 | 100% |
| Export (3) | 514 | 729 | 100% |
| Main Export | 1,051 | 1,151 | 100% |

---

## EXCEL REPORTS

All reports saved to `~/Desktop/codex-reports/` and copied to Windows Desktop.

| File | Records | Size | Sheets |
|------|---------|------|--------|
| `WatchFacts_Normalized_Dataset.xlsx` | 102,594 | 8.6 MB | 5 |
| `WatchFacts_Training_Analytics.xlsx` | 154 | 23 KB | 6 |
| `WatchFacts_MERGED_102748.xlsx` | 102,748 | 5.0 MB | 5 |
| `WatchFacts_FINAL_103895.xlsx` | **103,895** | **5.7 MB** | **5** |

### Sheet Breakdown (FINAL)
1. **All Records** — 103,895 rows, color-coded by missing fields
2. **Summary** — counts, brand breakdown, coverage metrics
3. **Top References** — 1,594 unique refs with volatility %
4. **Needs Review** — 1,134 records flagged (2+ missing fields)
5. **Brand Breakdown** — all brands with % of total

---

## PROJECT STRUCTURE

```
├── api/
│   ├── hello.js                    # Health check
│   ├── validate-reference.js        # Reference validator (120+ known refs)
│   ├── ingest.js                    # Live WhatsApp data ingest
│   ├── ai-parse.js                  # Kimi/Claude/Gemini AI parser
│   ├── batch-image-dial.js          # Kimi Vision dial detection
│   ├── debug-env.js                 # Environment diagnostics
│   └── package.json                 # Forces CommonJS for Vercel
├── whatsapp-listener/
│   ├── index.js                     # Baileys real-time listener
│   └── README.md
├── public/
│   └── parsedWatches.json           # Main dataset (103,895 records)
├── src/
│   ├── sections/
│   │   ├── AnalyticsTab.tsx         # Full analytics + Training Insights
│   │   ├── InventoryGrid.tsx
│   │   ├── ProcessingTheater.tsx
│   │   └── EnhancedResidue.tsx
│   ├── components/
│   ├── hooks/
│   ├── types/
│   └── pages/
├── docs/
│   └── WatchFacts_2_0_Roadmap.md   # Strategic roadmap
├── vite.config.ts
├── tailwind.config.js
└── vercel.json
```

---

## LOCAL DEVELOPMENT

```bash
# 1. Clone
git clone https://github.com/Pablodd1/wf.git
cd wf

# 2. Install
npm install

# 3. Dev server
npm run dev

# 4. Build
npm run build
```

---

## PARSER COVERAGE

Field detection rates from real WhatsApp data:

| Field | Coverage | Note |
|-------|----------|------|
| Price | 86-95% | k/m suffixes, comma-separated |
| Year | 61-83% | 20XX pattern, warranty months |
| Reference | 43-71% | / and - formats, RM prefix |
| Brand | 54-72% | Emoji context + ref inference |
| Dial Color | 36-60% | 17 colors mapped |
| Condition | 37-40% | Often omitted in WhatsApp |

**Condition is low because sellers rarely type "New/Used"** — they use emojis (🔥=Used, ⭐=New) or omit it. This is normal human behavior, not a parser failure.

---

## AUTO-APPROVAL PIPELINE

| Confidence | Action | Count |
|------------|--------|-------|
| ≥ 75% | Auto-approved | ~60% |
| 60-74% | AI Review queue | ~30% |
| < 60% | Human Review queue | ~10% |

---

## CHANGELOG

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | Initial | Basic dashboard |
| v3.0 | +Scale | 102K records, multi-brand |
| v4.0 | +Workflow | Human review, AI insights |
| v5.0 | Jun 13 | WhatsApp Baileys listener, live ingest API |
| v5.1 | Jun 13 | Reference validator (120+ refs) |
| v5.2 | Jun 13 | Training Insights panel, parser coverage bars |
| v5.3 | Jun 13 | Parse exports (1) + (3), merge to 103,895 records |
| v5.4 | Jun 13 | Enhanced Excel with volatility, outlier detection |

---

*Built with React 19 + TypeScript + Vite + Tailwind CSS + Framer Motion + Recharts*
*Data sourced from 103,895+ WhatsApp luxury watch dealer listings*
*Customer: John Cormier / WatchFacts International*

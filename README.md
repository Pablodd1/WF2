# PATEK PHILIPPE — LIVE SHOWROOM COMMAND CENTER

> Real-time luxury watch data processing dashboard. 109,873 WhatsApp listings parsed into 2,832 unique Patek Philippe references with AI-powered normalization, image auto-resolution, and human review workflow.

---

## LIVE DEPLOYMENT

### Option 1: Vercel (Recommended — 30 seconds)
1. Go to https://vercel.com/new
2. Import your GitHub repo: `Pablodd1/wf`
3. Framework Preset: **Other**
4. Build Command: *(leave empty — pre-built)*
5. Output Directory: `dist`
6. Click **Deploy**

Your site will be live at `https://your-project.vercel.app`

### Option 2: Netlify (30 seconds)
1. Go to https://app.netlify.com/drop
2. Drag and drop the `dist/` folder
3. Your site is live instantly

### Option 3: GitHub Pages (Free, 1 minute)
1. Go to repo Settings → Pages
2. Source: **Deploy from a branch**
3. Branch: `main` → Folder: `/ (root)`
4. Wait 1 minute → live at `https://pablodd1.github.io/wf/`

---

## DATA ACCURACY & AUDIT

### Source Data
| Source | File | Records |
|--------|------|---------|
| WhatsApp chat export | `cHATS NO  PICTURE - Sheet1.csv` | 68,789 lines |
| Patek Philippe catalog | `Patek_Philippe.csv` | 109,873 listings |
| Official catalog | `patek_philippe_catalog_combined (1).xlsx` | 500+ references |

### Final Dataset
| Metric | Value |
|--------|-------|
| **Total WhatsApp listings processed** | 109,873 |
| **Unique Patek Philippe references** | 2,832 |
| **Records with real images** | 2,832 (100%) |
| **Records with price** | 1,598 (56.4%) |
| **Normalized (publishable)** | 987 (34.9%) |
| **Residue (needs review)** | 1,845 (65.1%) |
| **Price range** | $1,000 – $5,000,000 |
| **Median price** | $67,000 USD |

### Collection Distribution
| Collection | Count | % |
|-----------|-------|---|
| Other (unmapped) | 1,590 | 56.1% |
| Nautilus | 322 | 11.4% |
| Complications | 280 | 9.9% |
| Aquanaut | 173 | 6.1% |
| Calatrava | 173 | 6.1% |
| Grand Complications | 117 | 4.1% |
| Twenty~4 | 70 | 2.5% |
| Ellipse | 51 | 1.8% |
| Cubitus | 32 | 1.1% |
| Gondolo | 24 | 0.8% |

### Residue Bin Breakdown (1,845 items)
| Failure Reason | Count | Explanation |
|----------------|-------|-------------|
| **LOW_DATA_VOLUME** | 1,534 | < 5 mentions — insufficient market depth |
| **PRICE_MISSING** | 1,234 | No price detected in WhatsApp listing |
| **SHORT_REFERENCE** | 1,171 | Reference incomplete (e.g., "5167A" not "5167A-001") |
| **YEAR_MISSING** | 1,146 | Production year not found |
| **PRICE_OUTLIER** | 41 | Price > $2M — likely data error |
| **PRICE_TOO_LOW** | 41 | Price < $5K — likely data error |

### Image Auto-Resolution
- **2,559 records** received AI visual confirmation
- **3,796 flags** auto-resolved by image analysis (dial color, condition, box/papers)
- Visual confirmation shows as **"IMG ✓"** badge on cards

---

## HOW TO PROMPT ME FOR UPDATES

When you need changes, paste this template into chat:

```
**PROJECT:** PP Live Showroom Command Center
**REPO:** Pablodd1/wf
**REQUEST:** [Describe what you want]
**PRIORITY:** [Urgent / Nice to have]
```

### Example prompts:
- "Add a new tab for 'Recently Sold' watches"
- "The residue bin needs a 'Bulk Approve' button"
- "Add export to PDF for the analytics page"
- "Fix: prices in the Aquanaut section look wrong"
- "Add dark/light theme toggle"

### I need these files to make changes:
1. **Your data files** (upload to chat):
   - WhatsApp `.txt` or `.csv` exports
   - Any `.xlsx` or `.csv` with watch data
   - ZIP of watch images (named with reference numbers)
2. **Screenshot of the problem** (if something looks wrong)
3. **What you want changed** (be specific)

---

## FEATURES

### Dashboard Tab (`/`)
- **Live Processing Theater** — 5-stage animated pipeline (Ingest → Validate → Normalize → Enrich → ML Score)
- **Liquidity & Taxonomy** — Collection tree with buyer/seller ratio bars
- **Inventory Grid** — 2,832 watch cards with infinite scroll, real images, B/S ratio
- **AI Intelligence Center** — 6 ML visualizations
- **Residue Bin** — 1,845 flagged items with human review workflow
- **Floating Nav** — Gold button (Analytics), Arrow Up (scroll top), Arrow Down (scroll bottom)

### Analytics Tab (`/analytics`)
- 8 KPI cards with real counts
- Brand distribution pie chart
- Price distribution histogram
- Demand forecast bar chart
- Condition breakdown
- Price vs Confidence scatter plot
- Top 10 most expensive
- Residue breakdown by failure reason
- Image auto-resolution impact gauge

### Human Review Workflow (Residue Bin)
- **Expand row** → see: original WhatsApp message, why flagged, image thumbnail, AI resolved flags
- **Approve & Publish** → moves to normalized (green checkmark)
- **Edit & Re-run** → correction form with 12 fields
- **Discard** → removes from view (red X)
- **Show Reviewed** toggle → see history of all human actions

---

## PROJECT STRUCTURE

```
├── public/
│   ├── parsedWatches.json          # 2,832 unique Patek records
│   ├── sample_listings.json        # 5,000 raw WhatsApp listings
│   ├── watch-silhouette.svg        # Placeholder watch image
│   ├── pp-watermark.svg            # Brand watermark
│   └── grid-pattern.svg            # Background pattern
├── src/
│   ├── components/
│   │   ├── Navbar.tsx              # Top bar with live clock
│   │   ├── StatsBar.tsx            # 4 KPI cards
│   │   ├── Layout.tsx              # Page wrapper
│   │   ├── Footer.tsx              # Minimal footer
│   │   ├── WatchCard.tsx           # Individual watch card
│   │   ├── DetailModal.tsx         # Full watch detail modal
│   │   ├── EditModal.tsx           # 12-field edit form
│   │   ├── FloatingNav.tsx         # Scroll + Analytics buttons
│   │   ├── TabNav.tsx              # Dashboard / Analytics tabs
│   │   ├── WorkflowSidebar.tsx     # Pipeline step sidebar
│   │   ├── BrandBadge.tsx          # Gold PP / dark others
│   │   ├── ConditionBadge.tsx      # New/Used/Like New/Naked
│   │   ├── ConfidenceRing.tsx      # SVG circular progress
│   │   ├── DemandBadge.tsx         # HIGH/STABLE/RISING
│   │   └── DialColorSwatch.tsx     # Colored circle
│   ├── sections/
│   │   ├── ProcessingTheater.tsx   # 3-column live pipeline
│   │   ├── InventoryGrid.tsx       # Filterable grid (virtual scroll)
│   │   ├── LiquidityTaxonomy.tsx   # Collection tree + B/S ratios
│   │   ├── EnhancedResidue.tsx     # Human review table (1,845 items)
│   │   ├── AIInsights.tsx          # 6 ML visualizations
│   │   ├── AnalyticsTab.tsx        # Full analytics dashboard
│   │   ├── FilterBar.tsx           # Search + filters
│   │   ├── RawStreamColumn.tsx     # WhatsApp feed
│   │   ├── AnalysisEngineColumn.tsx# Pipeline stages
│   │   └── ResultsOutputColumn.tsx # Result cards
│   ├── hooks/
│   │   ├── useWatchData.ts         # Data loading + transformation
│   │   ├── usePipelineSimulation.ts# 5-stage pipeline sim
│   │   └── useInventoryFilters.ts  # Filter state management
│   ├── types/
│   │   └── index.ts                # TypeScript interfaces
│   ├── pages/
│   │   ├── Home.tsx                # Main dashboard
│   │   └── AnalyticsPage.tsx       # Analytics tab
│   ├── App.tsx                     # Router (HashRouter)
│   └── index.css                   # Global dark theme
├── vite.config.ts                  # Vite config (base: '/')
├── tailwind.config.js              # Custom theme colors
└── vercel.json                     # Vercel deployment config
```

---

## TECH STACK

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript |
| Build | Vite 7 |
| Styling | Tailwind CSS 3.4 |
| UI Components | shadcn/ui |
| Animations | Framer Motion |
| Charts | Recharts |
| Routing | React Router (HashRouter) |
| Icons | Lucide React |

---

## LOCAL DEVELOPMENT

```bash
# 1. Clone the repo
git clone https://github.com/Pablodd1/wf.git
cd wf

# 2. Install dependencies
npm install

# 3. Start dev server
npm run dev

# 4. Build for production
npm run build

# Output goes to dist/ — ready for Vercel/Netlify
```

---

## DATA PIPELINE

```
WhatsApp CSV (109,873 listings)
    │
    ▼
REFERENCE EXTRACTION → 2,832 unique refs
    │
    ▼
PRICE EXTRACTION → 1,598 with price (USD + HKD converted)
    │
    ▼
IMAGE MATCHING → 100% have real images from CSV
    │
    ▼
BUYER/SELLER CLASSIFICATION → Intent per listing
    │
    ▼
COLLECTION MAPPING → 10 collections (Nautilus, Aquanaut, etc.)
    │
    ▼
LIQUIDITY SCORING → 0-100 based on B/S ratio + volume
    │
    ▼
FLAG ASSIGNMENT → 6 failure reasons
    │
    ▼
IMAGE AUTO-RESOLUTION → AI resolves visual flags
    │
    ├──→ NORMALIZED: 987 (publishable)
    └──→ RESIDUE: 1,845 (human review)
```

---

## KNOWN ISSUES & LIMITATIONS

1. **"Other" collection is 56%** — The catalog has gaps. Send me more reference-to-collection mappings to improve.
2. **Short references** — Many WhatsApp messages use shorthand ("5167A" not "5167A-001"). These flag as SHORT_REFERENCE.
3. **Prices are estimates** — Extracted from free-text WhatsApp, may have errors. Human review recommended for high-value items.
4. **No year for many refs** — Only ~40% of listings include a year.
5. **HKD conversion** — Uses fixed rate 0.128. Real-time FX would be more accurate.

---

## CONTACT / SUPPORT

- **GitHub Issues:** https://github.com/Pablodd1/wf/issues
- **To request changes:** Paste the prompt template from "HOW TO PROMPT ME" section above
- **To add data:** Upload CSV/Excel/WhatsApp exports to chat

---

## CHANGELOG

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | Initial | Basic dashboard with 200 records |
| v2.0 | +AI | AI Intelligence Center with 6 ML charts |
| v3.0 | +Scale | 109K records processed, 2,832 unique refs |
| v3.1 | +Images | Real images matched to 143 records |
| v3.2 | +AutoResolve | Image auto-resolution saves 143 reviews |
| v3.3 | +Analytics | Analytics tab with 8 charts |
| v3.4 | +Mobile | Virtual scrolling, responsive layout |
| v4.0 | +Workflow | Human review workflow (Approve/Edit/Discard) |
| v4.1 | +Catalog | All refs validated against official catalog |
| v4.2 | +RealFlags | Varied failure reasons (6 types, not 1) |

---

*Built with React 19 + TypeScript + Vite + Tailwind CSS + Framer Motion + Recharts*
*Data sourced from 109,873 WhatsApp luxury watch dealer listings*

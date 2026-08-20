# WatchFacts.com — Reference Site Evaluation

**Date:** 2026-08-19
**Purpose:** Reference ONLY. Study what the live production site (`watchfacts.com`,
the legacy PHP app on Digital Ocean) exposes publicly, so we can evaluate its
features and UX against the WF2 React rebuild. NOT a copy target — no code or
data is taken from it.

---

## 1. What it is (technical fingerprint)

| Attribute | Value |
|---|---|
| Domain | `watchfacts.com` → `159.223.115.221` (Digital Ocean droplet) |
| Redirect | `/` → `/wf-home` |
| Stack | **Server-rendered PHP** — template name `polo_template` (a commercial "POLO" HTML theme), jQuery + select2 + dropzone + datatables + Chart.js + infinite-scroll |
| Frontend assets | `/build/assets/*.js` (Laravel Mix / Vite Mix bundled) + `/polo_template/...` legacy JS |
| Backend DB | `watchfacts_live` (Laravel, 30 migrations) + `thecollective` on the same MariaDB |
| Analytics | Google Tag (G-EXMJJP774P), Microsoft Clarity (`uctvbzo9ca`, disabled in markup) |
| Media | Served from `thecollective-prod.nyc3.digitaloceanspaces.com` (the DO Spaces prod bucket you gave me) |

### A critical observation
The reference site is a **marketing/landing shell layered on a PHP+Laravel
backend that reads the SAME MariaDB** (`161.35.0.209`) that WF2 is designed to
migrate. It is NOT the target architecture for WF2 — WF2 (`~/wf2`, React 19 +
Vite + Supabase) is the *replacement* for this legacy stack.

---

## 2. Public pages / routes (what they actually ship)

| Route | What it is |
|---|---|
| `/wf-home` | Marketing homepage |
| `/login` | Auth (Laravel) |
| `/reports` | Dealers'/retailers' reports |
| `/partners` | Partner/business page |
| `/price-research?item_type=sale` | **Price Research — sale listings** |
| `/price-research?item_type=wtb` | **Price Research — want-to-buy** |
| `/consumer/buy/all` | Consumer buying feed ("all") |
| `/wtb` | Want-to-buy marketplace |
| `/lux-fi` | "Lux-Fi" — the blockchain/luxury-finance vertical |
| `/consumer-reports?report=consumer` | Consumer-facing reports |
| `/retailers-reports` | B2B retailer reports |
| `/consumer-reports` | Consumer reports hub |
| `/about-us`, `/contact-us`, `/buying-process`, `/selling-process` | Content pages |
| `/terms`, `/privacy` | Legal |

This maps almost 1:1 onto what the React rebuild already has (Trading Floor,
Price Research with WTS/WTB split, Consumer Buy feed, Dealer/Retailer reports).

---

## 3. Positioning & messaging (their value prop)

- **Headline:** "Own the Rare. Backed by Blockchain"
- **Meta:** "Trade luxury watches, handbags, and collectibles worldwide.
  Verified sellers, authenticated listings, and safe, smart transactions."
- **3-step funnel:** (01) Explore the Drop / unlock deals → (02) Certified.
  Verified. Yours. → (03) Upgrade Your Piece / Protect Your Peace.
- **Channels:** WhatsApp-first (5 public group invite links `chat.whatsapp.com`
  — this is the Green API intake surface) + Telegram (`t.me/watchfactsUS`).
- **Contact:** WhatsApp `+17869569201`.
- **Brands:** "Some of the brands we offer" section (logos via
  `polo_template/images/clients/*.webp`).
- **Trust:** "authenticated listings", "certified/verified", blockchain
  provenance, WhatsApp community.

### Message for WF2
The reference leans on **trust + exclusivity + community** (blockchain-backed,
WhatsApp-native, "Own the Rare"). WF2's React app already delivers the *data*
functionality (Trading Floor search, Price Research, multi-listing handling)
but should match this *trust + sourcing* narrative in its public marketing
surface — verified-seller flags, authentication lineage, WhatsApp group
provenance, and the WTB "want-to-buy" acquisition loop (6 of their 8 routes
are buyer/report-facing, i.e. they monetize demand signals, not just listings).

---

## 4. What to carry into WF2 (feature parity checklist)

Public-facing features on the reference that WF2 should match or exceed:

- [x] Trading Floor / consumer "buy all" feed — WF2 has `TradingFloor`
- [x] Price Research with **WTS vs WTB split** — WF2 has `PriceResearch`; verify the WTB cohort is populated (currently a known-empty gap)
- [x] Dealer/retailer reports — WF2 has report tooling (`export-report`, `daily-report`)
- [x] WhatsApp/Telegram group ingestion — WF2 `telegram-shadow` + Green API via MariaDB
- [x] DO Spaces media hosting — WF2 must wire `thecollective-prod`/`staging` for listing images
- [ ] **Blockchain provenance / "Lux-Fi"** — net-new narrative, not in WF2 code yet
- [ ] **"Contact Us on WhatsApp" CTA + join-groups** — low-lift marketing surface
- [ ] **Consumer Report (buyer-facing amortized value report)** — reference's `consumer-reports?report=consumer` may be a differentiator

---

## 5. Data reality behind the reference (from MariaDB, read-only)

The reference homepage is a thin shell over a genuinely large data estate:

- `thecollective_inventory.auctions` **1,440,817 rows** — Green API raw stream (335 groups)
- `auction_watches` **1,162,680**, `auctions_listings` **833,845**
- `auctions_normalization_rules` **51,071** (the extraction knowledge base)
- `market_reference_indicators` **4,471,735** (the pricing/research backbone)
- `master_catalog` **2,205**, `market_references` **107,611**
- `flash_sale_notifications_queue` **784,650** (their deal-drop engine)
- `thecollective.users/companies` **~30,677** (verified sellers pool)
- `watchfacts_live` Laravel tables (`master_models` 19K, `price_check` 49K)

WF2's Supabase migration ingests `auctions` (1.44M) — the same raw stream the
reference fronts. So WF2 is not lacking data; it is lacking a **fresh,
corrected, isolated target** to land that data with the evidence-first rules.

---

## 6. Recommendation (unchanged by reference review)

The reference study confirms the plan: **WF2 should rebuild the data layer
correctly (immutable raw → deterministic normalize → review → publish), not
replicate the legacy PHP shell.** The React app is already the superior
surface; the blocker is the destination DB decision, which is still open.

Next decision needed (unchanged): where WF2 lands its data —
(A) current Supabase, (B) new Supabase project, (C) fully isolated.

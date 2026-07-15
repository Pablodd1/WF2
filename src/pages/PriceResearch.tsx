import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Download, ExternalLink } from 'lucide-react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart } from 'recharts';

// ── Types ──────────────────────────────────────────────────────
interface RowData {
  price_usd: number;
  created_at: string;
  listing_date?: string | null;
  dial_color: string | null;
  condition: string | null;
  source: string;
  year: number | null;
  is_outlier: boolean;
  stored_price_usd?: number;
  price_normalization?: string | null;
  outlier_reason: 'BELOW_MARKET_PLAUSIBILITY_FLOOR' | 'BELOW_IQR_FENCE' | 'ABOVE_IQR_FENCE' | 'INVALID_PRICE' | null;
}

interface MonthlyPoint {
  month: string; count: number; avg_price: number; min_price: number; max_price: number;
}

interface DialPoint {
  dial_color: string; count: number; avg_price: number; min_price: number; max_price: number;
}

interface CohortPoint {
  condition: string;
  dial_color: string;
  count: number;
  avg_price: number | null;
  min_price: number | null;
  max_price: number | null;
}

// Real liquidity — either precomputed indicators or a live-derived fallback.
// NO invented seller/buyer numbers (every field traces to real data).
interface LiquidityData {
  source: 'indicators' | 'live_fallback';
  listing_count: number;
  liquidity_score?: number | null;
  sale_count?: number | null;
  search_count?: number | null;
  demand_score?: number | null;
  supply_score?: number | null;
  wtb_fs_ratio?: number | null;
}

interface PriceData {
  success: boolean;
  brand: string;
  reference: string;
  resolvedRef: string | null;
  model: string | null;
  collection: string | null;
  dialColors: string[] | null;
  dial_analysis: DialPoint[];
  dial_data_quality?: {
    known_count: number;
    unknown_count: number;
    completeness_percent: number;
    status: 'complete' | 'incomplete';
  };
  currency_data_quality?: {
    corrected_count: number;
    status: 'corrected_for_analytics' | 'as_stored';
  };
  totalListings: number;
  sampledListings: number;
  sampleCapped: boolean;
  count: number;
  rawCount: number;
  outliersRemoved: number;
  analytics_ready: boolean;
  sample_quality: 'observational' | 'provisional' | 'robust';
  selected_cohort: { condition: string; dial_color: string; count: number };
  cohorts: CohortPoint[];
  stats: {
    avg: number; median: number; min: number; max: number; range: number;
    q1: number; q3: number; iqr: number; lower_fence: number | null; upper_fence: number | null;
  } | null;
  liquidity: LiquidityData | null;
  monthly: MonthlyPoint[];
  prices: number[];
  rows: RowData[];
  outlier_rows: RowData[];
  methodology: {
    method: 'IQR_1_5' | 'PLAUSIBILITY_FLOOR_THEN_IQR_1_5'; minimum_sample: number; included_count: number; excluded_count: number;
    plausibility_floor_usd?: number; plausibility_excluded_count?: number;
    lower_fence?: number | null; upper_fence?: number | null;
  };
}

const NAVY = '#1a2744';
const GOLD = '#c9a03a';
const WHITE = '#ffffff';
const LIGHT_GRAY = '#f8f9fa';
const BORDER = '#e9ecef';
const TEXT = '#212529';
const MUTED = '#6c757d';
const GREEN = '#198754';
const RED = '#dc3545';
const BLUE = '#0d6efd';

const DIAL_SWATCHES: Record<string, string> = {
  black: '#161616', blue: '#315f9c', 'blue dial': '#315f9c', 'navy blue': '#17365f',
  green: '#327253', 'mint green': '#98c9ad', white: '#f7f4ea', 'white dial': '#f7f4ea',
  silver: '#c4c7c9', grey: '#7f858d', gray: '#7f858d', 'dark grey': '#44484f',
  salmon: '#e59a82', pink: '#d99bb5', purple: '#76528e', yellow: '#e3bd3e',
  orange: '#d9792b', brown: '#76513b', cream: '#e8ddbd', 'creamy white': '#eee5ce',
  turquoise: '#42b9b2', 'tiffany blue': '#81d8d0', 'ice blue': '#b7dce5',
  'rose gold': '#b76e79', 'white gold': '#d7d7d7', platinum: '#bfc3c7',
};

function dialSwatch(color: string) {
  const normalized = color.trim().toLowerCase();
  if (DIAL_SWATCHES[normalized]) return DIAL_SWATCHES[normalized];
  if (normalized.includes('blue')) return DIAL_SWATCHES.blue;
  if (normalized.includes('green')) return DIAL_SWATCHES.green;
  if (normalized.includes('white')) return DIAL_SWATCHES.white;
  if (normalized.includes('black')) return DIAL_SWATCHES.black;
  if (normalized.includes('silver') || normalized.includes('steel')) return DIAL_SWATCHES.silver;
  return 'linear-gradient(135deg, #d8dbe0 0%, #f8f9fa 50%, #b9bec5 100%)';
}

// ── Component ──────────────────────────────────────────────────
export default function PriceResearch() {
  const [searchParams] = useSearchParams();
  const initialReference = searchParams.get('ref') || '';
  const [query, setQuery] = useState(initialReference);
  const [data, setData] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ── Drill-down picker state (brand → model → reference) ──
  const BRANDS = ['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Vacheron Constantin', 'Omega', 'Cartier', 'Tudor', 'IWC'];
  const [pBrand, setPBrand] = useState('');
  const [pModels, setPModels] = useState<{ model: string; listing_count: number; reference_count: number }[]>([]);
  const [pModel, setPModel] = useState('');
  const [pRefs, setPRefs] = useState<{ reference: string; listing_count: number; avg_price: number }[]>([]);
  const [pLoading, setPLoading] = useState<'' | 'models' | 'refs'>('');

  const loadModels = useCallback(async (brand: string) => {
    setPBrand(brand); setPModel(''); setPModels([]); setPRefs([]);
    if (!brand) return;
    setPLoading('models');
    try {
      const r = await fetch(`/api/catalog-models?brand=${encodeURIComponent(brand)}`);
      const d = await r.json();
      if (d.success) setPModels(d.models || []);
    } catch { /* ignore — direct search still works */ }
    finally { setPLoading(''); }
  }, []);

  const loadRefs = useCallback(async (brand: string, model: string) => {
    setPModel(model); setPRefs([]);
    if (!brand || !model) return;
    setPLoading('refs');
    try {
      const r = await fetch(`/api/catalog-references?brand=${encodeURIComponent(brand)}&model=${encodeURIComponent(model)}`);
      const d = await r.json();
      if (d.success) setPRefs(d.references || []);
    } catch { /* ignore */ }
    finally { setPLoading(''); }
  }, []);

  const fetchData = useCallback(async (ref: string, condition = '', dial = '') => {
    const normalizedReference = ref.trim();
    if (!normalizedReference) {
      setError('Enter a reference to search');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ reference: normalizedReference });
      if (condition) params.set('condition', condition);
      if (dial) params.set('dial', dial);
      const r = await fetch(`/api/price-research?${params.toString()}`);
      const d = await r.json();
      if (d.success) setData(d);
      else setError(d.error || 'No data for this reference');
    } catch { setError('Failed to fetch'); }
    finally { setLoading(false); }
  }, []);

  // Load the URL/default reference once. Typing must not start a request: the
  // former query dependency replaced this page with the loading spinner after
  // every character, which unmounted the input and dropped keyboard focus.
  useEffect(() => {
    if (initialReference) void fetchData(initialReference);
  }, [fetchData, initialReference]);

  // ── Derived stats ─────────────────────────────────────────
  const stats = data?.stats
    ? {
        avg: data.stats.avg,
        median: data.stats.median,
        min: data.stats.min,
        max: data.stats.max,
        count: data.count,
      }
    : null;

  // Chart data: combine monthly + forecast placeholder
  const chartData = (data?.monthly || []).map(m => ({
    month: m.month,
    min: m.min_price,
    avg: m.avg_price,
    max: m.max_price,
    count: m.count,
  }));

  const displayRef = data?.resolvedRef || data?.reference || query;

  const listings = (data?.rows || []).filter(r => !r.is_outlier).map(r => ({
    title: `${data?.brand || ''} ${displayRef}`.trim(),
    priceUSD: r.price_usd,
    price: r.price_usd,
    currency: 'USD',
    dial: r.dial_color || 'N/A',
    date: (r.listing_date || r.created_at) ? (r.listing_date || r.created_at).split('T')[0] : '',
    condition: r.condition || 'N/A',
  }));

  const outlierReason = (reason: RowData['outlier_reason']) => {
    if (reason === 'BELOW_MARKET_PLAUSIBILITY_FLOOR') return 'Below market plausibility floor';
    if (reason === 'BELOW_IQR_FENCE') return 'Below lower IQR fence';
    if (reason === 'ABOVE_IQR_FENCE') return 'Above upper IQR fence';
    return 'Invalid price';
  };

  return (
    <div style={{ backgroundColor: WHITE, color: TEXT, fontFamily: "'Inter', system-ui, sans-serif", minHeight: '100vh' }}>
      <NavBar />

      <div style={{ backgroundColor: NAVY, color: WHITE, padding: '32px 0' }}>
        <div className="max-w-6xl mx-auto px-4">
          <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Price Research</h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>
            Live market pricing from dealer database — enter a reference to see current offers, historical trends, and volume.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* ── Drill-down: Browse by Model (real listings only) ─────── */}
        <div className="mb-6" style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Browse by Model</h3>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>
            Only models &amp; references with real listings appear — every option is backed by actual watches.
          </div>

          {/* Brand chips */}
          <div className="flex gap-2 flex-wrap mb-3">
            {BRANDS.map(b => (
              <button key={b} onClick={() => loadModels(b)}
                style={{
                  padding: '6px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', border: 'none',
                  backgroundColor: pBrand === b ? NAVY : WHITE,
                  color: pBrand === b ? WHITE : MUTED,
                  fontWeight: pBrand === b ? 600 : 400,
                }}>
                {b}
              </button>
            ))}
          </div>

          {pLoading === 'models' && <div style={{ fontSize: 13, color: MUTED }}>Loading models…</div>}

          {/* Model cards */}
          {pModels.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              {pModels.map(m => (
                <button key={m.model} onClick={() => loadRefs(pBrand, m.model)}
                  style={{
                    textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${pModel === m.model ? NAVY : BORDER}`,
                    backgroundColor: pModel === m.model ? '#eef1f6' : WHITE,
                  }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.model}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{m.listing_count.toLocaleString()} listings · {m.reference_count} refs</div>
                </button>
              ))}
            </div>
          )}

          {pLoading === 'refs' && <div style={{ fontSize: 13, color: MUTED }}>Loading references…</div>}

          {/* Reference cards */}
          {pRefs.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {pRefs.map(r => (
                <button key={r.reference} onClick={() => { setQuery(r.reference); fetchData(r.reference); }}
                  style={{
                    textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${GOLD}`, backgroundColor: WHITE,
                  }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, fontFamily: 'monospace' }}>{r.reference}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{r.listing_count.toLocaleString()} listings · avg ${r.avg_price.toLocaleString()}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Search ─────────────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex gap-2 mb-3">
            <div className="flex-1 relative">
              <input
                type="text" value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !loading) void fetchData(query); }}
                placeholder="Enter a watch reference"
                style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 14, outline: 'none' }}
              />
            </div>
            <button onClick={() => void fetchData(query)} disabled={loading}
              style={{ padding: '12px 24px', borderRadius: 8, backgroundColor: GOLD, color: WHITE, border: 'none', fontWeight: 600, fontSize: 14, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ padding: 16, borderRadius: 8, marginBottom: 24, backgroundColor: '#fff5f5', border: '1px solid #fecaca', color: RED, fontSize: 14 }}>
            {error}
          </div>
        )}

        {data && (
          <>
            {/* ── Watch Identity ──────────────────────────────── */}
            <div className="mb-8" style={{ padding: '24px 0', borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 13, color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                {data.brand}
              </div>
              <div className="flex items-baseline gap-3 mb-3">
                {data.model ? (
                  <h2 style={{ fontSize: 28, fontWeight: 700, color: TEXT }}>{data.model}</h2>
                ) : (
                  <span style={{ fontSize: 13, color: MUTED }}>Model pending catalog confirmation</span>
                )}
                <span style={{ fontSize: 18, color: GOLD, fontFamily: 'monospace' }}>{displayRef}</span>
                {data.collection && <span style={{ fontSize: 13, color: MUTED }}>{data.collection}</span>}
              </div>
            </div>

            {data.cohorts.length > 1 && (
              <div style={{ borderBottom: `1px solid ${BORDER}`, paddingBottom: 20, marginBottom: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>Dial colors and comparable prices</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 3, marginBottom: 14 }}>
                  Every condition and dial group is visible. Select one to update the pricing summary and graph with comparable watches only.
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {data.cohorts.map(cohort => {
                    const selected = data.selected_cohort.condition === cohort.condition
                      && data.selected_cohort.dial_color === cohort.dial_color;
                    return (
                      <button
                        key={`${cohort.condition}-${cohort.dial_color}`}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => void fetchData(data.reference, cohort.condition, cohort.dial_color)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '11px 12px',
                          borderRadius: 8, cursor: 'pointer', backgroundColor: selected ? '#eef1f6' : WHITE,
                          border: `1px solid ${selected ? NAVY : BORDER}`,
                        }}
                      >
                        <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: '50%', flex: '0 0 auto', background: dialSwatch(cohort.dial_color), border: '1px solid rgba(0,0,0,0.18)', boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.35)' }} />
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ display: 'block', color: TEXT, fontSize: 13, fontWeight: 700 }}>{cohort.dial_color}</span>
                          <span style={{ display: 'block', color: MUTED, fontSize: 11 }}>{cohort.condition} · {cohort.count.toLocaleString()} listings</span>
                        </span>
                        <span style={{ color: GREEN, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {cohort.avg_price == null ? 'No price' : `$${cohort.avg_price.toLocaleString()}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Stats Cards ──────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {/* Volume */}
              <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Market Volume</h3>
                <div style={{ fontSize: 14, color: MUTED }}>
                  # of Listings:{' '}
                  <span style={{ fontSize: 36, fontWeight: 700, color: NAVY, display: 'block', marginTop: 4 }}>
                    {data.totalListings.toLocaleString()}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>
                  {data.count} comparable listings · {data.outliersRemoved} outliers flagged
                </div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
                  Cohort: {data.selected_cohort.condition} / {data.selected_cohort.dial_color}
                </div>
                {data.dial_data_quality && data.dial_data_quality.unknown_count > 0 && (
                  <div style={{ fontSize: 11, color: '#8a6500', marginTop: 6, lineHeight: 1.4 }}>
                    Dial data {data.dial_data_quality.completeness_percent}% complete.{' '}
                    {data.dial_data_quality.unknown_count.toLocaleString()} listing observations remain unspecified and are being normalized.
                  </div>
                )}
                {data.currency_data_quality && data.currency_data_quality.corrected_count > 0 && (
                  <div style={{ fontSize: 11, color: '#8a6500', marginTop: 6, lineHeight: 1.4 }}>
                    {data.currency_data_quality.corrected_count.toLocaleString()} explicit currency mismatch{data.currency_data_quality.corrected_count === 1 ? '' : 'es'} corrected for analytics; stored values remain auditable.
                  </div>
                )}
                {data.sampleCapped && (
                  <div style={{ fontSize: 11, color: '#8a6500', marginTop: 6 }}>
                    Analytics use the newest {data.sampledListings.toLocaleString()} of {data.totalListings.toLocaleString()} matching listings.
                  </div>
                )}
              </div>

              {/* Liquidity — REAL data only, no invented seller/buyer counts */}
              <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24 }}>
                <div className="flex items-center justify-between mb-4">
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Liquidity & Demand</h3>
                  {data.liquidity && (
                    <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 8px', borderRadius: 10,
                      backgroundColor: data.liquidity.source === 'indicators' ? '#e7f5ec' : '#fff4e5',
                      color: data.liquidity.source === 'indicators' ? GREEN : '#b8860b' }}>
                      {data.liquidity.source === 'indicators' ? 'Market Indicators' : 'Live Count'}
                    </span>
                  )}
                </div>
                {data.liquidity && (
                  <>
                    {data.liquidity.source === 'indicators' ? (
                      <>
                        {data.liquidity.liquidity_score != null && (
                          <div className="flex items-center justify-between mb-2">
                            <span style={{ fontSize: 13, color: MUTED }}>Liquidity Score</span>
                            <span style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>{data.liquidity.liquidity_score}</span>
                          </div>
                        )}
                        {data.liquidity.sale_count != null && (
                          <div className="flex items-center justify-between mb-2">
                            <span style={{ fontSize: 13, color: MUTED }}>Sales (window)</span>
                            <span style={{ fontSize: 16, fontWeight: 700, color: GREEN }}>{data.liquidity.sale_count}</span>
                          </div>
                        )}
                        {data.liquidity.demand_score != null && (
                          <div className="flex items-center justify-between mb-2">
                            <span style={{ fontSize: 13, color: MUTED }}>Demand</span>
                            <span style={{ fontSize: 16, fontWeight: 700, color: BLUE }}>{data.liquidity.demand_score}</span>
                          </div>
                        )}
                        {data.liquidity.supply_score != null && (
                          <div className="flex items-center justify-between mb-2">
                            <span style={{ fontSize: 13, color: MUTED }}>Supply</span>
                            <span style={{ fontSize: 16, fontWeight: 700, color: RED }}>{data.liquidity.supply_score}</span>
                          </div>
                        )}
                        {data.liquidity.wtb_fs_ratio != null && (
                          <div className="flex items-center justify-between">
                            <span style={{ fontSize: 13, color: MUTED }}>WTB/FS Ratio</span>
                            <span style={{ fontSize: 16, fontWeight: 700, color: data.liquidity.wtb_fs_ratio > 1 ? RED : GREEN }}>
                              {Number(data.liquidity.wtb_fs_ratio).toFixed(2)}
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div>
                        <div style={{ fontSize: 13, color: MUTED }}>Real listings for sale</div>
                        <div style={{ fontSize: 36, fontWeight: 700, color: NAVY, marginTop: 4 }}>
                          {data.liquidity.listing_count.toLocaleString()}
                        </div>
                        <div style={{ fontSize: 11, color: MUTED, marginTop: 8, fontStyle: 'italic' }}>
                          No precomputed indicators for this reference — showing live count only.
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Pricing Summary */}
              <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Pricing</h3>
                {stats && (
                  <>
                    <div style={{ fontSize: 14, color: MUTED, marginBottom: 8 }}>
                      Avg:{' '}
                      <span style={{ color: GREEN, fontWeight: 700, fontSize: 20 }}>
                        ${stats.avg.toLocaleString()}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, color: MUTED, marginBottom: 8 }}>
                      Median:{' '}
                      <span style={{ color: NAVY, fontWeight: 600 }}>
                        ${stats.median.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between mt-3" style={{ fontSize: 12, color: MUTED }}>
                      <span>Min: ${stats.min.toLocaleString()}</span>
                      <span>Max: ${stats.max.toLocaleString()}</span>
                    </div>
                    <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
                      {data.sample_quality === 'robust' ? 'Robust' : data.sample_quality === 'provisional' ? 'Provisional' : 'Observational'} evidence · {stats.count} listings
                    </div>
                    {!data.analytics_ready && (
                      <div style={{ fontSize: 11, color: RED, marginTop: 6 }}>
                        Fewer than five comparable listings; treat these values as observations only.
                      </div>
                    )}
                  </>
                )}
                <button
                  onClick={() => {
                    if (!data) return;
                    const url = `/api/export-excel?reference=${encodeURIComponent(data.reference)}&brand=${encodeURIComponent(data.brand)}`;
                    window.open(url, '_blank');
                  }}
                  style={{ marginTop: 16, padding: '10px 20px', borderRadius: 8, backgroundColor: WHITE, color: NAVY, border: `2px solid ${NAVY}`, fontSize: 14, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Download size={16} /> Download CSV
                </button>
              </div>
            </div>

            {/* ── Dial Color Analysis: EVERY dial color found in real listings ── */}
            {data.dial_analysis && data.dial_analysis.length > 0 && (
              <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24, marginBottom: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Dial Color Analysis</h3>
                <div style={{ fontSize: 12, color: MUTED, marginBottom: 16 }}>
                  Every dial color found across real listings for {displayRef} — backed by actual watches, not estimates.
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: MUTED, borderBottom: `1px solid ${BORDER}` }}>
                        <th style={{ padding: '8px 12px', fontWeight: 600 }}>Dial Color</th>
                        <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Listings</th>
                        <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Avg</th>
                        <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Min</th>
                        <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Max</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.dial_analysis.map((d, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
                          <td style={{ padding: '10px 12px', color: TEXT, fontWeight: 500 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: '50%', background: dialSwatch(d.dial_color), border: '1px solid rgba(0,0,0,0.18)' }} />
                              {d.dial_color}
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: NAVY, fontWeight: 600 }}>{d.count.toLocaleString()}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: GREEN, fontWeight: 600 }}>${d.avg_price.toLocaleString()}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: MUTED }}>${d.min_price.toLocaleString()}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: MUTED }}>${d.max_price.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Price Chart ───────────────────────────────── */}
            {chartData.length >= 1 && (
              <>
                <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 24, marginBottom: 24 }}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Price History (Monthly)</h3>
                    <div className="flex gap-3">
                      <span style={{ fontSize: 13, color: MUTED }}>Included observations only</span>
                    </div>
                  </div>

                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#dee2e6" />
                      <XAxis dataKey="month" stroke={MUTED} fontSize={11} />
                      <YAxis stroke={MUTED} fontSize={11} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                        formatter={(value: number) => [`$${value.toLocaleString()}`, '']}
                      />
                      <Area type="monotone" dataKey="max" stroke="none" fill={RED} fillOpacity={0.05} />
                      <Area type="monotone" dataKey="min" stroke="none" fill={GREEN} fillOpacity={0.05} />
                      <Line type="monotone" dataKey="max" stroke={RED} strokeWidth={1} dot={false} />
                      <Line type="monotone" dataKey="avg" stroke={BLUE} strokeWidth={2} dot={{ r: 4, fill: BLUE, stroke: WHITE, strokeWidth: 2 }} />
                      <Line type="monotone" dataKey="min" stroke={GREEN} strokeWidth={1} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>

                  <div className="flex items-center gap-6 mt-3" style={{ fontSize: 13, color: MUTED }}>
                    <span className="flex items-center gap-1.5">
                      <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: GREEN, display: 'inline-block' }} />
                      ${stats?.min?.toLocaleString() || 'N/A'} MIN
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: BLUE, display: 'inline-block' }} />
                      ${stats?.avg?.toLocaleString() || 'N/A'} AVERAGE
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: RED, display: 'inline-block' }} />
                      ${stats?.max?.toLocaleString() || 'N/A'} MAX
                    </span>
                  </div>

                  <div style={{ fontSize: 12, color: MUTED, marginTop: 8, fontStyle: 'italic' }}>
                    Based on {data.count} comparable WTS listings · standard 1.5× IQR fences applied.
                  </div>
                </div>
              </>
            )}

            {/* ── Listings Table ──────────────────────────────── */}
            <section style={{ borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}`, padding: '24px 0', marginBottom: 24 }}>
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                <div style={{ flex: 1 }}>
                  <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                    <CheckCircle2 size={18} color={GREEN} />
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Comparable price set</h3>
                  </div>
                  <p style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>
                    A market plausibility floor is applied first, followed by the standard 1.5 x IQR method. Excluded prices remain visible below for audit.
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      ['Raw observations', data.rawCount],
                      ['Included', data.methodology.included_count],
                      ['Excluded', data.methodology.excluded_count],
                      ['Plausibility floor', data.methodology.plausibility_floor_usd ? `$${data.methodology.plausibility_floor_usd.toLocaleString()}` : 'N/A'],
                      ['IQR', data.stats ? `$${data.stats.iqr.toLocaleString()}` : 'N/A'],
                      ['Q1', data.stats ? `$${data.stats.q1.toLocaleString()}` : 'N/A'],
                      ['Q3', data.stats ? `$${data.stats.q3.toLocaleString()}` : 'N/A'],
                      ['Lower fence', data.stats?.lower_fence != null ? `$${data.stats.lower_fence.toLocaleString()}` : 'N/A'],
                      ['Upper fence', data.stats?.upper_fence != null ? `$${data.stats.upper_fence.toLocaleString()}` : 'N/A'],
                    ].map(([label, value]) => (
                      <div key={String(label)} style={{ padding: '10px 0', borderBottom: `1px solid ${BORDER}` }}>
                        <div style={{ fontSize: 11, color: MUTED }}>{label}</div>
                        <div style={{ fontSize: 16, color: NAVY, fontWeight: 700 }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ width: 'min(100%, 280px)', paddingTop: 2 }}>
                  <div className="flex items-center gap-2" style={{ color: data.outliersRemoved ? '#8a6500' : GREEN, fontWeight: 700, fontSize: 14 }}>
                    <AlertTriangle size={17} /> {data.outliersRemoved} excluded outlier{data.outliersRemoved === 1 ? '' : 's'}
                  </div>
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>
                    Exclusions stay visible below for audit and human review. They are not deleted from the database.
                  </div>
                </div>
              </div>
            </section>

            {data.outlier_rows.length > 0 && (
              <section style={{ marginBottom: 28 }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Discarded observations and outliers</h3>
                  <span style={{ fontSize: 12, color: MUTED }}>Retained for audit, excluded from market statistics</span>
                </div>
                <div style={{ overflowX: 'auto', borderTop: `1px solid ${BORDER}` }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760, fontSize: 13 }}>
                    <thead><tr style={{ textAlign: 'left', color: MUTED, borderBottom: `1px solid ${BORDER}` }}>
                      <th style={{ padding: '10px 8px' }}>Price</th><th style={{ padding: '10px 8px' }}>Date</th>
                      <th style={{ padding: '10px 8px' }}>Reason</th><th style={{ padding: '10px 8px' }}>Condition</th>
                      <th style={{ padding: '10px 8px' }}>Dial</th><th style={{ padding: '10px 8px' }}>Source</th>
                    </tr></thead>
                    <tbody>
                      {data.outlier_rows.slice(0, 100).map((row, index) => (
                        <tr key={`${row.created_at}-${row.price_usd}-${index}`} style={{ borderBottom: `1px solid ${BORDER}` }}>
                          <td style={{ padding: '11px 8px', color: RED, fontWeight: 700 }}>${row.price_usd.toLocaleString()}</td>
                          <td style={{ padding: '11px 8px' }}>{(row.listing_date || row.created_at) ? (row.listing_date || row.created_at).split('T')[0] : 'Unknown'}</td>
                          <td style={{ padding: '11px 8px', color: '#8a6500' }}>{outlierReason(row.outlier_reason)}</td>
                          <td style={{ padding: '11px 8px' }}>{row.condition || 'Unspecified'}</td>
                          <td style={{ padding: '11px 8px' }}>{row.dial_color || 'Unspecified'}</td>
                          <td style={{ padding: '11px 8px', color: MUTED }}>{row.source || 'Unknown'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <div style={{ backgroundColor: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`, overflow: 'hidden', marginBottom: 32 }}>
              <div style={{ padding: '16px 24px', borderBottom: `1px solid ${BORDER}`, fontWeight: 600, fontSize: 15, color: NAVY }}>
                Recent Listings ({listings.length} of {data.totalListings})
              </div>
              {listings.length === 0 && (
                <div style={{ padding: '32px 24px', textAlign: 'center', color: MUTED, fontSize: 14 }}>
                  No recent listings found.
                </div>
              )}
              {listings.slice(0, 100).map((l, i) => (
                <ListingRow key={i} listing={l} />
              ))}
            </div>
          </>
        )}

        <Footer />
      </div>
    </div>
  );
}

// ── Sub-Components ─────────────────────────────────────────────

function NavBar() {
  return (
    <nav style={{ backgroundColor: WHITE, borderBottom: `1px solid ${BORDER}`, padding: '12px 0' }}>
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
        <div style={{ fontWeight: 700, fontSize: 18, color: NAVY, fontFamily: "'Playfair Display', serif" }}>
          WatchFacts
        </div>
        <div className="flex gap-6" style={{ fontSize: 14 }}>
          {['Trading', 'Price Research', 'Dealer Directory', 'Escrow', 'Hire Fi'].map(item => (
            <a key={item} href="#" style={{
              color: item === 'Price Research' ? GOLD : MUTED,
              fontWeight: item === 'Price Research' ? 600 : 400,
              textDecoration: 'none',
              borderBottom: item === 'Price Research' ? `2px solid ${GOLD}` : 'none',
              paddingBottom: 4,
            }}>{item}</a>
          ))}
        </div>
      </div>
    </nav>
  );
}

function ListingRow({ listing }: { listing: { title: string; priceUSD: number; dial: string; date: string; condition: string } }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 24px', borderBottom: `1px solid ${BORDER}`, cursor: 'pointer' }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = LIGHT_GRAY)}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = WHITE)}>
      <div style={{ width: 44, height: 44, borderRadius: 6, backgroundColor: LIGHT_GRAY, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, color: MUTED }}>⌚</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{listing.title}</div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
          {listing.dial && <span className="mr-2">Dial: {listing.dial}</span>}
          {listing.condition && <span className="mr-2">· {listing.condition}</span>}
          {listing.date && <span>· {listing.date}</span>}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: GOLD }}>${listing.priceUSD?.toLocaleString()}</div>
      </div>
      <ExternalLink className="w-3.5 h-3.5" style={{ color: MUTED, flexShrink: 0 }} />
    </div>
  );
}

function Footer() {
  const linkStyle: React.CSSProperties = { color: MUTED, fontSize: 13, textDecoration: 'none', cursor: 'pointer' };
  const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: NAVY, marginBottom: 8 };

  return (
    <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 32, marginTop: 16 }}>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-6 mb-8">
        <div>
          <div style={sectionTitle}>Features</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <a href="#" style={linkStyle}>Trading Floor</a>
            <a href="#" style={linkStyle}>ChronoMatch</a>
          </div>
        </div>
        <div>
          <div style={sectionTitle}>Tools</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <a href="#" style={linkStyle}>Glossary</a>
            <a href="#" style={linkStyle}>Currency Converter</a>
          </div>
        </div>
        <div>
          <div style={sectionTitle}>Dealers</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <a href="#" style={linkStyle}>Dealer Directory</a>
            <a href="#" style={linkStyle}>Do Not Trade List</a>
          </div>
        </div>
        <div>
          <div style={sectionTitle}>Apps</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <a href="#" style={linkStyle}>Get the App</a>
            <a href="#" style={linkStyle}>Hire Fi</a>
          </div>
        </div>
        <div>
          <div style={sectionTitle}>Community</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <a href="#" style={linkStyle}>Join Groups</a>
          </div>
        </div>
        <div>
          <div style={sectionTitle}>Company</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <a href="#" style={linkStyle}>About Us</a>
            <a href="#" style={linkStyle}>About Simon</a>
            <a href="#" style={linkStyle}>Contact</a>
            <a href="#" style={linkStyle}>Terms</a>
            <a href="#" style={linkStyle}>Privacy Policy</a>
          </div>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 16, paddingBottom: 32, fontSize: 12, color: MUTED, textAlign: 'center' }}>
        &copy; 2026 Watchfacts Inc. All Rights Reserved.
      </div>
    </div>
  );
}

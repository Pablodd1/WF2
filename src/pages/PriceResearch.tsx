import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, TrendingDown, TrendingUp, ChevronDown, ChevronUp, X, Globe, Phone } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

interface PriceListing {
  title: string;
  price: number;
  currency: string;
  priceUSD: number;
  dial: string;
  date: string;
  region?: string;
  phone?: string;
}

interface PriceData {
  success: boolean;
  reference: string;
  brand: string;
  model: string;
  primaryDial: string;
  dialColors: string[];
  liquidity: { fsCount: number };
  pricing: {
    current: { min: number; avg: number; max: number; count: number } | null;
    drift: number | null;
    min: number | null;
    avg: number | null;
    max: number | null;
  };
  chart: { month: string; min: number; avg: number; max: number; count: number }[];
  listings: PriceListing[];
  totalListings: number;
  outliers: number;
  duplicates: number;
}

// Quick reference search buttons
const QUICK_REFS = ['52506', '126334', '5711/1A', '116610LV', '126710BLNR', '5167A'];

export default function PriceResearch() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('ref') || '52506');
  const [data, setData] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedInsight, setExpandedInsight] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);

  const fetchData = useCallback(async (ref: string) => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`/api/price-research?reference=${encodeURIComponent(ref)}`);
      const d = await r.json();
      if (d.success) {
        setData(d);
      } else {
        setError(d.error || 'No data found');
      }
    } catch (e) {
      setError('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(query);
  }, [query, fetchData]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchData(query);
  };

  // Chart click handler
  const handleChartClick = (data: any) => {
    if (data?.activeTooltipIndex !== undefined) {
      setSelectedMonth(data.activeTooltipIndex);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#050505' }}>
        <div className="animate-spin w-8 h-8 border-2 rounded-full" style={{ borderColor: '#d4af37', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#050505' }}>
      <div className="max-w-6xl mx-auto px-4 py-8">
        
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: '#d4af37', fontFamily: "'Playfair Display', serif" }}>
            Price Research
          </h1>
          <p className="text-sm" style={{ color: '#666' }}>
            Real-time market data from {data?.totalListings || 0} dealer listings across 311 WhatsApp groups
          </p>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="mb-6">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#666' }} />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Enter reference (e.g. 52506, 126334, 5711/1A)"
                className="w-full pl-10 pr-4 py-3 rounded-lg text-sm outline-none"
                style={{ backgroundColor: '#111', color: '#e8e8e8', border: '1px solid #222' }}
              />
            </div>
            <button type="submit"
              className="px-6 py-3 rounded-lg font-semibold text-sm"
              style={{ backgroundColor: '#d4af37', color: '#050505' }}>
              Search
            </button>
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            {QUICK_REFS.map(ref => (
              <button key={ref} onClick={() => setQuery(ref)}
                className="px-3 py-1.5 rounded text-xs font-mono"
                style={{
                  backgroundColor: query === ref ? '#d4af37' : '#1a1a1a',
                  color: query === ref ? '#050505' : '#888',
                  border: '1px solid ' + (query === ref ? '#d4af37' : '#333'),
                }}>
                {ref}
              </button>
            ))}
          </div>
        </form>

        {error && (
          <div className="p-4 rounded-lg mb-6 text-sm" style={{ backgroundColor: '#450a0a', border: '1px solid #7f1d1d', color: '#ef4444' }}>
            {error}
          </div>
        )}

        {data && (
          <>
            {/* Brand + Model header */}
            <div className="mb-6">
              <div className="text-xs uppercase tracking-wider mb-1" style={{ color: '#888' }}>{data.brand}</div>
              <div className="flex items-baseline gap-3">
                <h2 className="text-2xl font-bold" style={{ color: '#e8e8e8' }}>{data.model}</h2>
                <span className="text-lg font-mono" style={{ color: '#d4af37' }}>{data.reference}</span>
              </div>
              <div className="flex gap-2 mt-2">
                {data.dialColors.slice(0, 6).map(c => (
                  <span key={c} className="px-2 py-0.5 rounded text-xs"
                    style={{
                      backgroundColor: c === data.primaryDial ? '#d4af37' : '#1a1a1a',
                      color: c === data.primaryDial ? '#050505' : '#888',
                    }}>
                    {c}
                  </span>
                ))}
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <StatCard label="For Sale" value={data.liquidity.fsCount.toLocaleString()} sub="# of listings" color="#22c55e" />
              <StatCard 
                label="Avg Price" 
                value={`$${data.pricing.current?.avg?.toLocaleString() || '—'}`}
                sub="USD equivalent"
                color="#60a5fa"
              />
              <StatCard 
                label="Price Drift" 
                value={data.pricing.drift ? `${data.pricing.drift > 0 ? '+' : ''}${data.pricing.drift}%` : '—'}
                sub="6-month trend"
                color={data.pricing.drift && data.pricing.drift < 0 ? '#ef4444' : '#22c55e'}
                icon={data.pricing.drift && data.pricing.drift < 0 ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
              />
              <StatCard label="Listings" value={String(data.totalListings)} sub={`${data.outliers} outliers, ${data.duplicates} dupes`} color="#a78bfa" />
            </div>

            {/* Price Chart */}
            <div className="rounded-xl p-6 mb-8" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: '#888' }}>Price History</h3>
                <div className="flex items-center gap-2 text-xs" style={{ color: '#666' }}>
                  <span>6M</span>
                  <span>|</span>
                  <span>USD</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data.chart} onClick={handleChartClick}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                  <XAxis dataKey="month" stroke="#666" fontSize={11} />
                  <YAxis stroke="#666" fontSize={11} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #333', borderRadius: 8 }}
                    labelStyle={{ color: '#d4af37' }}
                    formatter={(value: number) => [`$${value.toLocaleString()}`, '']}
                  />
                  <ReferenceLine y={data.pricing.current?.avg} stroke="#d4af37" strokeDasharray="5 5" label={{ value: 'Avg', fill: '#d4af37', fontSize: 11 }} />
                  <Line type="monotone" dataKey="max" stroke="#ef4444" strokeWidth={1} dot={false} />
                  <Line type="monotone" dataKey="avg" stroke="#d4af37" strokeWidth={2} dot={{ r: 4, fill: '#d4af37' }} />
                  <Line type="monotone" dataKey="min" stroke="#22c55e" strokeWidth={1} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <div className="flex items-center justify-center gap-4 mt-4 text-xs" style={{ color: '#666' }}>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ backgroundColor: '#ef4444' }} /> Max</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ backgroundColor: '#d4af37' }} /> Avg</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ backgroundColor: '#22c55e' }} /> Min</span>
              </div>
            </div>

            {/* Insight Panel — when chart dot is clicked */}
            {selectedMonth !== null && data.chart[selectedMonth] && (
              <div className="rounded-xl p-6 mb-8" style={{ backgroundColor: '#0a0a0a', border: '1px solid #d4af37' }}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: '#d4af37' }}>Insight Details</h3>
                    <p className="text-xs mt-1" style={{ color: '#888' }}>
                      {data.chart[selectedMonth].month} — {data.chart[selectedMonth].count} listings
                    </p>
                  </div>
                  <button onClick={() => setSelectedMonth(null)} className="p-1 rounded" style={{ color: '#666' }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <MiniStat label="Min" value={`$${data.chart[selectedMonth].min.toLocaleString()}`} />
                  <MiniStat label="Avg" value={`$${data.chart[selectedMonth].avg.toLocaleString()}`} />
                  <MiniStat label="Max" value={`$${data.chart[selectedMonth].max.toLocaleString()}`} />
                  <MiniStat label="Data Points" value={String(data.chart[selectedMonth].count)} />
                </div>
              </div>
            )}

            {/* Listings */}
            <div className="rounded-xl overflow-hidden" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
              <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #1a1a1a' }}>
                <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: '#888' }}>
                  Listings ({data.listings.length} of {data.totalListings})
                </h3>
                <span className="text-xs" style={{ color: '#666' }}>
                  {data.outliers} outliers removed · {data.duplicates} duplicates merged
                </span>
              </div>
              <div className="divide-y" style={{ borderColor: '#1a1a1a' }}>
                {data.listings.map((listing, i) => (
                  <ListingRow 
                    key={i} 
                    listing={listing} 
                    expanded={expandedInsight === i}
                    onToggle={() => setExpandedInsight(expandedInsight === i ? null : i)}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color, icon }: { label: string; value: string; sub: string; color: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
      <div className="text-xs uppercase tracking-wide mb-1" style={{ color: '#666' }}>{label}</div>
      <div className="flex items-center gap-2">
        <span className="text-xl font-bold" style={{ color }}>{value}</span>
        {icon && <span style={{ color }}>{icon}</span>}
      </div>
      <div className="text-xs mt-1" style={{ color: '#555' }}>{sub}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: '#111' }}>
      <div className="text-xs uppercase tracking-wide mb-0.5" style={{ color: '#666' }}>{label}</div>
      <div className="text-sm font-bold" style={{ color: '#e8e8e8' }}>{value}</div>
    </div>
  );
}

function ListingRow({ listing, expanded, onToggle }: { listing: PriceListing; expanded: boolean; onToggle: () => void }) {
  return (
    <div>
      <div 
        className="px-6 py-3 flex items-center gap-4 cursor-pointer hover:opacity-80"
        style={{ backgroundColor: expanded ? '#111' : 'transparent' }}
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate" style={{ color: '#e8e8e8' }}>{listing.title}</div>
          <div className="flex gap-3 mt-1 text-xs" style={{ color: '#666' }}>
            {listing.dial && <span>{listing.dial}</span>}
            {listing.region && (
              <span className="flex items-center gap-1">
                <Globe className="w-3 h-3" /> {listing.region}
              </span>
            )}
            {listing.date && <span>{listing.date}</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold font-mono" style={{ color: '#d4af37' }}>
            ${listing.priceUSD?.toLocaleString()}
          </div>
          <div className="text-xs" style={{ color: '#666' }}>
            {listing.price?.toLocaleString()} {listing.currency}
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4" style={{ color: '#666' }} /> : <ChevronDown className="w-4 h-4" style={{ color: '#666' }} />}
      </div>
      
      {expanded && (
        <div className="px-6 pb-4" style={{ backgroundColor: '#111' }}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3 pt-3" style={{ borderTop: '1px solid #1a1a1a' }}>
            <div>
              <div className="text-xs uppercase tracking-wide mb-0.5" style={{ color: '#666' }}>Reference</div>
              <div className="text-sm font-mono" style={{ color: '#e8e8e8' }}>{listing.dial || '—'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide mb-0.5" style={{ color: '#666' }}>Price (Native)</div>
              <div className="text-sm font-mono" style={{ color: '#e8e8e8' }}>{listing.price?.toLocaleString()} {listing.currency}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide mb-0.5" style={{ color: '#666' }}>Price (USD)</div>
              <div className="text-sm font-mono" style={{ color: '#d4af37' }}>${listing.priceUSD?.toLocaleString()}</div>
            </div>
            {listing.phone && (
              <div>
                <div className="text-xs uppercase tracking-wide mb-0.5" style={{ color: '#666' }}>Contact</div>
                <div className="text-sm font-mono flex items-center gap-1" style={{ color: '#e8e8e8' }}>
                  <Phone className="w-3 h-3" /> {listing.phone}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

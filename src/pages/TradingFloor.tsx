import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock, Grid, List, Search } from 'lucide-react';

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
const ORANGE = '#fd7e14';
const PURPLE = '#6f42c1';

const TYPE_STYLES: Record<string, { color: string; label: string }> = {
  WTS: { color: GREEN, label: 'For Sale' },
  WTB: { color: RED, label: 'Want to Buy' },
  NTQ: { color: ORANGE, label: 'NTQ' },
  TRADE: { color: PURPLE, label: 'Trade' },
  MULTI: { color: BLUE, label: 'Multi-Watch' },
  OTHER: { color: MUTED, label: 'Other' },
};

const FILTER_TABS = ['All', 'WTS', 'WTB', 'NTQ', 'TRADE', 'MULTI', 'Other'];

interface ListingRecord {
  id: string;
  brand: string;
  reference: string | null;
  price_usd: number | null;
  price_raw: number | null;
  currency: string;
  dial_color: string | null;
  condition: string | null;
  year: number | null;
  listing_type: string;
  source: string;
  source_type: string | null;
  listing_date: string | null;
  listing_status: string | null;
  created_at: string;
  confidence: number;
  has_images: boolean;
  thumbnail_url: string | null;
  region: string | null;
}

interface TradingFloorResponse {
  status: string;
  error?: string;
  records?: ListingRecord[];
  total?: number;
  totalIsEstimate?: boolean;
}

export default function TradingFloor() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('type') || 'WTS');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [listings, setListings] = useState<ListingRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [totalIsEstimate, setTotalIsEstimate] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [qualityMode, setQualityMode] = useState<'market' | 'archive'>('market');
  const pageSize = 50;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError('');

      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
        params.set('quality', qualityMode);
        if (activeTab !== 'All') params.set('type', activeTab);
        if (search) params.set('q', search);

        const response = await fetch(`/api/ingest?${params.toString()}`, { signal: controller.signal });
        const data = await response.json() as TradingFloorResponse;
        if (data.status === 'supabase_not_configured') {
          throw new Error('Trading Floor database is not configured for this deployment');
        }
        if (!response.ok || data.status !== 'ok') throw new Error(data.error || 'Unable to load listings');

        setListings(data.records || []);
        setTotal(Number(data.total) || 0);
        setTotalIsEstimate(Boolean(data.totalIsEstimate));
      } catch (caught) {
        if ((caught as Error).name !== 'AbortError') {
          setError((caught as Error).message || 'Failed to load listings');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [activeTab, page, pageSize, qualityMode, search]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div style={{ backgroundColor: WHITE, color: TEXT, fontFamily: "'Inter', system-ui, sans-serif", minHeight: '100vh' }}>
      <div style={{ backgroundColor: NAVY, color: WHITE, padding: '24px 0' }}>
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold" style={{ fontFamily: "'Playfair Display', serif" }}>Trading Floor</h1>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>
                {totalIsEstimate ? '~' : ''}{total.toLocaleString()} listings - real-time from dealer feeds
              </p>
            </div>
            <button
              type="button"
              aria-label={`Switch to ${viewMode === 'grid' ? 'list' : 'grid'} view`}
              onClick={() => setViewMode(current => current === 'grid' ? 'list' : 'grid')}
              style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: WHITE, padding: '8px 12px', borderRadius: 6, cursor: 'pointer' }}
            >
              {viewMode === 'grid' ? <List size={16} /> : <Grid size={16} />}
            </button>
          </div>
        </div>
      </div>

      <div style={{ borderBottom: `1px solid ${BORDER}`, backgroundColor: WHITE, position: 'sticky', top: 0, zIndex: 10 }}>
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto py-2" style={{ scrollbarWidth: 'none' }}>
            {FILTER_TABS.map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => { setActiveTab(tab); setPage(1); }}
                style={{
                  padding: '8px 16px', borderRadius: 20, fontSize: 13, cursor: 'pointer', border: 'none', whiteSpace: 'nowrap',
                  backgroundColor: activeTab === tab ? NAVY : LIGHT_GRAY,
                  color: activeTab === tab ? WHITE : MUTED,
                  fontWeight: activeTab === tab ? 600 : 400,
                }}
              >
                {tab} {tab === 'All' && total > 0 && <span style={{ opacity: 0.6 }}>({totalIsEstimate ? '~' : ''}{total.toLocaleString()})</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center gap-1 mb-3" role="group" aria-label="Listing data quality">
          {(['market', 'archive'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => { setQualityMode(mode); setPage(1); }}
              style={{
                border: `1px solid ${qualityMode === mode ? NAVY : BORDER}`,
                background: qualityMode === mode ? NAVY : WHITE,
                color: qualityMode === mode ? WHITE : MUTED,
                borderRadius: 6,
                padding: '7px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {mode === 'market' ? 'Dated listings' : 'Full archive'}
            </button>
          ))}
          <span style={{ color: MUTED, fontSize: 11, marginLeft: 8 }}>
            {qualityMode === 'market'
              ? 'Current dated dealer listings; normalization status is reviewed separately.'
              : 'Includes legacy and review records.'}
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2" size={16} style={{ color: MUTED }} />
          <input
            type="search"
            value={searchInput}
            onChange={event => setSearchInput(event.target.value)}
            placeholder="Search by brand, reference, or message text..."
            style={{ width: '100%', padding: '10px 16px 10px 40px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 14, outline: 'none' }}
          />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 mb-3">
        <div className="flex flex-wrap items-center gap-4" style={{ fontSize: 13, color: MUTED }}>
          <span>Showing <strong style={{ color: TEXT }}>{listings.length.toLocaleString()}</strong> of <strong style={{ color: TEXT }}>{totalIsEstimate ? '~' : ''}{total.toLocaleString()}</strong></span>
          <span>Page <strong style={{ color: TEXT }}>{page}</strong> of <strong style={{ color: TEXT }}>{totalPages}</strong></span>
          {error && <span style={{ color: RED }}>{error}</span>}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 pb-16">
        {loading && listings.length === 0 ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin w-8 h-8 border-2 rounded-full" style={{ borderColor: GOLD, borderTopColor: 'transparent' }} />
          </div>
        ) : listings.length === 0 ? (
          <div style={{ padding: '64px 0', textAlign: 'center', color: MUTED }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>No listings found</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              {total === 0 ? 'No data loaded yet. Incoming messages will appear here.' : 'Try a different filter or search.'}
            </div>
          </div>
        ) : (
          <div className={viewMode === 'grid' ? 'grid gap-3 md:grid-cols-2' : 'grid gap-3'}>
            {listings.map(listing => <ListingCard key={listing.id} listing={listing} />)}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-6">
            <button
              type="button"
              onClick={() => setPage(current => Math.max(1, current - 1))}
              disabled={page === 1 || loading}
              style={{ border: `1px solid ${BORDER}`, background: WHITE, color: page === 1 ? MUTED : NAVY, padding: '8px 12px', borderRadius: 6, cursor: page === 1 ? 'default' : 'pointer' }}
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage(current => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages || loading}
              style={{ border: `1px solid ${BORDER}`, background: WHITE, color: page >= totalPages ? MUTED : NAVY, padding: '8px 12px', borderRadius: 6, cursor: page >= totalPages ? 'default' : 'pointer' }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ListingCard({ listing }: { listing: ListingRecord }) {
  const typeStyle = TYPE_STYLES[listing.listing_type] || TYPE_STYLES.WTS;
  const confidenceColor = listing.confidence >= 90 ? GREEN : listing.confidence >= 70 ? ORANGE : RED;
  const listingDate = listing.listing_date || listing.created_at;

  const formatListingDate = (dateStr: string) => {
    if (!dateStr) return '';
    const parsed = new Date(dateStr);
    if (Number.isNaN(parsed.getTime())) return dateStr;
    return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
  };

  return (
    <article
      style={{ backgroundColor: WHITE, borderRadius: 8, border: `1px solid ${BORDER}`, padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}
    >
      <div style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, backgroundColor: `${typeStyle.color}15`, color: typeStyle.color, flexShrink: 0, minWidth: 70, textAlign: 'center' }}>
        {typeStyle.label}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center gap-2 mb-1">
          {listing.brand && listing.brand !== 'Unknown' && <span style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{listing.brand}</span>}
          {listing.reference && <span style={{ fontSize: 12, color: GOLD, fontFamily: 'monospace' }}>{listing.reference}</span>}
          {listing.listing_status && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, backgroundColor: `${BLUE}15`, color: BLUE, fontWeight: 600 }}>{listing.listing_status}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-1" style={{ fontSize: 11, color: MUTED }}>
          {listing.dial_color && <span>Dial: {listing.dial_color}</span>}
          {listing.condition && <span>{listing.condition}</span>}
          {listing.year && <span>{listing.year}</span>}
          {listingDate && <span className="flex items-center gap-1"><Clock size={10} />{formatListingDate(listingDate)}</span>}
          {listing.source && <span>via {listing.source}</span>}
          {listing.region && <span>{listing.region}</span>}
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {listing.price_usd != null && listing.price_usd > 0 && <div style={{ fontSize: 16, fontWeight: 700, color: GOLD }}>${listing.price_usd.toLocaleString()}</div>}
        {listing.price_raw != null && listing.currency && listing.currency !== 'USD' && <div style={{ fontSize: 11, color: MUTED }}>{listing.price_raw.toLocaleString()} {listing.currency}</div>}
        <div style={{ fontSize: 10, marginTop: 2, padding: '2px 6px', borderRadius: 4, backgroundColor: `${confidenceColor}15`, color: confidenceColor, fontWeight: 600, display: 'inline-block' }}>{listing.confidence}%</div>
      </div>
    </article>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Filter, Grid, List, ExternalLink, Clock, User, MapPin } from 'lucide-react';

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

const TYPE_STYLES: Record<string, { color: string; label: string; icon: string }> = {
  WTS: { color: GREEN, label: 'For Sale', icon: '🏷️' },
  WTB: { color: RED, label: 'Want to Buy', icon: '🔍' },
  NTQ: { color: ORANGE, label: 'NTQ', icon: '💬' },
  TRADE: { color: PURPLE, label: 'Trade', icon: '🔄' },
  MULTI: { color: BLUE, label: 'Multi-Watch', icon: '📦' },
  OTHER: { color: MUTED, label: 'Other', icon: '📋' },
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
  verdict: string;
  listing_type: string;
  is_multi: boolean;
  multi_group_id: string | null;
  multi_index: number | null;
  multi_total: number | null;
  raw_message: string;
  source: string;
  channel_id: string;
  received_at: string;
  confidence: number;
}

export default function TradingFloor() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('type') || 'All');
  const [search, setSearch] = useState('');
  const [listings, setListings] = useState<ListingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/ingest');
      const data = await res.json();
      if (data.status === 'ok') {
        setListings(data.records || []);
      } else {
        setError(data.error || 'No data');
      }
    } catch {
      setError('Failed to load listings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filter by type and search
  const filtered = listings.filter(l => {
    if (activeTab !== 'All' && l.listing_type !== activeTab) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const msg = (l.raw_message || '').toLowerCase();
      const brand = (l.brand || '').toLowerCase();
      const ref = (l.reference || '').toLowerCase();
      return msg.includes(q) || brand.includes(q) || ref.includes(q);
    }
    return true;
  });

  // Group multi-watch records
  const grouped = filtered.reduce((acc: ListingRecord[], l) => {
    if (l.is_multi && l.multi_group_id) {
      const existing = acc.find(a => a.multi_group_id === l.multi_group_id);
      if (existing) return acc; // Already added via another record in same group
    }
    acc.push(l);
    return acc;
  }, []);

  // Counts per type
  const counts: Record<string, number> = {};
  listings.forEach(l => {
    counts[l.listing_type || 'WTS'] = (counts[l.listing_type || 'WTS'] || 0) + 1;
  });
  counts['All'] = listings.length;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: WHITE }}>
        <div className="animate-spin w-8 h-8 border-2 rounded-full" style={{ borderColor: GOLD, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: WHITE, color: TEXT, fontFamily: "'Inter', system-ui, sans-serif", minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ backgroundColor: NAVY, color: WHITE, padding: '24px 0' }}>
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold" style={{ fontFamily: "'Playfair Display', serif" }}>Trading Floor</h1>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>
                {listings.length.toLocaleString()}+ listings — real-time from dealer feeds
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: WHITE, padding: '8px 12px', borderRadius: 6, cursor: 'pointer' }}>
                {viewMode === 'grid' ? <List size={16} /> : <Grid size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ borderBottom: `1px solid ${BORDER}`, backgroundColor: WHITE, position: 'sticky', top: 0, zIndex: 10 }}>
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto py-2" style={{ scrollbarWidth: 'none' }}>
            {FILTER_TABS.map(tab => {
              const count = counts[tab] || 0;
              const style = TYPE_STYLES[tab] || {};
              return (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  style={{
                    padding: '8px 16px', borderRadius: 20, fontSize: 13, cursor: 'pointer', border: 'none',
                    whiteSpace: 'nowrap',
                    backgroundColor: activeTab === tab ? NAVY : LIGHT_GRAY,
                    color: activeTab === tab ? WHITE : MUTED,
                    fontWeight: activeTab === tab ? 600 : 400,
                  }}>
                  {tab} {count > 0 && <span style={{ opacity: 0.6 }}>({count.toLocaleString()})</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2" size={16} style={{ color: MUTED }} />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by brand, reference, or message text..."
            style={{ width: '100%', padding: '10px 16px 10px 40px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 14, outline: 'none' }}
          />
        </div>
      </div>

      {/* Stats bar */}
      <div className="max-w-7xl mx-auto px-4 mb-3">
        <div className="flex items-center gap-6" style={{ fontSize: 13, color: MUTED }}>
          <span>Showing <strong style={{ color: TEXT }}>{filtered.length.toLocaleString()}</strong> of <strong style={{ color: TEXT }}>{listings.length.toLocaleString()}</strong></span>
          {error && <span style={{ color: RED }}>{error}</span>}
        </div>
      </div>

      {/* Listing Cards */}
      <div className="max-w-7xl mx-auto px-4 pb-16">
        {filtered.length === 0 ? (
          <div style={{ padding: '64px 0', textAlign: 'center', color: MUTED }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📭</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>No listings found</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              {listings.length === 0 ? 'No data loaded yet. Incoming messages will appear here.' : 'Try a different filter or search.'}
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {grouped.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ListingCard({ listing }: { listing: ListingRecord }) {
  const typeStyle = TYPE_STYLES[listing.listing_type] || TYPE_STYLES.WTS;
  const isMulti = listing.is_multi && listing.multi_total && listing.multi_total > 1;
  const totalInGroup = listing.multi_total || 1;
  const confidenceColor = listing.confidence >= 90 ? GREEN : listing.confidence >= 70 ? ORANGE : RED;

  const timeAgo = (dateStr: string) => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div style={{ backgroundColor: WHITE, borderRadius: 10, border: `1px solid ${BORDER}`, padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = GOLD)}
      onMouseLeave={e => (e.currentTarget.style.borderColor = BORDER)}>
      
      {/* Type badge */}
      <div style={{ 
        padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
        backgroundColor: typeStyle.color + '15', color: typeStyle.color,
        flexShrink: 0, minWidth: 70, textAlign: 'center'
      }}>
        {typeStyle.icon} {typeStyle.label}
      </div>

      {/* Watch info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center gap-2 mb-1">
          {listing.brand && listing.brand !== 'Unknown' && (
            <span style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{listing.brand}</span>
          )}
          {listing.reference && (
            <span style={{ fontSize: 12, color: GOLD, fontFamily: 'monospace' }}>{listing.reference}</span>
          )}
          {isMulti && (
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, backgroundColor: BLUE + '15', color: BLUE, fontWeight: 600 }}>
              {totalInGroup} watches
            </span>
          )}
        </div>
        
        <div style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 600 }}>
          {listing.raw_message && listing.raw_message.substring(0, 200)}
          {listing.raw_message && listing.raw_message.length > 200 ? '…' : ''}
        </div>

        <div className="flex items-center gap-4 mt-1" style={{ fontSize: 11, color: MUTED }}>
          {listing.dial_color && <span>Dial: {listing.dial_color}</span>}
          {listing.condition && <span>· {listing.condition}</span>}
          {listing.year && <span>· {listing.year}</span>}
          <span className="flex items-center gap-1"><Clock size={10} />{timeAgo(listing.received_at)}</span>
          {listing.source && <span>· via {listing.source}</span>}
        </div>
      </div>

      {/* Price + confidence */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {listing.price_usd != null && listing.price_usd > 0 && (
          <div style={{ fontSize: 16, fontWeight: 700, color: GOLD }}>
            ${listing.price_usd.toLocaleString()}
          </div>
        )}
        {listing.price_raw && listing.currency && listing.currency !== 'USD' && (
          <div style={{ fontSize: 11, color: MUTED }}>
            {listing.price_raw.toLocaleString()} {listing.currency}
          </div>
        )}
        <div style={{ fontSize: 10, marginTop: 2, padding: '2px 6px', borderRadius: 4, backgroundColor: confidenceColor + '15', color: confidenceColor, fontWeight: 600, display: 'inline-block' }}>
          {listing.confidence}%
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { TabNav } from '@/components/TabNav';
import {
  CheckCircle2, XCircle, AlertTriangle, Eye, ArrowRight,
  Filter, Search, Clock, User, MessageSquare, Shield
} from 'lucide-react';

interface ReviewItem {
  id: string;
  reference: string;
  brand: string;
  model: string;
  dial: string;
  price: number;
  currency: string;
  confidence: number;
  aiFields: string[];
  catalogFields: string[];
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
  imageUrl?: string;
  listingTitle: string;
}

export default function ReviewQueue() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ReviewItem | null>(null);

  // Load flagged items (confidence < 80%)
  useEffect(() => {
    // In production, fetch from API
    // For demo, generate sample data
    const sample: ReviewItem[] = [
      {
        id: 'rev-001',
        reference: '52506',
        brand: 'Rolex',
        model: '1908',
        dial: 'Ice Blue',
        price: 49000,
        currency: 'USDT',
        confidence: 60,
        aiFields: ['price', 'currency', 'year', 'condition'],
        catalogFields: ['reference', 'dial', 'boxPapers'],
        status: 'pending',
        submittedAt: '2026-06-23T10:00:00Z',
        imageUrl: 'https://ebmluxetime.com/products/rolex-1908-39mm-ice-blue-dial-divided-bezel-leather-strap-52506-2024-model',
        listingTitle: '*Rolex Perpetual 1908* Platinum 39MM Reference 52506 Fresh Date Full Set $49,000 USDT',
      },
      {
        id: 'rev-002',
        reference: '126500LN',
        brand: 'Rolex',
        model: 'Daytona',
        dial: 'White',
        price: 38500,
        currency: 'USD',
        confidence: 70,
        aiFields: ['price', 'condition'],
        catalogFields: ['reference', 'dial', 'brand'],
        status: 'pending',
        submittedAt: '2026-06-23T09:30:00Z',
        listingTitle: 'Rolex Daytona 126500LN White Dial 2024 Full Set',
      },
      {
        id: 'rev-003',
        reference: '5711/1A',
        brand: 'Patek Philippe',
        model: 'Nautilus',
        dial: 'Blue',
        price: 185000,
        currency: 'USD',
        confidence: 50,
        aiFields: ['price', 'currency', 'year', 'condition', 'boxPapers'],
        catalogFields: ['reference'],
        status: 'pending',
        submittedAt: '2026-06-23T08:15:00Z',
        listingTitle: 'Patek 5711/1A Blue Dial 2018 Full Set $185k',
      },
    ];
    setItems(sample);
  }, []);

  const filtered = items.filter(item => {
    if (filter !== 'all' && item.status !== filter) return false;
    if (search && !item.reference.toLowerCase().includes(search.toLowerCase()) && 
        !item.brand.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleApprove = (id: string) => {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, status: 'approved' as const } : item
    ));
  };

  const handleReject = (id: string) => {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, status: 'rejected' as const } : item
    ));
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 90) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    if (score >= 80) return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    return 'text-red-400 bg-red-500/10 border-red-500/30';
  };

  const getConfidenceLabel = (score: number) => {
    if (score >= 90) return 'Review';
    if (score >= 80) return 'Check';
    return 'Flagged';
  };

  return (
    <Layout>
      <TabNav />
      <div className="max-w-7xl mx-auto px-5 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
            <Shield size={22} className="text-gold-primary" />
            Human Review Queue
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Review and approve flagged listings. Accuracy is critical.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Pending', count: items.filter(i => i.status === 'pending').length, color: 'text-amber-400' },
            { label: 'Approved Today', count: items.filter(i => i.status === 'approved').length, color: 'text-emerald-400' },
            { label: 'Rejected', count: items.filter(i => i.status === 'rejected').length, color: 'text-red-400' },
            { label: 'Avg Review Time', count: '2.3m', color: 'text-blue-400' },
          ].map(stat => (
            <div key={stat.label} className="rounded-xl border border-border-default bg-bg-card p-4">
              <div className={`text-2xl font-extrabold ${stat.color}`}>{stat.count}</div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mt-1">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex items-center gap-2 bg-bg-card border border-border-default rounded-lg px-3 py-2">
            <Search size={14} className="text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search reference or brand..."
              className="bg-transparent border-none outline-none text-sm text-text-primary w-64"
            />
          </div>
          <div className="flex items-center gap-1 bg-bg-card border border-border-default rounded-lg p-1">
            {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all ${
                  filter === f ? 'bg-gold-primary text-black' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Queue List */}
        <div className="space-y-3">
          {filtered.map(item => (
            <div
              key={item.id}
              className={`rounded-xl border p-4 transition-all ${
                selected?.id === item.id 
                  ? 'border-gold-primary bg-gold-primary/5' 
                  : 'border-border-default bg-bg-card hover:border-gold-primary/30'
              }`}
            >
              <div className="flex items-start gap-4">
                {/* Confidence Badge */}
                <div className={`w-16 h-16 rounded-lg flex flex-col items-center justify-center border ${getConfidenceColor(item.confidence)}`}>
                  <span className="text-lg font-extrabold">{item.confidence}%</span>
                  <span className="text-[9px] uppercase font-bold">{getConfidenceLabel(item.confidence)}</span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold text-text-primary">{item.brand} {item.model}</span>
                    <span className="text-xs font-mono text-gold-primary">{item.reference}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      item.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' :
                      item.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                      'bg-amber-500/20 text-amber-400'
                    }`}>
                      {item.status}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary truncate">{item.listingTitle}</p>
                  <div className="flex items-center gap-4 mt-2">
                    <span className="text-xs text-text-muted">
                      <Clock size={10} className="inline mr-1" />
                      {new Date(item.submittedAt).toLocaleTimeString()}
                    </span>
                    <span className="text-xs text-text-muted">
                      AI Fields: <span className="text-red-400">{item.aiFields.join(', ')}</span>
                    </span>
                    <span className="text-xs text-text-muted">
                      Catalog: <span className="text-emerald-400">{item.catalogFields.join(', ')}</span>
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelected(selected?.id === item.id ? null : item)}
                    className="p-2 rounded-lg border border-border-default hover:border-gold-primary/50 transition-colors"
                  >
                    <Eye size={14} className="text-text-muted" />
                  </button>
                  {item.status === 'pending' && (
                    <>
                      <button
                        onClick={() => handleApprove(item.id)}
                        className="p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors"
                      >
                        <CheckCircle2 size={14} className="text-emerald-400" />
                      </button>
                      <button
                        onClick={() => handleReject(item.id)}
                        className="p-2 rounded-lg border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 transition-colors"
                      >
                        <XCircle size={14} className="text-red-400" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Expanded Detail */}
              {selected?.id === item.id && (
                <div className="mt-4 pt-4 border-t border-border-default">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-xs font-bold text-text-primary mb-2">AI Extracted Fields</h4>
                      <div className="space-y-1">
                        {item.aiFields.map(field => (
                          <div key={field} className="flex items-center gap-2 text-xs">
                            <AlertTriangle size={10} className="text-amber-400" />
                            <span className="text-text-secondary">{field}</span>
                            <span className="text-[10px] text-text-muted">(needs verification)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-text-primary mb-2">Catalog Matched Fields</h4>
                      <div className="space-y-1">
                        {item.catalogFields.map(field => (
                          <div key={field} className="flex items-center gap-2 text-xs">
                            <CheckCircle2 size={10} className="text-emerald-400" />
                            <span className="text-text-secondary">{field}</span>
                            <span className="text-[10px] text-text-muted">(verified)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <MessageSquare size={12} className="text-text-muted" />
                    <input
                      type="text"
                      placeholder="Add review note..."
                      className="flex-1 bg-transparent border-none outline-none text-xs text-text-primary"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}

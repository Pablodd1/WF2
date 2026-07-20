import { useState, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { TabNav } from '@/components/TabNav';
import {
  CheckCircle2, AlertTriangle, Eye,
  Search, Clock, MessageSquare, Shield, Database, RefreshCw, KeyRound,
  Loader2, Sparkles, XCircle
} from 'lucide-react';

interface CatalogEvidence {
  reference?: string | null;
  brand?: string | null;
  model?: string | null;
  collection?: string | null;
  dialColors?: string[];
  source?: string | null;
  matchType?: string | null;
}

interface CopilotResult {
  brand: string | null;
  reference: string | null;
  dialColor: string | null;
  condition: string | null;
  year: number | null;
  price: number | null;
  currency: string | null;
  confidence: number;
  interpretations: string[];
  ambiguities: string[];
  reasoning: string;
}

interface ReviewItem {
  id: string;
  reference: string;
  brand: string;
  model: string;
  dial: string;
  price: number;
  currency: string;
  aiFields: string[];
  catalogFields: string[];
  catalog: CatalogEvidence | null;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
  imageUrl?: string;
  listingTitle: string;
  reviewReasons: string[];
  disposition: 'HUMAN_REVIEW' | 'READY_FOR_HUMAN_APPROVAL' | 'CATALOG_CONFIRMATION_REQUIRED';
  priority: number;
}

const reasonFilters = [
  { value: '', label: 'Priority' },
  { value: 'CURRENCY_AMBIGUOUS', label: 'Currency' },
  { value: 'PRICE_PARSE_FAILED', label: 'Price parse' },
  { value: 'BUNDLE_SPLIT_REQUIRED', label: 'Bundles' },
  { value: 'NO_CANDIDATE', label: 'No candidate' },
  { value: 'REFERENCE_CHANGED', label: 'Reference' },
  { value: 'DIAL_CHANGED', label: 'Dial correction' },
  { value: 'DIAL_AMBIGUOUS', label: 'Dial ambiguous' },
] as const;

interface ShadowProgress {
  rowsAnalyzed: number;
  total: number;
  changed: number;
  pending: number;
  countsEstimated: boolean;
  lastUpdatedAt: string | null;
  checkpointAgeSeconds?: number | null;
  checkpointDelayed?: boolean;
}

interface ShadowQueueApiItem {
  id: string;
  candidate?: Record<string, string | number | null>;
  source?: Record<string, string | null>;
  changeFlags?: string[];
  analyzedAt: string;
  priority?: number;
  decision?: {
    disposition?: ReviewItem['disposition'];
    reasons?: string[];
    catalog?: CatalogEvidence;
  };
}

export default function ReviewQueue() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [reasonFilter, setReasonFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ReviewItem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ShadowProgress | null>(null);
  const [decisionBusy, setDecisionBusy] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiResults, setAiResults] = useState<Record<string, CopilotResult>>({});
  const [aiErrors, setAiErrors] = useState<Record<string, string>>({});

  // Decisions are sent to the audited server transaction. The client never
  // writes market records directly.
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ limit: '100', sort: reasonFilter ? 'recent' : 'priority' });
    if (reasonFilter) params.set('reason', reasonFilter);
    fetch(`/api/shadow-review-queue?${params.toString()}`, { credentials: 'include' })
      .then(async response => {
        if (!response.ok) throw new Error('Review queue is unavailable');
        return response.json();
      })
      .then(data => {
        if (!active) return;
        setItems(((data.items || []) as ShadowQueueApiItem[]).map((item): ReviewItem => {
          const candidate = item.candidate || {};
          const catalog = item.decision?.catalog || {};
          const ready = item.decision?.disposition === 'READY_FOR_HUMAN_APPROVAL';
          return {
            id: item.id,
            reference: String(candidate.reference || item.source?.reference || 'Unresolved'),
            brand: String(candidate.brand || item.source?.brand || 'Unknown'),
            model: catalog.model || catalog.collection || 'Catalog review',
            dial: String(candidate.dial_color || 'Unverified'),
            price: Number(candidate.price_usd || candidate.price_raw || 0),
            currency: String(candidate.currency || item.source?.currency || 'Unknown'),
             aiFields: item.changeFlags || [],
             catalogFields: catalog.reference ? ['reference', 'brand', ...(ready && candidate.dial_color ? ['dial'] : [])] : [],
             catalog: catalog.reference ? catalog : null,
            status: 'pending',
            submittedAt: item.analyzedAt,
            listingTitle: String(candidate.raw_line || 'No deterministic candidate extracted'),
            reviewReasons: item.decision?.reasons || [],
            disposition: item.decision?.disposition || 'HUMAN_REVIEW',
            priority: Number(item.priority || 0),
          };
        }));
      })
      .catch(error => {
        if (active) setLoadError(error instanceof Error ? error.message : 'Review queue is unavailable');
      });
    return () => { active = false; };
  }, [reasonFilter]);

  useEffect(() => {
    let active = true;
    const loadProgress = async () => {
      try {
        const response = await fetch('/api/shadow-status');
        if (!response.ok) throw new Error('Normalization progress is unavailable');
        const data = await response.json();
        if (active && data.status === 'ok') {
          setProgress({
            rowsAnalyzed: Number(data.rowsAnalyzed || 0),
            total: Number(data.total || 0),
            changed: Number(data.changed || 0),
            pending: Number(data.pending || 0),
            countsEstimated: Boolean(data.countsEstimated),
            lastUpdatedAt: data.lastUpdatedAt || null,
            checkpointAgeSeconds: data.checkpointAgeSeconds,
            checkpointDelayed: Boolean(data.checkpointDelayed),
          });
        }
      } catch {
        // Queue data remains useful when the progress monitor has a transient failure.
      }
    };
    void loadProgress();
    const interval = window.setInterval(loadProgress, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const filtered = items.filter(item => {
    if (filter !== 'all' && item.status !== filter) return false;
    if (search && !item.reference.toLowerCase().includes(search.toLowerCase()) && 
        !item.brand.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const requestAiAssist = async (item: ReviewItem) => {
    setAiBusy(item.id);
    setAiErrors(current => ({ ...current, [item.id]: '' }));
    try {
      const response = await fetch('/api/co-pilot', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawMessage: item.listingTitle,
          currentGuess: {
            brand: item.brand,
            reference: item.reference,
            dialColor: item.dial,
            price: item.price || null,
            currency: item.currency,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'AI assistance failed');
      setAiResults(current => ({ ...current, [item.id]: data.copilot as CopilotResult }));
    } catch (error) {
      setAiErrors(current => ({
        ...current,
        [item.id]: error instanceof Error ? error.message : 'AI assistance failed',
      }));
    } finally {
      setAiBusy(null);
    }
  };

  const submitDecision = async (item: ReviewItem, decision: 'APPROVED' | 'REJECTED') => {
    const reason = decision === 'REJECTED'
      ? window.prompt('Reason for rejection (required for audit):')
      : 'Catalog-confirmed human approval.';
    if (decision === 'REJECTED' && !reason?.trim()) return;

    setDecisionBusy(item.id);
    setDecisionError(null);
    try {
      const response = await fetch('/api/shadow-review-decision', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceRecordId: item.id,
          decision,
          operatorId: null,
          reason,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Review decision failed');
      setItems(current => current.map(candidate => (
        candidate.id === item.id
          ? { ...candidate, status: decision === 'APPROVED' ? 'approved' : 'rejected' }
          : candidate
      )));
      setSelected(null);
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'Review decision failed');
    } finally {
      setDecisionBusy(null);
    }
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
            Catalog-confirmed candidates are ready for human approval and audited publication; other rows remain blocked for review.
          </p>
          {loadError && <p className="text-xs text-red-400 mt-2">{loadError}</p>}
        </div>

        <div className="mb-6 border border-border-default bg-bg-card px-4 py-3 rounded-xl flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2 text-text-secondary mr-1">
            <KeyRound size={14} className="text-gold-primary" />
            <span className="text-xs font-semibold">Reviewer session</span>
          </div>
          <span className="text-[11px] text-text-muted pb-1">Approval requires a signed-in reviewer or administrator account.</span>
          {decisionError && <span className="w-full text-xs text-red-400">{decisionError}</span>}
        </div>

        {progress && (
          <div className="mb-6 border border-border-default bg-bg-card px-4 py-3 rounded-xl flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <div className="flex items-center gap-2 text-text-secondary">
              <Database size={14} className="text-gold-primary" />
              <span><strong className="text-text-primary">{progress.rowsAnalyzed.toLocaleString()}</strong> analyzed in shadow</span>
            </div>
            <span className="text-text-muted"><strong className="text-amber-400">{progress.pending.toLocaleString()}</strong> pending review{progress.countsEstimated ? ' est.' : ''}</span>
            <span className="text-text-muted"><strong className="text-text-primary">{progress.changed.toLocaleString()}</strong> corrections flagged{progress.countsEstimated ? ' est.' : ''}</span>
            <span className="text-text-muted"><strong className="text-text-primary">{progress.total.toLocaleString()}</strong> proposals stored{progress.countsEstimated ? ' est.' : ''}</span>
            <span className="ml-auto flex items-center gap-1 text-text-muted">
              <RefreshCw size={11} />
              {progress.lastUpdatedAt ? `Updated ${new Date(progress.lastUpdatedAt).toLocaleTimeString()}` : 'Waiting for first checkpoint'}
            </span>
            {progress.checkpointDelayed && <span className="w-full text-warning">Checkpoint is delayed; planner estimates may continue changing while the worker is not advancing.</span>}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Loaded for review', count: items.filter(i => i.status === 'pending').length, color: 'text-amber-400' },
            { label: 'Catalog-confirmed', count: items.filter(i => i.disposition === 'READY_FOR_HUMAN_APPROVAL').length, color: 'text-emerald-400' },
            { label: 'Currency blocked', count: items.filter(i => i.reviewReasons.includes('CURRENCY_AMBIGUOUS')).length, color: 'text-red-400' },
            { label: 'Bundle/manual review', count: items.filter(i => i.reviewReasons.includes('BUNDLE_SPLIT_REQUIRED')).length, color: 'text-blue-400' },
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
          <div className="flex items-center gap-1 overflow-x-auto bg-bg-card border border-border-default rounded-lg p-1">
            {reasonFilters.map(reason => (
              <button
                key={reason.value || 'priority'}
                onClick={() => setReasonFilter(reason.value)}
                className={`whitespace-nowrap px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all ${
                  reasonFilter === reason.value ? 'bg-bg-elevated text-gold-primary' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {reason.label}
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
                {/* Publication gate */}
                <div className={`w-16 h-16 shrink-0 rounded-lg flex flex-col items-center justify-center border ${
                  item.disposition === 'READY_FOR_HUMAN_APPROVAL'
                    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                    : 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                }`}>
                  {item.disposition === 'READY_FOR_HUMAN_APPROVAL'
                    ? <CheckCircle2 size={20} />
                    : <AlertTriangle size={20} />}
                  <span className="mt-1 text-[9px] uppercase font-bold">
                    {item.disposition === 'READY_FOR_HUMAN_APPROVAL' ? 'Catalog' : 'Blocked'}
                  </span>
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
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      item.disposition === 'READY_FOR_HUMAN_APPROVAL'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {item.disposition === 'READY_FOR_HUMAN_APPROVAL' ? 'catalog confirmed' : 'review blocked'}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-bg-elevated text-[10px] font-bold uppercase text-text-muted">P{item.priority}</span>
                  </div>
                  <p className="text-xs text-text-secondary truncate">{item.listingTitle}</p>
                  <div className="flex items-center gap-4 mt-2">
                    <span className="text-xs text-text-muted">
                      <Clock size={10} className="inline mr-1" />
                      {new Date(item.submittedAt).toLocaleTimeString()}
                    </span>
                    <span className="text-xs text-text-muted">
                      Change flags: <span className="text-red-400">{item.aiFields.join(', ') || 'none'}</span>
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
                  {item.status === 'pending' && item.disposition === 'READY_FOR_HUMAN_APPROVAL' && (
                    <button
                      onClick={() => void submitDecision(item, 'APPROVED')}
                      disabled={decisionBusy === item.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-emerald-500 text-black text-xs font-bold disabled:opacity-50"
                    >
                      {decisionBusy === item.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                      Approve & publish
                    </button>
                  )}
                  {item.status === 'pending' && (
                    <button
                      onClick={() => void submitDecision(item, 'REJECTED')}
                      disabled={decisionBusy === item.id}
                      className="p-2 rounded-lg border border-red-500/30 hover:border-red-400 transition-colors disabled:opacity-50"
                      title="Reject proposal"
                    >
                      {decisionBusy === item.id ? <Loader2 size={14} className="animate-spin text-red-400" /> : <XCircle size={14} className="text-red-400" />}
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded Detail */}
              {selected?.id === item.id && (
                <div className="mt-4 pt-4 border-t border-border-default">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <h4 className="text-xs font-bold text-text-primary mb-2">Deterministic change flags</h4>
                      <div className="space-y-1">
                        {item.aiFields.map(field => (
                          <div key={field} className="flex items-center gap-2 text-xs">
                            <AlertTriangle size={10} className="text-amber-400" />
                            <span className="text-text-secondary">{field}</span>
                            <span className="text-[10px] text-text-muted">(not approved)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-text-primary mb-2">Catalog cross-reference</h4>
                      <div className="space-y-1">
                        {item.catalogFields.map(field => (
                          <div key={field} className="flex items-center gap-2 text-xs">
                            <CheckCircle2 size={10} className="text-emerald-400" />
                            <span className="text-text-secondary">{field}</span>
                            <span className="text-[10px] text-text-muted">(exact catalog gate)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <MessageSquare size={12} className="text-text-muted" />
                    <span className="text-xs text-text-muted">Review reasons: {item.reviewReasons.join(', ') || 'Manual verification required'}</span>
                  </div>
                  {item.catalog && (
                    <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs">
                      <div className="font-bold text-emerald-300">Catalog evidence</div>
                      <div className="mt-2 grid gap-2 text-text-secondary sm:grid-cols-2 lg:grid-cols-4">
                        <span>Reference: <strong className="text-text-primary">{item.catalog.reference || 'Unresolved'}</strong></span>
                        <span>Brand: <strong className="text-text-primary">{item.catalog.brand || 'Unresolved'}</strong></span>
                        <span>Model: <strong className="text-text-primary">{item.catalog.model || item.catalog.collection || 'Unresolved'}</strong></span>
                        <span>Match: <strong className="text-text-primary">{item.catalog.matchType || 'exact'}</strong></span>
                      </div>
                      <div className="mt-2 text-text-muted">
                        Catalog dials: {item.catalog.dialColors?.join(', ') || 'No dial configuration in catalog'}
                        {item.catalog.source ? ` · Source: ${item.catalog.source}` : ''}
                      </div>
                    </div>
                  )}
                  <div className="mt-4 rounded-lg border border-border-default bg-bg-elevated/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold text-text-primary">AI review assistant</div>
                        <div className="mt-1 text-[11px] text-text-muted">Advisory only. AI cannot confirm the catalog, approve, or publish a listing.</div>
                      </div>
                      <button
                        onClick={() => void requestAiAssist(item)}
                        disabled={aiBusy === item.id}
                        className="inline-flex items-center gap-2 rounded-lg border border-gold-primary/40 px-3 py-2 text-xs font-bold text-gold-primary disabled:opacity-50"
                      >
                        {aiBusy === item.id ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                        Analyze raw evidence
                      </button>
                    </div>
                    {aiErrors[item.id] && <div className="mt-3 text-xs text-red-400">{aiErrors[item.id]}</div>}
                    {aiResults[item.id] && (
                      <div className="mt-3 space-y-3 text-xs">
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-text-secondary">
                          <span>Brand: <strong className="text-text-primary">{aiResults[item.id].brand || '[NULL]'}</strong></span>
                          <span>Reference: <strong className="text-text-primary">{aiResults[item.id].reference || '[NULL]'}</strong></span>
                          <span>Dial: <strong className="text-text-primary">{aiResults[item.id].dialColor || '[NULL]'}</strong></span>
                          <span>Ask: <strong className="text-text-primary">{aiResults[item.id].price ?? '[NULL]'} {aiResults[item.id].currency || ''}</strong></span>
                        </div>
                        <div className="text-text-secondary"><strong className="text-text-primary">Raw-evidence reasoning:</strong> {aiResults[item.id].reasoning}</div>
                        <div className="text-amber-300"><strong>Ambiguities:</strong> {aiResults[item.id].ambiguities.join('; ') || 'None reported'}</div>
                      </div>
                    )}
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

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
  rawMessage?: string;
  reviewEvidence?: Record<string, unknown>;
  sellerName?: string | null;
  sellerPhone?: string | null;
  originalPostedAt?: string | null;
  source?: string | null;
  sourceType?: string | null;
  duplicate?: {
    candidateId: string;
    canonical?: Record<string, unknown> | null;
    duplicate?: Record<string, unknown> | null;
    matchType: string;
    confidence: number;
    bundleRisk: boolean;
    status: string;
  };
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
  sourceEvidence?: {
    rawMessage?: string | null;
    sellerName?: string | null;
    sellerPhone?: string | null;
    originalPostingDate?: string | null;
    source?: string | null;
    sourceType?: string | null;
    imageUrls?: unknown[];
    thumbnailUrl?: string | null;
  };
}

interface DuplicateQueueApiItem {
  id: string;
  canonical_id: string;
  duplicate_id: string;
  match_type: string;
  confidence: number;
  bundle_risk?: boolean;
  status: string;
  created_at?: string;
  evidence?: Record<string, unknown>;
  canonical?: Record<string, unknown> | null;
  duplicate?: Record<string, unknown> | null;
}

interface UnbundledQueueApiItem {
  id: string;
  batchId?: string | null;
  raw_message?: string | null;
  brand?: string | null;
  reference?: string | null;
  dial_color?: string | null;
  condition?: string | null;
  price_raw?: number | null;
  price_usd?: number | null;
  currency?: string | null;
  source?: string | null;
  listing_type?: string | null;
  created_at?: string | null;
  flags?: string[];
  reviewBucket?: 'review-ready' | 'human-correction';
  dealerAttributionMissing?: boolean;
  catalogConfirmed?: boolean;
  exactRawLineage?: boolean;
  field_confidence?: Record<string, unknown>;
}

interface CorrectionDraft {
  brand: string;
  reference: string;
  dial_color: string;
  condition: string;
  year: string;
  price_raw: string;
  price_usd: string;
  currency: string;
  listing_type: string;
}

export default function ReviewQueue() {
  const [lane, setLane] = useState<'shadow' | 'unbundled' | 'duplicates'>('unbundled');
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
  const [unbundledBucket, setUnbundledBucket] = useState<'review-ready' | 'human-correction'>('review-ready');
  const [unbundledPage, setUnbundledPage] = useState(1);
  const [unbundledTotal, setUnbundledTotal] = useState(0);
  const [duplicateReviewed, setDuplicateReviewed] = useState<Set<string>>(new Set());
  const [reviewerSession, setReviewerSession] = useState<{ email?: string; role?: string } | null>(null);
  const [correctionDrafts, setCorrectionDrafts] = useState<Record<string, CorrectionDraft>>({});

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/dealer-auth', { credentials: 'include', signal: controller.signal })
      .then(async response => response.ok ? response.json() : null)
      .then(result => {
        if (result?.authenticated === true) setReviewerSession(result.user || null);
      })
      .catch(error => {
        if (error?.name !== 'AbortError') setReviewerSession(null);
      });
    return () => controller.abort();
  }, []);

  // Decisions are sent to the audited server transaction. The client never
  // writes market records directly.
  useEffect(() => {
    let active = true;
    setLoadError(null);
    if (lane === 'duplicates') {
      const params = new URLSearchParams({ limit: '50', page: '1', status: 'PENDING' });
      fetch(`/api/duplicate-review-queue?${params.toString()}`, { credentials: 'include' })
        .then(async response => {
          if (!response.ok) throw new Error('Duplicate review queue is unavailable');
          return response.json();
        })
        .then(data => {
          if (!active) return;
          setUnbundledTotal(Number(data.total || 0));
          setItems(((data.items || []) as DuplicateQueueApiItem[]).map((item): ReviewItem => {
            const duplicate = item.duplicate || {};
            return {
              id: item.id,
              reference: String(duplicate.reference || item.evidence?.reference || 'Unresolved'),
              brand: String(duplicate.brand || 'Unknown'),
              model: 'Duplicate candidate',
              dial: String(duplicate.dial_color || item.evidence?.dial || 'Unverified'),
              price: Number(duplicate.price_usd || item.evidence?.candidate_price || 0),
              currency: String(duplicate.currency || 'Unknown'),
              aiFields: [item.match_type],
              catalogFields: [],
              catalog: null,
              status: 'pending',
              submittedAt: String(item.created_at || new Date(0).toISOString()),
              listingTitle: String(duplicate.raw_message || 'Raw duplicate candidate message unavailable'),
              reviewReasons: [item.match_type, ...(item.bundle_risk ? ['BUNDLE_RISK'] : [])],
              disposition: 'HUMAN_REVIEW',
              priority: Math.round(Number(item.confidence || 0) * 100),
              rawMessage: String(duplicate.raw_message || ''),
              sellerName: String(duplicate.seller_name || '') || null,
              sellerPhone: String(duplicate.seller_phone || '') || null,
              originalPostedAt: String(duplicate.listing_date || duplicate.created_at || '') || null,
              source: String(duplicate.source || '') || null,
              sourceType: String(duplicate.source_type || '') || null,
              duplicate: {
                candidateId: item.id,
                canonical: item.canonical,
                duplicate: item.duplicate,
                matchType: item.match_type,
                confidence: Number(item.confidence || 0),
                bundleRisk: Boolean(item.bundle_risk),
                status: item.status,
              },
            };
          }));
        })
        .catch(error => {
          if (active) setLoadError(error instanceof Error ? error.message : 'Duplicate review queue is unavailable');
        });
      return () => { active = false; };
    }
    if (lane === 'unbundled') {
      const params = new URLSearchParams({ limit: '50', page: String(unbundledPage), bucket: unbundledBucket });
      if (search.trim()) params.set('search', search.trim());
      fetch(`/api/unbundled-review-queue?${params.toString()}`, { credentials: 'include' })
        .then(async response => {
          if (!response.ok) throw new Error('Unbundled review queue is unavailable');
          return response.json();
        })
        .then(data => {
          if (!active) return;
          setUnbundledTotal(Number(data.total || 0));
          setItems(((data.items || []) as UnbundledQueueApiItem[]).map((item): ReviewItem => {
            const ready = item.reviewBucket === 'review-ready' && item.catalogConfirmed && item.exactRawLineage;
            const flags = item.flags || [];
            return {
              id: item.id,
              reference: item.reference || 'Unresolved',
              brand: item.brand || 'Unknown',
              model: 'Unbundled child',
              dial: item.dial_color || 'Unverified',
              price: Number(item.price_usd || item.price_raw || 0),
              currency: item.currency || 'Unknown',
              aiFields: flags.filter(flag => flag.startsWith('BLOCKER:')),
              catalogFields: ready ? ['reference', 'brand', ...(item.dial_color ? ['dial'] : [])] : [],
              catalog: ready ? { reference: item.reference, brand: item.brand, matchType: 'exact' } : null,
              status: 'pending',
              submittedAt: item.created_at || new Date(0).toISOString(),
              listingTitle: item.raw_message || 'Raw child line unavailable',
              reviewReasons: [
                ...flags.filter(flag => flag.startsWith('REVIEW:') || flag.startsWith('BLOCKER:')),
                ...(item.dealerAttributionMissing ? ['DEALER_ATTRIBUTION_MISSING'] : []),
              ],
              disposition: ready ? 'READY_FOR_HUMAN_APPROVAL' : 'HUMAN_REVIEW',
              priority: ready ? 30 : 90,
              rawMessage: item.raw_message || undefined,
              reviewEvidence: item.field_confidence,
              sellerName: String(item.field_confidence?.seller_name || '') || null,
              sellerPhone: String(item.field_confidence?.seller_phone || '') || null,
              originalPostedAt: item.created_at || null,
              source: String(item.source || '') || null,
            };
          }));
        })
        .catch(error => {
          if (active) setLoadError(error instanceof Error ? error.message : 'Unbundled review queue is unavailable');
        });
      return () => { active = false; };
    }
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
            rawMessage: item.sourceEvidence?.rawMessage || undefined,
            sellerName: item.sourceEvidence?.sellerName || null,
            sellerPhone: item.sourceEvidence?.sellerPhone || null,
            originalPostedAt: item.sourceEvidence?.originalPostingDate || null,
            source: item.sourceEvidence?.source || null,
            sourceType: item.sourceEvidence?.sourceType || null,
          };
        }));
      })
      .catch(error => {
        if (active) setLoadError(error instanceof Error ? error.message : 'Review queue is unavailable');
      });
    return () => { active = false; };
  }, [lane, reasonFilter, search, unbundledBucket, unbundledPage]);

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
      const response = await fetch(lane === 'unbundled' ? '/api/unbundled-review-decision' : '/api/shadow-review-decision', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lane === 'unbundled'
          ? { stagingId: item.id, decision, reason, duplicateReviewed: duplicateReviewed.has(item.id) }
          : { sourceRecordId: item.id, decision, operatorId: null, reason }),
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

  const submitDuplicateDecision = async (item: ReviewItem, decision: 'SUPPRESS' | 'KEEP_BOTH' | 'DEFER') => {
    const reason = window.prompt(
      decision === 'SUPPRESS'
        ? 'Why is this the same observation and safe to suppress from analytics?'
        : decision === 'KEEP_BOTH'
          ? 'Why are both observations valid and distinct?'
          : 'Why should duplicate review remain deferred?'
    );
    if (!reason?.trim()) return;
    setDecisionBusy(item.id);
    setDecisionError(null);
    try {
      const response = await fetch('/api/duplicate-review-decision', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId: item.id, decision, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Duplicate review decision failed');
      setItems(current => current.filter(candidate => candidate.id !== item.id));
      setSelected(null);
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'Duplicate review decision failed');
    } finally {
      setDecisionBusy(null);
    }
  };

  const draftFor = (item: ReviewItem): CorrectionDraft => correctionDrafts[item.id] || {
    brand: item.brand === 'Unknown' ? '' : item.brand,
    reference: item.reference === 'Unresolved' ? '' : item.reference,
    dial_color: item.dial === 'Unverified' ? '' : item.dial,
    condition: '',
    year: '',
    price_raw: item.price ? String(item.price) : '',
    price_usd: item.price ? String(item.price) : '',
    currency: item.currency === 'Unknown' ? '' : item.currency,
    listing_type: 'WTS',
  };

  const submitHumanAction = async (item: ReviewItem, action: 'SAVE' | 'DEFER' | 'RECYCLE') => {
    const reason = action === 'SAVE'
      ? 'Human correction saved; catalog and duplicate gates must revalidate before approval.'
      : window.prompt(action === 'RECYCLE' ? 'Why is this being sent to recycle?' : 'Why should this remain pending?');
    if (action !== 'SAVE' && !reason?.trim()) return;
    setDecisionBusy(item.id);
    setDecisionError(null);
    try {
      const response = await fetch('/api/unbundled-review-action', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stagingId: item.id,
          action,
          reason,
          fields: action === 'SAVE' ? draftFor(item) : {},
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Human review action failed');
      setItems(current => current.map(candidate => candidate.id === item.id
        ? { ...candidate, status: action === 'RECYCLE' ? 'rejected' : 'pending' }
        : candidate));
      setSelected(null);
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'Human review action failed');
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
          <span className="text-[11px] text-text-muted pb-1">
            {reviewerSession
              ? `Signed in as ${reviewerSession.role || 'reviewer'}${reviewerSession.email ? ` · ${reviewerSession.email}` : ''}.`
              : 'Approval requires a signed-in reviewer or administrator account.'}
          </span>
          {decisionError && <span className="w-full text-xs text-red-400">{decisionError}</span>}
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-2">
          <button
            onClick={() => { setLane('unbundled'); setSelected(null); }}
            className={`rounded-lg px-4 py-2 text-xs font-bold ${lane === 'unbundled' ? 'bg-gold-primary text-black' : 'border border-border-default text-text-secondary'}`}
          >
            All unbundled batches
          </button>
          <button
            onClick={() => { setLane('shadow'); setSelected(null); }}
            className={`rounded-lg px-4 py-2 text-xs font-bold ${lane === 'shadow' ? 'bg-gold-primary text-black' : 'border border-border-default text-text-secondary'}`}
          >
            Normalization corrections
          </button>
          <button
            onClick={() => { setLane('duplicates'); setSelected(null); }}
            className={`rounded-lg px-4 py-2 text-xs font-bold ${lane === 'duplicates' ? 'bg-red-400 text-black' : 'border border-border-default text-text-secondary'}`}
          >
            Duplicate candidates
          </button>
          {lane === 'unbundled' && (
            <span className="ml-auto text-xs text-text-muted">{unbundledTotal.toLocaleString()} pending in this lane</span>
          )}
        </div>

        {lane === 'shadow' && progress && (
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
              onChange={e => {
                setSearch(e.target.value);
                if (lane === 'unbundled') setUnbundledPage(1);
              }}
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
            {(lane === 'shadow' ? reasonFilters : lane === 'unbundled' ? [
              { value: 'review-ready', label: 'Review ready' },
              { value: 'human-correction', label: 'Needs correction' },
            ] : []).map(reason => (
              <button
                key={reason.value || 'priority'}
                onClick={() => {
                  if (lane === 'shadow') setReasonFilter(reason.value);
                  else {
                    setUnbundledBucket(reason.value as 'review-ready' | 'human-correction');
                    setUnbundledPage(1);
                  }
                }}
                className={`whitespace-nowrap px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all ${
                  (lane === 'shadow' ? reasonFilter === reason.value : unbundledBucket === reason.value) ? 'bg-bg-elevated text-gold-primary' : 'text-text-muted hover:text-text-primary'
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
                    aria-label={`Inspect ${item.brand} ${item.reference}`}
                    title="Inspect listing evidence"
                    className="p-2 rounded-lg border border-border-default hover:border-gold-primary/50 transition-colors"
                  >
                    <Eye size={14} className="text-text-muted" />
                  </button>
                  {item.status === 'pending' && item.disposition === 'READY_FOR_HUMAN_APPROVAL' && (
                    <button
                      onClick={() => void submitDecision(item, 'APPROVED')}
                      disabled={decisionBusy === item.id || (lane === 'unbundled' && !duplicateReviewed.has(item.id))}
                      className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-emerald-500 text-black text-xs font-bold disabled:opacity-50"
                    >
                      {decisionBusy === item.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                      Approve & publish
                    </button>
                  )}
                  {item.status === 'pending' && lane !== 'duplicates' && (
                    <button
                      onClick={() => void submitDecision(item, 'REJECTED')}
                      disabled={decisionBusy === item.id}
                      className="p-2 rounded-lg border border-red-500/30 hover:border-red-400 transition-colors disabled:opacity-50"
                      aria-label={`Reject ${item.brand} ${item.reference}`}
                      title="Reject proposal"
                    >
                      {decisionBusy === item.id ? <Loader2 size={14} className="animate-spin text-red-400" /> : <XCircle size={14} className="text-red-400" />}
                    </button>
                  )}
                  {item.status === 'pending' && lane === 'duplicates' && (
                    <>
                      <button
                        onClick={() => void submitDuplicateDecision(item, 'SUPPRESS')}
                        disabled={decisionBusy === item.id}
                        className="rounded-lg bg-red-400 px-2.5 py-2 text-xs font-bold text-black disabled:opacity-50"
                      >
                        Suppress duplicate
                      </button>
                      <button
                        onClick={() => void submitDuplicateDecision(item, 'KEEP_BOTH')}
                        disabled={decisionBusy === item.id}
                        className="rounded-lg border border-emerald-500/40 px-2.5 py-2 text-xs font-bold text-emerald-300 disabled:opacity-50"
                      >
                        Keep both
                      </button>
                      <button
                        onClick={() => void submitDuplicateDecision(item, 'DEFER')}
                        disabled={decisionBusy === item.id}
                        className="p-2 rounded-lg border border-border-default disabled:opacity-50"
                        aria-label={`Defer duplicate ${item.reference}`}
                        title="Defer duplicate review"
                      >
                        <Clock size={14} className="text-text-muted" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Expanded Detail */}
              {selected?.id === item.id && (
                  <div className="mt-4 pt-4 border-t border-border-default">
                  {(lane === 'unbundled' || item.rawMessage || item.sellerName || item.sellerPhone) && (
                    <div className="mb-4 rounded-lg border border-border-default bg-bg-elevated/40 p-3">
                      <h4 className="text-xs font-bold text-text-primary mb-2">Preserved raw source evidence</h4>
                      <div className="grid gap-2 text-xs text-text-secondary sm:grid-cols-2">
                        <span>Parent/source: <strong className="text-text-primary">{String(item.reviewEvidence?.source_record_id || item.id || 'Not linked')}</strong></span>
                        <span>Child source: <strong className="text-text-primary">{String(item.reviewEvidence?.source_child_id || item.id)}</strong></span>
                        <span>Seller: <strong className="text-text-primary">{String(item.sellerName || item.reviewEvidence?.seller_name || 'Not present')}</strong></span>
                        <span>Phone: <strong className="text-text-primary">{String(item.sellerPhone || item.reviewEvidence?.seller_phone || 'Not present')}</strong></span>
                        <span>Posted: <strong className="text-text-primary">{item.originalPostedAt ? new Date(item.originalPostedAt).toLocaleString() : 'Not preserved'}</strong></span>
                        <span>Source: <strong className="text-text-primary">{String(item.source || item.sourceType || 'Not identified')}</strong></span>
                        <span>Image: <strong className="text-text-primary">{String(item.reviewEvidence?.front_image || 'Not lineage-confirmed')}</strong></span>
                      </div>
                      <div className="mt-3 rounded border border-border-default bg-bg-card p-3 text-xs text-text-secondary whitespace-pre-wrap break-words">
                        {item.rawMessage || 'Raw child listing unavailable. Do not approve until the parent/source message is recovered.'}
                      </div>
                      {!!item.reviewEvidence?.parent_raw_message && (
                        <div className="mt-2 rounded border border-border-default bg-bg-card p-3 text-xs text-text-muted whitespace-pre-wrap break-words">
                          <strong className="text-text-secondary">Parent raw message:</strong>{'\n'}{String(item.reviewEvidence.parent_raw_message)}
                        </div>
                      )}
                    </div>
                  )}
                  {lane === 'duplicates' && item.duplicate && (
                    <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs">
                      <div className="font-bold text-red-200">Duplicate comparison</div>
                      <div className="mt-2 grid gap-2 text-text-secondary sm:grid-cols-2">
                        <span>Match: <strong className="text-text-primary">{item.duplicate.matchType}</strong></span>
                        <span>Confidence: <strong className="text-text-primary">{Math.round(item.duplicate.confidence * 100)}%</strong></span>
                        <span>Bundle risk: <strong className="text-text-primary">{item.duplicate.bundleRisk ? 'Yes - defer' : 'No'}</strong></span>
                        <span>Raw records: <strong className="text-text-primary">preserved; never deleted</strong></span>
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {(['canonical', 'duplicate'] as const).map(side => {
                          const record = item.duplicate?.[side] || {};
                          return (
                            <div key={side} className="rounded border border-border-default bg-bg-card p-3">
                              <div className="font-bold text-text-primary">{side === 'canonical' ? 'Canonical observation' : 'Candidate duplicate'}</div>
                              <div className="mt-2 text-text-secondary whitespace-pre-wrap break-words">{String(record.raw_message || 'Raw message unavailable')}</div>
                              <div className="mt-2 text-text-muted">{String(record.brand || 'Unknown')} · {String(record.reference || 'Unresolved')} · {String(record.dial_color || 'Unverified')} · {String(record.price_usd || 'No price')}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
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
                  {lane === 'unbundled' && item.disposition === 'READY_FOR_HUMAN_APPROVAL' && (
                    <label className="mt-4 flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-text-secondary">
                      <input
                        type="checkbox"
                        checked={duplicateReviewed.has(item.id)}
                        onChange={event => setDuplicateReviewed(current => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(item.id); else next.delete(item.id);
                          return next;
                        })}
                        className="mt-0.5"
                      />
                      <span>
                        <strong className="text-amber-300">Duplicate review completed.</strong> I checked the preserved raw line and context and confirm this is a distinct listing observation. Approval remains disabled until this is acknowledged.
                      </span>
                    </label>
                  )}
                  {lane === 'unbundled' && (
                    <div className="mt-4 rounded-lg border border-orange-500/30 bg-orange-500/5 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-bold text-orange-200">Human correction</div>
                          <div className="mt-1 text-[11px] text-text-muted">Edit only what the raw evidence supports. Saving keeps this row pending for catalog, duplicate, and publication revalidation.</div>
                        </div>
                        <span className="text-[10px] uppercase font-bold text-orange-300">AI advisory only</span>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {(['brand', 'reference', 'dial_color', 'condition', 'year', 'price_raw', 'price_usd', 'currency', 'listing_type'] as const).map(field => {
                          const draft = draftFor(item);
                          return (
                            <label key={field} className="text-[10px] uppercase tracking-wide text-text-muted">
                              {field.replace('_', ' ')}
                              {field === 'listing_type' ? (
                                <select
                                  value={draft[field]}
                                  onChange={event => setCorrectionDrafts(current => ({ ...current, [item.id]: { ...draft, [field]: event.target.value } }))}
                                  className="mt-1 w-full rounded border border-border-default bg-bg-card px-2 py-2 text-xs normal-case text-text-primary"
                                >
                                  <option value="WTS">WTS / For sale</option>
                                  <option value="WTB">WTB / Looking for</option>
                                  <option value="NTQ">NTQ / Price check</option>
                                  <option value="OTHER">Other</option>
                                </select>
                              ) : (
                                <input
                                  value={draft[field]}
                                  onChange={event => setCorrectionDrafts(current => ({ ...current, [item.id]: { ...draft, [field]: event.target.value } }))}
                                  className="mt-1 w-full rounded border border-border-default bg-bg-card px-2 py-2 text-xs normal-case text-text-primary"
                                />
                              )}
                            </label>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button onClick={() => void submitHumanAction(item, 'SAVE')} disabled={decisionBusy === item.id} className="rounded-lg bg-orange-400 px-3 py-2 text-xs font-bold text-black disabled:opacity-50">Save correction & revalidate</button>
                        <button onClick={() => void submitHumanAction(item, 'DEFER')} disabled={decisionBusy === item.id} className="rounded-lg border border-border-default px-3 py-2 text-xs font-bold text-text-secondary disabled:opacity-50">Leave pending</button>
                        <button onClick={() => void submitHumanAction(item, 'RECYCLE')} disabled={decisionBusy === item.id} className="rounded-lg border border-red-500/40 px-3 py-2 text-xs font-bold text-red-300 disabled:opacity-50">Send to recycle</button>
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
        {lane === 'unbundled' && unbundledTotal > 50 && (
          <div className="mt-6 flex items-center justify-between border-t border-border-default pt-4 text-xs text-text-muted">
            <button
              disabled={unbundledPage === 1}
              onClick={() => setUnbundledPage(page => Math.max(1, page - 1))}
              className="rounded-lg border border-border-default px-3 py-2 disabled:opacity-40"
            >
              Previous
            </button>
            <span>Page {unbundledPage} of {Math.ceil(unbundledTotal / 50).toLocaleString()}</span>
            <button
              disabled={unbundledPage >= Math.ceil(unbundledTotal / 50)}
              onClick={() => setUnbundledPage(page => page + 1)}
              className="rounded-lg border border-border-default px-3 py-2 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}

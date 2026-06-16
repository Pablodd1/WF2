import { useState, useMemo, useCallback } from 'react';
import { Layout } from '@/components/Layout';
import { TabNav } from '@/components/TabNav';
import { useWatchData } from '@/hooks/useWatchData';
import { verifyImageReference, type VerifyImageResult } from '@/lib/verifyImage';
import { enrichWatch } from '@/lib/enrich';
import type { WatchRecord } from '@/types';
import type { EnrichmentData } from '@/lib/enrich';
import { Eye, Wand2, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, HelpCircle, Save, RotateCcw, TrendingUp, ExternalLink } from 'lucide-react';

interface Suggestion {
  field: string;
  value: string;
  reason: string;
  source: 'catalog' | 'kimi' | 'claude' | 'gemini' | 'inference';
}

export default function ReviewPage() {
  const { records, stats, loading } = useWatchData();
  const [filterMinConfidence, setFilterMinConfidence] = useState(0);
  const [filterMaxConfidence, setFilterMaxConfidence] = useState(100);
  const [filterDial, setFilterDial] = useState<string>('all');
  const [filterBrand, setFilterBrand] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingRecord, setEditingRecord] = useState<WatchRecord | null>(null);
  const [editForm, setEditForm] = useState<Partial<WatchRecord>>({});
  const [suggestionsMap, setSuggestionsMap] = useState<Record<string, Suggestion[]>>({});
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [verifyMap, setVerifyMap] = useState<Record<string, VerifyImageResult>>({});
  const [verifyLoading, setVerifyLoading] = useState<Record<string, boolean>>({});
  const [enrichMap, setEnrichMap] = useState<Record<string, EnrichmentData>>({});
  const [enrichLoading, setEnrichLoading] = useState<Record<string, boolean>>({});

  const brands = useMemo(() => {
    const set = new Set(records.map(r => r.brand).filter(Boolean));
    return Array.from(set).sort();
  }, [records]);

  const dials = useMemo(() => {
    const set = new Set(records.map(r => r.dialColor).filter(Boolean));
    return Array.from(set).sort();
  }, [records]);

  const filtered = useMemo(() => {
    return records.filter(r => {
      if (r.confidence < filterMinConfidence || r.confidence > filterMaxConfidence) return false;
      if (filterDial !== 'all' && r.dialColor !== filterDial) return false;
      if (filterBrand !== 'all' && r.brand !== filterBrand) return false;
      return true;
    }).sort((a, b) => a.confidence - b.confidence);
  }, [records, filterMinConfidence, filterMaxConfidence, filterDial, filterBrand]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  const startEdit = useCallback((record: WatchRecord) => {
    setEditingRecord(record);
    setEditForm({
      reference: record.reference,
      dialColor: record.dialColor,
      brand: record.brand,
      price: record.price,
      condition: record.condition,
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingRecord(null);
    setEditForm({});
  }, []);

  const saveEdit = useCallback(() => {
    if (!editingRecord) return;
    // In real app: send to backend + catalog.train()
    setSavedIds(prev => new Set(prev).add(editingRecord.id));
    setEditingRecord(null);
    setEditForm({});
  }, [editingRecord]);

  // Build field-level suggestions from a Kimi parse result vs the current record.
  const buildSuggestions = useCallback((record: WatchRecord, parsed: any, source: string): Suggestion[] => {
    const suggestions: Suggestion[] = [];
    const src = source as Suggestion['source'];
    if (parsed.dialColor && parsed.dialColor.toUpperCase() !== (record.dialColor || '').toUpperCase()) {
      suggestions.push({ field: 'dialColor', value: parsed.dialColor, reason: `${source} suggests ${parsed.dialColor} from reference/context analysis`, source: src });
    }
    if (parsed.reference && parsed.reference.toUpperCase() !== (record.reference || '').toUpperCase()) {
      suggestions.push({ field: 'reference', value: parsed.reference, reason: `${source} parsed full reference with suffix`, source: src });
    }
    if (parsed.brand && parsed.brand !== 'Unknown' && parsed.brand !== record.brand) {
      suggestions.push({ field: 'brand', value: parsed.brand, reason: `${source} identified brand from reference pattern`, source: src });
    }
    return suggestions;
  }, []);

  const parseOne = useCallback(async (record: WatchRecord): Promise<Suggestion[]> => {
    const res = await fetch('/api/ai-parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawMessage: record.rawMessage,
        currentGuess: {
          reference: record.reference,
          dialColor: record.dialColor,
          brand: record.brand,
          price: record.price,
          currency: record.originalCurrency,
        },
      }),
    });
    const data = await res.json();
    if (data.success && data.parsed) {
      return buildSuggestions(record, data.parsed, data.source || 'kimi');
    }
    return [];
  }, [buildSuggestions]);

  const askAI = useCallback(async (record: WatchRecord) => {
    setAiLoading(prev => ({ ...prev, [record.id]: true }));
    try {
      const suggestions = await parseOne(record);
      setSuggestionsMap(prev => ({ ...prev, [record.id]: suggestions }));
    } catch (e) {
      console.error('AI parse failed:', e);
    } finally {
      setAiLoading(prev => ({ ...prev, [record.id]: false }));
    }
  }, [parseOne]);

  // Verify the photo matches the text-extracted reference (image read blind).
  const verifyImage = useCallback(async (record: WatchRecord) => {
    if (!record.imageUrl) return;
    setVerifyLoading(prev => ({ ...prev, [record.id]: true }));
    try {
      const result = await verifyImageReference(record.imageUrl, record.reference, record.brand);
      setVerifyMap(prev => ({ ...prev, [record.id]: result }));
    } catch (e) {
      console.error('Image verify failed:', e);
    } finally {
      setVerifyLoading(prev => ({ ...prev, [record.id]: false }));
    }
  }, []);

  // Bulk re-parse all currently-filtered records with Kimi (concurrency-limited).
  const bulkReparse = useCallback(async (targets: WatchRecord[]) => {
    const queue = targets.slice(0, 50); // safety cap per run
    if (queue.length === 0) return;
    setBulkProgress({ done: 0, total: queue.length });
    const CONCURRENCY = 4;
    let idx = 0;
    let done = 0;
    const worker = async () => {
      while (idx < queue.length) {
        const record = queue[idx++];
        try {
          const suggestions = await parseOne(record);
          if (suggestions.length > 0) {
            setSuggestionsMap(prev => ({ ...prev, [record.id]: suggestions }));
          }
        } catch (e) {
          console.error('Bulk parse failed for', record.id, e);
        } finally {
          done++;
          setBulkProgress({ done, total: queue.length });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setBulkProgress(null);
  }, [parseOne]);

  // Bulk enrich all currently-filtered records with structured market data
  const bulkEnrich = useCallback(async (targets: WatchRecord[]) => {
    const queue = targets.filter(r => r.reference).slice(0, 50);
    if (queue.length === 0) return;
    setBulkProgress({ done: 0, total: queue.length });
    const CONCURRENCY = 4;
    let idx = 0;
    let done = 0;
    const worker = async () => {
      while (idx < queue.length) {
        const record = queue[idx++];
        try {
          const data = await enrichWatch(record.reference!, record.brand);
          if (data.success && data.enrichment) {
            setEnrichMap(prev => ({ ...prev, [record.id]: data.enrichment! }));
          }
        } catch (e) {
          console.error('Bulk enrich failed for', record.id, e);
        } finally {
          done++;
          setBulkProgress({ done, total: queue.length });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setBulkProgress(null);
  }, []);

  const applySuggestion = useCallback((recordId: string, suggestion: Suggestion) => {
    setEditForm(prev => ({ ...prev, [suggestion.field]: suggestion.value }));
    // If we're not in edit mode, start editing
    const record = records.find(r => r.id === recordId);
    if (record && !editingRecord) {
      startEdit(record);
      setEditForm({ [suggestion.field]: suggestion.value });
    }
  }, [records, editingRecord, startEdit]);

  // Enrich a single record with structured market data
  const handleEnrich = useCallback(async (record: WatchRecord) => {
    if (!record.reference) return;
    setEnrichLoading(prev => ({ ...prev, [record.id]: true }));
    try {
      const data = await enrichWatch(record.reference, record.brand);
      if (data.success && data.enrichment) {
        setEnrichMap(prev => ({ ...prev, [record.id]: data.enrichment! }));
      }
    } catch (e) {
      console.error('Enrich failed:', e);
    } finally {
      setEnrichLoading(prev => ({ ...prev, [record.id]: false }));
    }
  }, []);

  if (loading) {
    return (
      <Layout {...stats}>
        <TabNav totalProcessed={stats.totalProcessed} />
        <div className="p-8 text-center text-text-muted">Loading records...</div>
      </Layout>
    );
  }

  return (
    <Layout {...stats}>
      <TabNav totalProcessed={stats.totalProcessed} />

      <div className="p-5 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
              <Eye size={24} className="text-gold-primary" />
              Human Review Mode
            </h1>
            <p className="text-sm text-text-muted mt-1">
              Review low-confidence parses, fix errors, and train the catalog. 
              {filtered.length} records match current filters.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => bulkEnrich(filtered)}
              disabled={bulkProgress !== null || filtered.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 text-sm font-medium hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Enrich all filtered records with catalog + market data"
            >
              <TrendingUp size={16} />
              {bulkProgress
                ? `Enriching… ${bulkProgress.done}/${bulkProgress.total}`
                : `Bulk Enrich (${Math.min(filtered.length, 50)})`}
            </button>
            <button
              onClick={() => bulkReparse(filtered)}
              disabled={bulkProgress !== null || filtered.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gold-primary/10 border border-gold-primary/40 text-gold-primary text-sm font-medium hover:bg-gold-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Re-parse the filtered records with Kimi K2.6 and surface suggestions"
            >
              <Wand2 size={16} />
              {bulkProgress
                ? `Kimi re-parsing… ${bulkProgress.done}/${bulkProgress.total}`
                : `Bulk Kimi Re-parse (${Math.min(filtered.length, 50)})`}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-bg-card border border-border-default rounded-lg p-4 mb-6 flex flex-wrap gap-4 items-end">
          <div>
            <label className="text-xs text-text-muted uppercase tracking-wider block mb-1">Min Confidence</label>
            <select
              value={filterMinConfidence}
              onChange={e => setFilterMinConfidence(Number(e.target.value))}
              className="bg-bg-elevated border border-border-default rounded px-3 py-1.5 text-sm text-text-primary"
            >
              <option value={0}>0%</option>
              <option value={50}>50%</option>
              <option value={60}>60%</option>
              <option value={70}>70%</option>
              <option value={80}>80%</option>
              <option value={90}>90%</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-text-muted uppercase tracking-wider block mb-1">Max Confidence</label>
            <select
              value={filterMaxConfidence}
              onChange={e => setFilterMaxConfidence(Number(e.target.value))}
              className="bg-bg-elevated border border-border-default rounded px-3 py-1.5 text-sm text-text-primary"
            >
              <option value={100}>100%</option>
              <option value={90}>90%</option>
              <option value={80}>80%</option>
              <option value={70}>70%</option>
              <option value={60}>60%</option>
              <option value={50}>50%</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-text-muted uppercase tracking-wider block mb-1">Brand</label>
            <select
              value={filterBrand}
              onChange={e => setFilterBrand(e.target.value)}
              className="bg-bg-elevated border border-border-default rounded px-3 py-1.5 text-sm text-text-primary"
            >
              <option value="all">All Brands</option>
              {brands.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-text-muted uppercase tracking-wider block mb-1">Dial Color</label>
            <select
              value={filterDial}
              onChange={e => setFilterDial(e.target.value)}
              className="bg-bg-elevated border border-border-default rounded px-3 py-1.5 text-sm text-text-primary"
            >
              <option value="all">All Dials</option>
              {dials.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => {
              setFilterMinConfidence(0);
              setFilterMaxConfidence(100);
              setFilterBrand('all');
              setFilterDial('all');
            }}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            <RotateCcw size={12} />
            Reset
          </button>
        </div>

        {/* Records List */}
        <div className="space-y-3">
          {filtered.slice(0, 200).map(record => {
            const isExpanded = expandedId === record.id;
            const isEditing = editingRecord?.id === record.id;
            const suggestions = suggestionsMap[record.id] || [];
            const isAiLoading = aiLoading[record.id];
            const isSaved = savedIds.has(record.id);

            let confidenceColor = 'text-emerald-400';
            if (record.confidence < 60) confidenceColor = 'text-red-400';
            else if (record.confidence < 80) confidenceColor = 'text-amber-400';

            return (
              <div
                key={record.id}
                className={`bg-bg-card border rounded-lg transition-all ${
                  isExpanded ? 'border-gold-primary/50' : 'border-border-default hover:border-border-hover'
                }`}
              >
                {/* Summary Row */}
                <div
                  className="flex items-center gap-4 p-4 cursor-pointer"
                  onClick={() => toggleExpand(record.id)}
                >
                  <div className="flex-shrink-0">
                    {record.confidence < 60 ? (
                      <AlertTriangle size={18} className="text-red-400" />
                    ) : record.confidence < 80 ? (
                      <HelpCircle size={18} className="text-amber-400" />
                    ) : (
                      <CheckCircle size={18} className="text-emerald-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-bold text-text-primary">{record.reference}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-bg-elevated text-text-secondary">
                        {record.dialColor}
                      </span>
                      <span className="text-xs text-text-muted">{record.brand}</span>
                      <span className={`text-xs font-bold ${confidenceColor}`}>
                        {record.confidence}%
                      </span>
                      {isSaved && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                          Saved
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-text-muted mt-0.5 truncate">
                      {record.rawMessage}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right">
                      <div className="text-sm font-bold text-text-primary">
                        ${record.price?.toLocaleString()}
                      </div>
                      <div className="text-xs text-text-muted">{record.originalCurrency}</div>
                    </div>
                    {isExpanded ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
                  </div>
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="border-t border-border-default px-4 pb-4">
                    {/* Original Message */}
                    <div className="mt-4 mb-4">
                      <label className="text-xs text-text-muted uppercase tracking-wider block mb-1">
                        Original WhatsApp Message
                      </label>
                      <div className="bg-bg-elevated border border-border-default rounded p-3 text-sm text-text-secondary font-mono whitespace-pre-wrap">
                        {record.rawMessage}
                      </div>
                    </div>

                    {/* Description */}
                    {record.description && (
                      <div className="mb-4">
                        <label className="text-xs text-text-muted uppercase tracking-wider block mb-1">
                          Extracted Description
                        </label>
                        <div className="text-sm text-text-primary">{record.description}</div>
                      </div>
                    )}

                    {/* Parsed Fields */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      {isEditing ? (
                        <>
                          <div>
                            <label className="text-xs text-text-muted block mb-1">Reference</label>
                            <input
                              value={editForm.reference || ''}
                              onChange={e => setEditForm(p => ({ ...p, reference: e.target.value }))}
                              className="w-full bg-bg-elevated border border-border-default rounded px-2 py-1 text-sm text-text-primary"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-text-muted block mb-1">Dial Color</label>
                            <input
                              value={editForm.dialColor || ''}
                              onChange={e => setEditForm(p => ({ ...p, dialColor: e.target.value }))}
                              className="w-full bg-bg-elevated border border-border-default rounded px-2 py-1 text-sm text-text-primary"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-text-muted block mb-1">Brand</label>
                            <input
                              value={editForm.brand || ''}
                              onChange={e => setEditForm(p => ({ ...p, brand: e.target.value }))}
                              className="w-full bg-bg-elevated border border-border-default rounded px-2 py-1 text-sm text-text-primary"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-text-muted block mb-1">Price USD</label>
                            <input
                              type="number"
                              value={editForm.price || 0}
                              onChange={e => setEditForm(p => ({ ...p, price: Number(e.target.value) }))}
                              className="w-full bg-bg-elevated border border-border-default rounded px-2 py-1 text-sm text-text-primary"
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="bg-bg-elevated rounded p-2">
                            <div className="text-xs text-text-muted">Reference</div>
                            <div className="text-sm font-bold text-text-primary">{record.reference}</div>
                          </div>
                          <div className="bg-bg-elevated rounded p-2">
                            <div className="text-xs text-text-muted">Dial Color</div>
                            <div className="text-sm font-bold text-text-primary">{record.dialColor}</div>
                          </div>
                          <div className="bg-bg-elevated rounded p-2">
                            <div className="text-xs text-text-muted">Brand</div>
                            <div className="text-sm font-bold text-text-primary">{record.brand}</div>
                          </div>
                          <div className="bg-bg-elevated rounded p-2">
                            <div className="text-xs text-text-muted">Price (USD)</div>
                            <div className="text-sm font-bold text-text-primary">${record.price?.toLocaleString()}</div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Confidence Reasons */}
                    <div className="mb-4">
                      <label className="text-xs text-text-muted uppercase tracking-wider block mb-1">
                        Confidence Breakdown
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {(record as any).confidenceReasons?.map((reason: string, i: number) => (
                          <span key={i} className="text-xs px-2 py-1 rounded bg-bg-elevated text-text-secondary capitalize">
                            {reason.replace(/_/g, ' ')}
                          </span>
                        )) || (
                          <span className="text-xs text-text-muted">Confidence computed from parsing quality</span>
                        )}
                      </div>
                    </div>

                    {/* AI Suggestions */}
                    {suggestions.length > 0 && (
                      <div className="mb-4">
                        <label className="text-xs text-text-muted uppercase tracking-wider block mb-1">
                          AI Suggestions
                        </label>
                        <div className="space-y-2">
                          {suggestions.map((s, i) => (
                            <div key={i} className="flex items-center gap-3 bg-bg-elevated rounded p-2">
                              <Wand2 size={14} className="text-gold-primary" />
                              <div className="flex-1">
                                <div className="text-sm text-text-primary">
                                  <span className="font-bold">{s.field}:</span> {s.value}
                                </div>
                                <div className="text-xs text-text-muted">{s.reason}</div>
                              </div>
                              <button
                                onClick={() => applySuggestion(record.id, s)}
                                className="text-xs px-2 py-1 rounded bg-gold-primary/20 text-gold-primary hover:bg-gold-primary/30 transition-colors"
                              >
                                Apply
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-3">
                      {isEditing ? (
                        <>
                          <button
                            onClick={saveEdit}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors text-sm"
                          >
                            <Save size={14} />
                            Save & Train Catalog
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-3 py-1.5 rounded bg-bg-elevated text-text-muted hover:text-text-primary transition-colors text-sm"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(record)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-gold-primary/20 text-gold-primary hover:bg-gold-primary/30 transition-colors text-sm"
                          >
                            Edit Fields
                          </button>
                          <button
                            onClick={() => askAI(record)}
                            disabled={isAiLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-bg-elevated text-text-secondary hover:text-text-primary transition-colors text-sm disabled:opacity-50"
                          >
                            <Wand2 size={14} />
                            {isAiLoading ? 'Asking AI...' : 'Ask AI'}
                          </button>
                          <button
                            onClick={() => handleEnrich(record)}
                            disabled={enrichLoading[record.id] || !record.reference}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-bg-elevated text-text-secondary hover:text-text-primary transition-colors text-sm disabled:opacity-50"
                            title="Fetch catalog + market data for this reference"
                          >
                            <TrendingUp size={14} />
                            {enrichLoading[record.id] ? 'Enriching…' : 'Enrich'}
                          </button>
                          {record.imageUrl && (
                            <button
                              onClick={() => verifyImage(record)}
                              disabled={verifyLoading[record.id]}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-bg-elevated text-text-secondary hover:text-text-primary transition-colors text-sm disabled:opacity-50"
                              title="Read the photo blind and check it matches the reference"
                            >
                              <Eye size={14} />
                              {verifyLoading[record.id] ? 'Verifying…' : 'Verify Image'}
                            </button>
                          )}
                        </>
                      )}
                    </div>

                    {/* Enrichment Results */}
                    {enrichMap[record.id] && (() => {
                      const e = enrichMap[record.id];
                      return (
                        <div className="mt-3 rounded-lg border border-gold-primary/30 bg-gold-primary/5 px-3 py-2">
                          <div className="flex items-center gap-2 mb-1">
                            <TrendingUp size={12} className="text-gold-primary" />
                            <span className="text-xs font-bold text-gold-primary uppercase tracking-wider">Enrichment</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {e.catalog?.collection && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-muted font-mono">
                                {e.catalog.collection}
                              </span>
                            )}
                            {e.catalog?.model && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-muted font-mono">
                                {e.catalog.model}
                              </span>
                            )}
                            {e.market?.chrono24?.priceRange && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">
                                Chrono24: ${e.market.chrono24.priceRange.median.toLocaleString()}
                              </span>
                            )}
                            {e.officialUrl && (
                              <a href={e.officialUrl} target="_blank" rel="noopener noreferrer"
                                className="text-[10px] text-text-muted hover:text-gold-primary transition-colors flex items-center gap-0.5">
                                <ExternalLink size={10} /> Official
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Image-vs-reference verdict */}
                    {verifyMap[record.id] && (() => {
                      const v = verifyMap[record.id];
                      const styles = v.verdict === 'MISMATCH'
                        ? 'border-red-500/50 bg-red-500/10 text-red-300'
                        : v.verdict === 'MATCH'
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-amber-500/40 bg-amber-500/10 text-amber-300';
                      const Icon = v.verdict === 'MISMATCH' ? AlertTriangle : v.verdict === 'MATCH' ? CheckCircle : HelpCircle;
                      return (
                        <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${styles}`}>
                          <div className="flex items-center gap-2 font-semibold">
                            <Icon size={14} />
                            {v.verdict === 'MISMATCH' ? '⚠ IMAGE MISMATCH — routed to human review' : v.verdict === 'MATCH' ? 'Image confirms reference' : 'Could not verify from image'}
                            {v.source && <span className="opacity-60 font-normal">· {v.source}</span>}
                          </div>
                          <div className="mt-1 opacity-90">{v.reason}</div>
                          {v.image && (
                            <div className="mt-1 opacity-70">
                              Image saw: {v.image.brand} / ref {v.image.referenceVisible} / {v.image.dialColor} (conf {v.image.confidence}%)
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12 text-text-muted">
            No records match the current filters.
          </div>
        )}

        {filtered.length > 200 && (
          <div className="text-center py-4 text-xs text-text-muted">
            Showing 200 of {filtered.length} records. Use filters to narrow results.
          </div>
        )}
      </div>
    </Layout>
  );
}

import { useState, useCallback } from 'react';
import { parseWatch, getVerdict } from '@/utils/parseEngine';
import type { ParsedWatch } from '@/utils/parseEngine';
import { Download, Brain, Eye, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';

export default function DemoPage() {
  const [input, setInput] = useState('');
  const [results, setResults] = useState<(ParsedWatch & { verdict: string; aiSuggestion?: any; expanded?: boolean })[]>([]);
  const [aiLoading, setAiLoading] = useState<Set<string>>(new Set());

  const handleParse = useCallback(() => {
    const lines = input.split('\n').map(l => l.trim()).filter(l => l);
    const parsed = lines.map(line => {
      const p = parseWatch(line);
      return { ...p, verdict: getVerdict(p.confidence), expanded: false };
    });
    setResults(parsed);
  }, [input]);

  const handleAskAI = useCallback(async (idx: number) => {
    const r = results[idx];
    if (!r) return;
    setAiLoading(prev => new Set(prev).add(idx.toString()));
    try {
      const res = await fetch('/api/ai-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawMessage: r.rawMessage,
          currentGuess: { reference: r.reference, dialColor: r.dialColor, brand: r.brand, price: r.price, currency: r.currency },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResults(prev => prev.map((item, i) =>
          i === idx ? { ...item, aiSuggestion: data.parsed, verdict: 'AI_REVIEW' } : item
        ));
      }
    } catch (e) {
      console.error('AI parse failed:', e);
    } finally {
      setAiLoading(prev => { const n = new Set(prev); n.delete(idx.toString()); return n; });
    }
  }, [results]);

  const toggleExpand = useCallback((idx: number) => {
    setResults(prev => prev.map((item, i) =>
      i === idx ? { ...item, expanded: !item.expanded } : item
    ));
  }, []);

  const handleDownload = useCallback(() => {
    const rows = [['rawMessage', 'brand', 'reference', 'dialColor', 'price', 'currency', 'condition', 'year', 'confidence', 'verdict']];
    for (const r of results) {
      rows.push([r.rawMessage, r.brand, r.reference, r.dialColor, String(r.price), r.currency, r.condition, String(r.year ?? ''), String(r.confidence), r.verdict]);
    }
    const bom = '\uFEFF';
    const csv = bom + rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `WatchFacts_Parse_${results.length}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [results]);

  const examples = [
    '🏮5712/1A Blue N5/2026 New 850k HKD',
    '🔥116610LV Green Submariner 2021 1.2M HKD',
    'RM11-03 2022 250k USD',
    '5146R Annual Calendar 2023 Brown 350k HKD',
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#050505' }}>
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold" style={{ color: '#d4af37', fontFamily: "'Playfair Display', serif" }}>
            WatchFacts Parsing Engine
          </h1>
          <p className="mt-2 text-sm" style={{ color: '#888' }}>
            Paste raw WhatsApp dealer messages. Regex-first parser → confidence score → auto-approve (≥90%) or AI fallback.
          </p>
        </div>

        {/* Input */}
        <div className="rounded-xl p-6 mb-6" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-semibold" style={{ color: '#e8e8e8' }}>Raw WhatsApp Messages</label>
            <div className="flex gap-2">
              {examples.map((ex, i) => (
                <button key={i} onClick={() => setInput(prev => prev + (prev ? '\n' : '') + ex)}
                  className="text-xs px-2 py-1 rounded" style={{ backgroundColor: '#1a1a1a', color: '#d4af37' }}>
                  + Ex {i + 1}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Paste WhatsApp listing, one per line..."
            className="w-full h-32 rounded-lg p-4 text-sm font-mono outline-none resize-none"
            style={{ backgroundColor: '#111', color: '#e8e8e8', border: '1px solid #222' }}
          />
          <div className="flex gap-3 mt-4">
            <button onClick={handleParse}
              className="px-6 py-2.5 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#d4af37', color: '#050505' }}
              disabled={!input.trim()}>
              <Brain className="inline w-4 h-4 mr-2" />Parse & Score
            </button>
            {results.length > 0 && (
              <button onClick={handleDownload}
                className="px-4 py-2.5 rounded-lg text-sm" style={{ backgroundColor: '#1a1a1a', color: '#e8e8e8', border: '1px solid #333' }}>
                <Download className="inline w-4 h-4 mr-1" />Export CSV
              </button>
            )}
          </div>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div>
            {/* Summary bar */}
            <div className="flex gap-3 mb-4 text-xs">
              <div className="px-4 py-2 rounded-lg" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a', color: '#888' }}>
                <span className="font-bold" style={{ color: '#22c55e' }}>{results.filter(r => r.verdict === 'AUTO_APPROVED').length}</span> Auto-Approved
              </div>
              <div className="px-4 py-2 rounded-lg" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a', color: '#888' }}>
                <span className="font-bold" style={{ color: '#eab308' }}>{results.filter(r => r.verdict === 'AI_REVIEW').length}</span> AI-Review
              </div>
              <div className="px-4 py-2 rounded-lg" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a', color: '#888' }}>
                <span className="font-bold" style={{ color: '#ef4444' }}>{results.filter(r => r.verdict === 'HUMAN_REVIEW').length}</span> Human Review
              </div>
            </div>

            {/* Record cards */}
            {results.map((r, idx) => (
              <div key={idx} className="rounded-xl mb-3 overflow-hidden transition-all"
                style={{
                  backgroundColor: '#0a0a0a',
                  border: '1px solid ' + (r.verdict === 'AUTO_APPROVED' ? '#166534' : r.verdict === 'AI_REVIEW' ? '#854d0e' : '#7f1d1d'),
                }}>
                {/* Header */}
                <div className="flex items-center justify-between p-4 cursor-pointer" onClick={() => toggleExpand(idx)}>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg shrink-0"
                      style={{ backgroundColor: r.verdict === 'AUTO_APPROVED' ? '#052e16' : r.verdict === 'AI_REVIEW' ? '#422006' : '#450a0a' }}>
                      {r.verdict === 'AUTO_APPROVED' ? <CheckCircle2 className="w-5 h-5" style={{ color: '#22c55e' }} /> :
                       r.verdict === 'AI_REVIEW' ? <Brain className="w-5 h-5" style={{ color: '#eab308' }} /> :
                       <Eye className="w-5 h-5" style={{ color: '#ef4444' }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate" style={{ color: '#e8e8e8' }}>{r.rawMessage}</div>
                      <div className="text-xs mt-1 flex gap-2 flex-wrap" style={{ color: '#888' }}>
                        <span style={{ color: r.brand !== 'Unknown' ? '#d4af37' : '#ef4444' }}>{r.brand}</span>
                        {r.reference && <span>{r.reference}</span>}
                        {r.dialColor !== 'UNKNOWN' && <span>{r.dialColor}</span>}
                        {r.price > 0 && <span>{r.currency} {r.price.toLocaleString()}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Confidence badge */}
                      <div className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                        r.confidence >= 90 ? '' : r.confidence >= 60 ? '' : ''
                      }`}
                        style={{
                          backgroundColor: r.confidence >= 90 ? '#052e16' : r.confidence >= 60 ? '#422006' : '#450a0a',
                          color: r.confidence >= 90 ? '#22c55e' : r.confidence >= 60 ? '#eab308' : '#ef4444',
                          border: '1px solid ' + (r.confidence >= 90 ? '#166534' : r.confidence >= 60 ? '#854d0e' : '#7f1d1d'),
                        }}>
                        {r.confidence}%
                      </div>
                      {/* Verdict badge */}
                      <div className={`hidden sm:block text-xs font-bold px-2 py-1 rounded ${
                        r.verdict === 'AUTO_APPROVED' ? 'text-green-400' :
                        r.verdict === 'AI_REVIEW' ? 'text-yellow-400' : 'text-red-400'
                      }`}
                        style={{ backgroundColor: r.verdict === 'AUTO_APPROVED' ? '#052e16' : r.verdict === 'AI_REVIEW' ? '#422006' : '#450a0a' }}>
                        {r.verdict === 'AUTO_APPROVED' ? '✓ AUTO' : r.verdict === 'AI_REVIEW' ? '⚡ AI' : '👁 HUMAN'}
                      </div>
                      {r.expanded ? <ChevronUp className="w-4 h-4" style={{ color: '#666' }} /> :
                                    <ChevronDown className="w-4 h-4" style={{ color: '#666' }} />}
                    </div>
                  </div>
                </div>

                {/* Expanded content */}
                {r.expanded && (
                  <div className="px-4 pb-4 border-t" style={{ borderColor: '#1a1a1a' }}>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                      <FieldBox label="Brand" value={r.brand} good={r.brand !== 'Unknown'} />
                      <FieldBox label="Reference" value={r.reference || '—'} good={!!r.reference} />
                      <FieldBox label="Dial Color" value={r.dialColor} good={r.dialColor !== 'UNKNOWN'} />
                      <FieldBox label="Price" value={r.price > 0 ? `${r.currency} ${r.price.toLocaleString()}` : '—'} good={r.price > 0} />
                      <FieldBox label="Condition" value={r.condition} good={r.condition !== 'Unknown'} />
                      <FieldBox label="Year" value={r.year ? String(r.year) : '—'} good={!!r.year} />
                      <FieldBox label="Model" value={r.model || '—'} good={!!r.model} />
                      <FieldBox label="Flags" value={r.flags.length ? r.flags.join(', ') : 'None'} good={r.flags.length === 0} />
                    </div>

                    {/* Confidence breakdown */}
                    <div className="mt-3 p-3 rounded-lg" style={{ backgroundColor: '#111' }}>
                      <div className="text-xs mb-2" style={{ color: '#888' }}>Confidence Breakdown: {r.confidence}/100</div>
                      <div className="flex gap-4 text-xs" style={{ color: '#666' }}>
                        <span style={{ color: r.brand !== 'Unknown' ? '#22c55e' : '#ef4444' }}>Brand +{r.brand !== 'Unknown' ? 30 : 0}</span>
                        <span style={{ color: r.reference ? '#22c55e' : '#ef4444' }}>Ref +{r.reference ? 25 : 0}</span>
                        <span style={{ color: r.dialColor !== 'UNKNOWN' ? '#22c55e' : '#ef4444' }}>Dial +{r.dialColor !== 'UNKNOWN' ? 20 : 0}</span>
                        <span style={{ color: r.price > 0 ? '#22c55e' : '#ef4444' }}>Price +{r.price > 0 ? 20 : 0}{r.price >= 5000 && r.price <= 1_000_000 ? '+5' : ''}</span>
                      </div>
                    </div>

                    {/* Action area */}
                    {r.verdict !== 'AUTO_APPROVED' && (
                      <div className="mt-3 flex gap-2">
                        {!r.aiSuggestion ? (
                          <button onClick={() => handleAskAI(idx)} disabled={aiLoading.has(idx.toString())}
                            className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                            style={{ backgroundColor: '#422006', color: '#eab308', border: '1px solid #854d0e' }}>
                            {aiLoading.has(idx.toString()) ? (
                              <span className="inline-flex items-center gap-1">
                                <span className="animate-spin w-3 h-3 border-2 rounded-full inline-block" style={{ borderColor: '#eab308', borderTopColor: 'transparent' }} />
                                Kimi parsing...
                              </span>
                            ) : (
                              <><Brain className="inline w-3 h-3 mr-1" />Ask Kimi AI</>
                            )}
                          </button>
                        ) : (
                          <div className="w-full p-3 rounded-lg text-xs" style={{ backgroundColor: '#1a1a1a', color: '#aaa' }}>
                            <div className="font-semibold mb-2" style={{ color: '#eab308' }}>AI Suggestion (Kimi K2.6)</div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              <div><span style={{ color: '#888' }}>Ref: </span>{r.aiSuggestion.reference}</div>
                              <div><span style={{ color: '#888' }}>Dial: </span>{r.aiSuggestion.dialColor}</div>
                              <div><span style={{ color: '#888' }}>Price: </span>{r.aiSuggestion.price?.toLocaleString()}</div>
                              <div><span style={{ color: '#888' }}>Brand: </span>{r.aiSuggestion.brand}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {r.verdict === 'AUTO_APPROVED' && (
                      <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: '#22c55e' }}>
                        <CheckCircle2 className="w-4 h-4" />
                        Auto-approved. Confidence ≥90%. Writing to database...
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {results.length === 0 && (
          <div className="rounded-xl p-12 text-center" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a' }}>
            <Brain className="w-12 h-12 mx-auto mb-4" style={{ color: '#333' }} />
            <p className="text-sm" style={{ color: '#555' }}>Paste WhatsApp messages above or click an example to see the parsing engine in action.</p>
          </div>
        )}

        {/* Sticky verdict guide */}
        <div className="fixed bottom-6 right-6 rounded-xl p-4 text-xs shadow-xl" style={{ backgroundColor: '#0a0a0a', border: '1px solid #222', maxWidth: '200px' }}>
          <div className="font-semibold mb-2" style={{ color: '#d4af37' }}>Processing Pipeline</div>
          <div className="space-y-2">
            <div className="flex items-center gap-2" style={{ color: '#22c55e' }}>
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#22c55e' }} />
              <span>≥90% → Auto DB</span>
            </div>
            <div className="flex items-center gap-2" style={{ color: '#eab308' }}>
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#eab308' }} />
              <span>60-89% → AI (Kimi)</span>
            </div>
            <div className="flex items-center gap-2" style={{ color: '#ef4444' }}>
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#ef4444' }} />
              <span>&lt;60% → Human</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldBox({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="rounded-lg p-2.5" style={{ backgroundColor: '#111' }}>
      <div className="text-xs mb-1" style={{ color: '#666' }}>{label}</div>
      <div className="text-sm font-medium truncate" style={{ color: good ? '#e8e8e8' : '#ef4444' }}>{value}</div>
    </div>
  );
}

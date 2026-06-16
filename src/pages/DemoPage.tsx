import { useState, useCallback, useEffect } from 'react';
import { parseWatch, getVerdict } from '@/utils/parseEngine';
import type { ParsedWatch } from '@/utils/parseEngine';
import { Download, Brain, Eye, CheckCircle2, ChevronDown, ChevronUp, RefreshCw, Trash2, AlertTriangle, Search, FileSpreadsheet } from 'lucide-react';

const BATCH_WARN = 200;
const BATCH_MAX_RENDER = 500;

// Lazy-load SheetJS
async function getXLSX() {
  const mod = await import('xlsx');
  return mod;
}

// ── Excel color palette ──────────────────────────────────────────────────────
const C = {
  navyBg: { rgb: 'FF1F4E78' },
  navyFg: { rgb: 'FFFFFFFF' },
  green: { rgb: 'FF90EE90' },
  orange: { rgb: 'FFFFA500' },
  red: { rgb: 'FFFF6B6B' },
  white: { rgb: 'FFFFFFFF' },
  lightGrey: { rgb: 'FFF5F5F5' },
  text: { rgb: 'FF1A1A1A' },
};

function border() {
  const b = { style: 'thin', color: { rgb: 'FFDDDDDD' } };
  return { top: b, bottom: b, left: b, right: b };
}

function hCell(v: string) {
  return {
    v, t: 's',
    s: {
      font: { bold: true, color: C.navyFg, sz: 10, name: 'Calibri' },
      fill: { fgColor: C.navyBg, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
      border: border(),
    },
  };
}

function dCell(v: any, bg: any, align = 'left') {
  const isNum = typeof v === 'number';
  return {
    v: v ?? '',
    t: isNum ? 'n' : 's',
    s: {
      font: { sz: 9, color: C.text, name: 'Calibri' },
      fill: { fgColor: bg, patternType: 'solid' },
      alignment: { horizontal: align, vertical: 'center', wrapText: false },
      border: border(),
      ...(isNum ? { numFmt: '#,##0' } : {}),
    },
  };
}

function titleCell(v: string) {
  return {
    v, t: 's',
    s: {
      font: { bold: true, sz: 14, color: C.navyBg, name: 'Calibri' },
      alignment: { horizontal: 'left', vertical: 'center' },
    },
  };
}

function verdictBg(v: string) {
  if (v === 'AUTO_APPROVED') return C.green;
  if (v === 'HUMAN_REVIEW') return C.red;
  return C.orange;
}

// ── Enriched result type ─────────────────────────────────────────────────────
type EnrichedResult = ParsedWatch & {
  verdict: string;
  aiSuggestion?: any;
  expanded?: boolean;
  webEnrichment?: any;
  confidenceBoost?: number;
};

export default function DemoPage() {
  const [input, setInput] = useState('');
  const [results, setResults] = useState<EnrichedResult[]>([]);
  const [aiLoading, setAiLoading] = useState<Set<string>>(new Set());
  const [webLoading, setWebLoading] = useState<Set<string>>(new Set());
  const [hasAutoRan, setHasAutoRan] = useState(false);

  // Auto-run demo with sample data on first load
  useEffect(() => {
    if (hasAutoRan) return;
    setHasAutoRan(true);
    const demoText = `🏮5712/1A Blue N5/2026 New 850k HKD
🔥116610LV Green Submariner 2021 1.2M HKD
RM11-03 2022 250k USD
5146R Annual Calendar 2023 Brown 350k HKD
📥 WTB 5164R 2023 Aquanaut full set`;
    setInput(demoText);
    const parsed = demoText.split('\n').map(l => {
      const p = parseWatch(l.trim());
      return { ...p, verdict: getVerdict(p.confidence), expanded: false };
    });
    setResults(parsed);
  }, [hasAutoRan]);

  const handleParse = useCallback(() => {
    const lines = input.split('\n').map(l => l.trim()).filter(l => l);
    const parsed = lines.map(line => {
      const p = parseWatch(line);
      return { ...p, verdict: getVerdict(p.confidence), expanded: false };
    });
    setResults(parsed);
  }, [input]);

  // ── Web Lookup ─────────────────────────────────────────────────────────────
  const handleWebLookup = useCallback(async (idx: number) => {
    const r = results[idx];
    if (!r) return;
    setWebLoading(prev => new Set(prev).add(idx.toString()));
    try {
      const params = new URLSearchParams();
      if (r.reference) params.set('reference', r.reference);
      if (r.brand && r.brand !== 'Unknown') params.set('brand', r.brand);
      if (r.year) params.set('year', String(r.year));
      params.set('raw', r.rawMessage);

      const res = await fetch(`/api/web-lookup?${params.toString()}`);
      const data = await res.json();

      if (data.success) {
        const boost = data.confidenceBoost || 0;
        const newConfidence = Math.min(100, r.confidence + boost);
        const newVerdict = getVerdict(newConfidence);

        // Auto-apply catalog enrichment if available
        const enrichment = data.catalogEnrichment;
        const webPrice = data.webEnrichment?.price;

        setResults(prev => prev.map((item, i) => {
          if (i !== idx) return item;
          const updated: EnrichedResult = {
            ...item,
            confidence: newConfidence,
            verdict: newVerdict,
            webEnrichment: data,
            confidenceBoost: boost,
          };
          // Auto-fill from catalog if fields are missing
          if (enrichment) {
            if (!updated.model && enrichment.model) updated.model = enrichment.model;
            if (updated.brand === 'Unknown' && enrichment.collection) {
              // Try to infer brand from collection
              const coll = enrichment.collection.toLowerCase();
              if (coll.includes('nautilus') || coll.includes('aquanaut')) updated.brand = 'Patek Philippe';
              else if (coll.includes('royal oak')) updated.brand = 'Audemars Piguet';
              else if (coll.includes('overseas')) updated.brand = 'Vacheron Constantin';
            }
          }
          // Auto-fill price from web if missing
          if (updated.price === 0 && webPrice) {
            if (webPrice.usd) { updated.price = webPrice.usd; updated.currency = 'USD'; }
            else if (webPrice.hkd) { updated.price = webPrice.hkd; updated.currency = 'HKD'; }
          }
          return updated;
        }));
      }
    } catch (e) {
      console.error('Web lookup failed:', e);
    } finally {
      setWebLoading(prev => { const n = new Set(prev); n.delete(idx.toString()); return n; });
    }
  }, [results]);

  // Batch web lookup for all results
  const handleBatchWebLookup = useCallback(async () => {
    for (let i = 0; i < results.length; i++) {
      await handleWebLookup(i);
      // Small delay to avoid rate limiting
      if (i < results.length - 1) await new Promise(r => setTimeout(r, 300));
    }
  }, [results, handleWebLookup]);

  // ── AI Parse ───────────────────────────────────────────────────────────────
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

  // ── Exports ────────────────────────────────────────────────────────────────
  const handleDownloadCSV = useCallback(() => {
    const rows = [['rawMessage', 'brand', 'reference', 'dialColor', 'price', 'currency', 'condition', 'year', 'confidence', 'verdict', 'model', 'intent', 'webPriceUSD', 'webPriceHKD', 'catalogModel', 'catalogCollection']];
    for (const r of results) {
      rows.push([
        r.rawMessage, r.brand, r.reference, r.dialColor, String(r.price), r.currency,
        r.condition, String(r.year ?? ''), String(r.confidence), r.verdict,
        r.model || '', r.intent,
        String(r.webEnrichment?.webEnrichment?.price?.usd || ''),
        String(r.webEnrichment?.webEnrichment?.price?.hkd || ''),
        r.webEnrichment?.catalogEnrichment?.model || '',
        r.webEnrichment?.catalogEnrichment?.collection || '',
      ]);
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

  const handleDownloadExcel = useCallback(async () => {
    const XLSX = await getXLSX();
    const stamp = new Date().toISOString().slice(0, 10);
    const wb = XLSX.utils.book_new();

    const approved = results.filter(r => r.verdict === 'AUTO_APPROVED');
    const aiReview = results.filter(r => r.verdict === 'AI_REVIEW');
    const human = results.filter(r => r.verdict === 'HUMAN_REVIEW');

    // ── SHEET 1: All Records ─────────────────────────────────────────────────
    const ws1: any[][] = [];
    ws1.push([titleCell(`WatchFacts Parse Export — ${stamp}`)]);
    ws1.push([{
      v: `${results.length.toLocaleString()} records  ·  ${approved.length.toLocaleString()} Auto  ·  ${aiReview.length.toLocaleString()} AI Review  ·  ${human.length.toLocaleString()} Human Review`,
      t: 's',
      s: { font: { sz: 9, italic: true, color: { rgb: 'FF666666' } } },
    }]);
    ws1.push([]);

    const COLS = ['Raw Message', 'Brand', 'Reference', 'Model', 'Dial', 'Price', 'Currency', 'Condition', 'Year', 'Confidence', 'Verdict', 'Intent', 'Catalog Model', 'Catalog Collection', 'Web Price USD', 'Web Price HKD'];
    ws1.push(COLS.map(hCell));

    for (const r of results) {
      const bg = verdictBg(r.verdict);
      ws1.push([
        dCell(r.rawMessage?.slice(0, 120) || '', bg),
        dCell(r.brand, bg),
        dCell(r.reference, bg),
        dCell(r.model || '—', bg),
        dCell(r.dialColor, bg),
        dCell(r.price || 0, bg, 'right'),
        dCell(r.currency, bg, 'center'),
        dCell(r.condition, bg),
        dCell(r.year ?? '—', bg, 'center'),
        dCell(r.confidence, bg, 'right'),
        dCell(r.verdict, bg, 'center'),
        dCell(r.intent, bg, 'center'),
        dCell(r.webEnrichment?.catalogEnrichment?.model || '—', bg),
        dCell(r.webEnrichment?.catalogEnrichment?.collection || '—', bg),
        dCell(r.webEnrichment?.webEnrichment?.price?.usd || '—', bg, 'right'),
        dCell(r.webEnrichment?.webEnrichment?.price?.hkd || '—', bg, 'right'),
      ]);
    }

    const ws1Sheet = XLSX.utils.aoa_to_sheet(ws1);
    ws1Sheet['!cols'] = [
      {wch:55},{wch:18},{wch:16},{wch:18},{wch:12},{wch:12},{wch:10},
      {wch:12},{wch:6},{wch:11},{wch:14},{wch:10},{wch:16},{wch:18},{wch:14},{wch:14},
    ];
    ws1Sheet['!merges'] = [
      { s:{r:0,c:0}, e:{r:0,c:15} },
      { s:{r:1,c:0}, e:{r:1,c:15} },
    ];
    ws1Sheet['!freeze'] = { xSplit: 0, ySplit: 4 };
    XLSX.utils.book_append_sheet(wb, ws1Sheet, 'All Records');

    // ── SHEET 2: Summary ─────────────────────────────────────────────────────
    const ws2: any[][] = [];
    ws2.push([titleCell('Summary')]);
    ws2.push([]);
    ws2.push(['Status','Count','Pct','Avg Confidence','Avg Price'].map(hCell));

    for (const [label, group, bg] of [
      ['AUTO_APPROVED', approved, C.green],
      ['AI_REVIEW', aiReview, C.orange],
      ['HUMAN_REVIEW', human, C.red],
    ] as [string, EnrichedResult[], any][]) {
      const avgConf = group.length
        ? Math.round(group.reduce((s, r) => s + r.confidence, 0) / group.length)
        : 0;
      const avgPrice = group.length
        ? Math.round(group.filter(r => r.price > 0).reduce((s, r) => s + r.price, 0) / Math.max(1, group.filter(r => r.price > 0).length))
        : 0;
      ws2.push([
        dCell(label, bg, 'center'),
        dCell(group.length, bg, 'right'),
        dCell(`${Math.round(group.length / results.length * 100)}%`, bg, 'right'),
        dCell(avgConf, bg, 'right'),
        dCell(avgPrice, bg, 'right'),
      ]);
    }

    ws2.push([]);
    ws2.push([hCell('Total'), dCell(results.length, C.white, 'right'), dCell('100%', C.white, 'right'), dCell('', C.white), dCell('', C.white)]);

    const ws2Sheet = XLSX.utils.aoa_to_sheet(ws2);
    ws2Sheet['!cols'] = [{wch:16},{wch:10},{wch:8},{wch:16},{wch:14}];
    ws2Sheet['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:4} }];
    XLSX.utils.book_append_sheet(wb, ws2Sheet, 'Summary');

    // ── SHEET 3: Brand Breakdown ─────────────────────────────────────────────
    const ws3: any[][] = [];
    ws3.push([titleCell('Brand Breakdown')]);
    ws3.push([]);
    ws3.push(['Brand','Total','Auto','AI Review','Human','Avg Conf','Avg Price'].map(hCell));

    const brands = [...new Set(results.map(r => r.brand))].sort();
    for (const brand of brands) {
      const grp = results.filter(r => r.brand === brand);
      const app = grp.filter(r => r.verdict === 'AUTO_APPROVED').length;
      const ai = grp.filter(r => r.verdict === 'AI_REVIEW').length;
      const hum = grp.filter(r => r.verdict === 'HUMAN_REVIEW').length;
      const avgConf = Math.round(grp.reduce((s, r) => s + r.confidence, 0) / grp.length);
      const priced = grp.filter(r => r.price > 0);
      const avgPrice = priced.length ? Math.round(priced.reduce((s, r) => s + r.price, 0) / priced.length) : 0;
      const appPct = app / grp.length;
      const bg = appPct >= 0.6 ? C.green : hum / grp.length >= 0.5 ? C.red : C.orange;
      ws3.push([
        dCell(brand, bg),
        dCell(grp.length, bg, 'right'),
        dCell(app, bg, 'right'),
        dCell(ai, bg, 'right'),
        dCell(hum, bg, 'right'),
        dCell(avgConf, bg, 'right'),
        dCell(avgPrice, bg, 'right'),
      ]);
    }

    const ws3Sheet = XLSX.utils.aoa_to_sheet(ws3);
    ws3Sheet['!cols'] = [{wch:22},{wch:8},{wch:8},{wch:10},{wch:8},{wch:10},{wch:12}];
    ws3Sheet['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:6} }];
    XLSX.utils.book_append_sheet(wb, ws3Sheet, 'Brand Breakdown');

    XLSX.writeFile(wb, `WatchFacts_Parse_${stamp}.xlsx`);
  }, [results]);

  const handleClear = useCallback(() => {
    setInput('');
    setResults([]);
    setHasAutoRan(false);
  }, []);

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
            Paste raw WhatsApp dealer messages. Regex-first parser → web lookup enrichment → confidence score → auto-approve (≥90%) or AI fallback.
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
          <div className="flex gap-3 mt-4 flex-wrap">
            <button onClick={handleParse}
              className="px-6 py-2.5 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#d4af37', color: '#050505' }}
              disabled={!input.trim()}>
              <Brain className="inline w-4 h-4 mr-2" />Parse & Score
            </button>
            {input.trim() && (
              <div className="flex items-center px-3 text-xs rounded-lg" style={{ backgroundColor: '#111', color: '#888', border: '1px solid #222' }}>
                {input.trim().split('\n').filter(l => l.trim()).length} lines
              </div>
            )}
            {results.length > 0 && (
              <>
                <button onClick={handleClear}
                  className="px-4 py-2.5 rounded-lg text-sm transition-opacity hover:opacity-90"
                  style={{ backgroundColor: '#1a1a1a', color: '#ef4444', border: '1px solid #333' }}>
                  <Trash2 className="inline w-4 h-4 mr-1" />Clear All
                </button>
                <button onClick={handleBatchWebLookup}
                  className="px-4 py-2.5 rounded-lg text-sm transition-opacity hover:opacity-90"
                  style={{ backgroundColor: '#1a1a1a', color: '#60a5fa', border: '1px solid #333' }}>
                  <Search className="inline w-4 h-4 mr-1" />Auto-Enrich All
                </button>
                <button onClick={handleDownloadExcel}
                  className="px-4 py-2.5 rounded-lg text-sm transition-opacity hover:opacity-90"
                  style={{ backgroundColor: '#1a1a1a', color: '#e8e8e8', border: '1px solid #333' }}>
                  <FileSpreadsheet className="inline w-4 h-4 mr-1" />Export Excel
                </button>
                <button onClick={handleDownloadCSV}
                  className="px-4 py-2.5 rounded-lg text-sm transition-opacity hover:opacity-90"
                  style={{ backgroundColor: '#1a1a1a', color: '#e8e8e8', border: '1px solid #333' }}>
                  <Download className="inline w-4 h-4 mr-1" />Export CSV
                </button>
              </>
            )}
          </div>
        </div>

        {/* Batch warning */}
        {results.length >= BATCH_WARN && (
          <div className="mb-4 px-4 py-3 rounded-lg flex items-center gap-2 text-sm"
            style={{ backgroundColor: '#422006', border: '1px solid #854d0e', color: '#eab308' }}>
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span><strong>{results.length}</strong> entries parsed. Shown up to <strong>{BATCH_MAX_RENDER}</strong>. Browser may lag above ~200. Use Export to save, then Clear All to reset.</span>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div>
            {/* Summary bar */}
            <div className="flex gap-3 mb-4 text-xs flex-wrap">
              <div className="px-4 py-2 rounded-lg" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a', color: '#888' }}>
                <span className="font-bold" style={{ color: '#22c55e' }}>{results.filter(r => r.verdict === 'AUTO_APPROVED').length}</span> Auto-Approved
              </div>
              <div className="px-4 py-2 rounded-lg" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a', color: '#888' }}>
                <span className="font-bold" style={{ color: '#eab308' }}>{results.filter(r => r.verdict === 'AI_REVIEW').length}</span> AI-Review
              </div>
              <div className="px-4 py-2 rounded-lg" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a', color: '#888' }}>
                <span className="font-bold" style={{ color: '#ef4444' }}>{results.filter(r => r.verdict === 'HUMAN_REVIEW').length}</span> Human Review
              </div>
              <div className="px-4 py-2 rounded-lg" style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a', color: '#888' }}>
                <span className="font-bold" style={{ color: '#60a5fa' }}>{results.filter(r => r.webEnrichment).length}</span> Enriched
              </div>
            </div>

            {/* Record cards */}
            {results.slice(0, BATCH_MAX_RENDER).map((r, idx) => (
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
                        {r.webEnrichment && <span style={{ color: '#60a5fa' }}>✓ Enriched</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Confidence badge */}
                      <div className="text-xs font-bold px-2.5 py-1 rounded-full"
                        style={{
                          backgroundColor: r.confidence >= 90 ? '#052e16' : r.confidence >= 60 ? '#422006' : '#450a0a',
                          color: r.confidence >= 90 ? '#22c55e' : r.confidence >= 60 ? '#eab308' : '#ef4444',
                          border: '1px solid ' + (r.confidence >= 90 ? '#166534' : r.confidence >= 60 ? '#854d0e' : '#7f1d1d'),
                        }}>
                        {r.confidence}%
                      </div>
                      {/* Verdict badge */}
                      <div className="hidden sm:block text-xs font-bold px-2 py-1 rounded"
                        style={{ backgroundColor: r.verdict === 'AUTO_APPROVED' ? '#052e16' : r.verdict === 'AI_REVIEW' ? '#422006' : '#450a0a' }}>
                        <span className={r.verdict === 'AUTO_APPROVED' ? 'text-green-400' : r.verdict === 'AI_REVIEW' ? 'text-yellow-400' : 'text-red-400'}>
                          {r.verdict === 'AUTO_APPROVED' ? '✓ AUTO' : r.verdict === 'AI_REVIEW' ? '⚡ AI' : '👁 HUMAN'}
                        </span>
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
                      <div className="rounded-lg p-2.5" style={{ backgroundColor: '#111' }}>
                        <div className="text-xs mb-1" style={{ color: '#666' }}>Intent</div>
                        <span className={`text-sm font-medium inline-flex items-center gap-1 ${r.intent === 'SELL' ? 'text-green-400' : r.intent === 'BUY' ? 'text-blue-400' : 'text-yellow-400'}`}>
                          {r.intent === 'SELL' ? '📤 Sell' : r.intent === 'BUY' ? '📥 Buy' : '❓ Inquiry'}
                        </span>
                      </div>
                    </div>

                    {/* Confidence breakdown */}
                    <div className="mt-3 p-3 rounded-lg" style={{ backgroundColor: '#111' }}>
                      <div className="text-xs mb-2" style={{ color: '#888' }}>Confidence Breakdown: {r.confidence}/100 {r.confidenceBoost ? `(+${r.confidenceBoost} from web)` : ''}</div>
                      <div className="flex gap-4 text-xs flex-wrap" style={{ color: '#666' }}>
                        <span style={{ color: r.brand !== 'Unknown' ? '#22c55e' : '#ef4444' }}>Brand +{r.brand !== 'Unknown' ? 30 : 0}</span>
                        <span style={{ color: r.reference ? '#22c55e' : '#ef4444' }}>Ref +{r.reference ? 25 : 0}</span>
                        <span style={{ color: r.dialColor !== 'UNKNOWN' ? '#22c55e' : '#ef4444' }}>Dial +{r.dialColor !== 'UNKNOWN' ? 20 : 0}</span>
                        <span style={{ color: r.price > 0 ? '#22c55e' : '#ef4444' }}>Price +{r.price > 0 ? 20 : 0}{r.price >= 5000 && r.price <= 1_000_000 ? '+5' : ''}</span>
                        {r.confidenceBoost ? <span style={{ color: '#60a5fa' }}>Web +{r.confidenceBoost}</span> : null}
                      </div>
                    </div>

                    {/* Web Enrichment display */}
                    {r.webEnrichment && (
                      <div className="mt-3 p-3 rounded-lg" style={{ backgroundColor: '#0f172a', border: '1px solid #1e3a5f' }}>
                        <div className="text-xs font-semibold mb-2" style={{ color: '#60a5fa' }}>Web Enrichment</div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          {r.webEnrichment.catalogEnrichment?.model && (
                            <div><span style={{ color: '#888' }}>Model: </span><span style={{ color: '#e8e8e8' }}>{r.webEnrichment.catalogEnrichment.model}</span></div>
                          )}
                          {r.webEnrichment.catalogEnrichment?.collection && (
                            <div><span style={{ color: '#888' }}>Collection: </span><span style={{ color: '#e8e8e8' }}>{r.webEnrichment.catalogEnrichment.collection}</span></div>
                          )}
                          {r.webEnrichment.catalogEnrichment?.caseMetal && (
                            <div><span style={{ color: '#888' }}>Case: </span><span style={{ color: '#e8e8e8' }}>{r.webEnrichment.catalogEnrichment.caseMetal}</span></div>
                          )}
                          {r.webEnrichment.webEnrichment?.price?.usd && (
                            <div><span style={{ color: '#888' }}>Web USD: </span><span style={{ color: '#e8e8e8' }}>${r.webEnrichment.webEnrichment.price.usd.toLocaleString()}</span></div>
                          )}
                          {r.webEnrichment.webEnrichment?.price?.hkd && (
                            <div><span style={{ color: '#888' }}>Web HKD: </span><span style={{ color: '#e8e8e8' }}>HK${r.webEnrichment.webEnrichment.price.hkd.toLocaleString()}</span></div>
                          )}
                          {r.webEnrichment.webEnrichment?.topResult && (
                            <div className="col-span-2 sm:col-span-4 mt-1">
                              <span style={{ color: '#888' }}>Source: </span>
                              <a href={r.webEnrichment.webEnrichment.topResult.url} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: '#60a5fa' }}>
                                {r.webEnrichment.webEnrichment.topResult.title?.slice(0, 60) || 'Link'}
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Action area */}
                    {r.verdict !== 'AUTO_APPROVED' && (
                      <div className="mt-3 flex gap-2 flex-wrap">
                        {!r.webEnrichment && (
                          <button onClick={() => handleWebLookup(idx)} disabled={webLoading.has(idx.toString())}
                            className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                            style={{ backgroundColor: '#0f172a', color: '#60a5fa', border: '1px solid #1e3a5f' }}>
                            {webLoading.has(idx.toString()) ? (
                              <span className="inline-flex items-center gap-1">
                                <span className="animate-spin w-3 h-3 border-2 rounded-full inline-block" style={{ borderColor: '#60a5fa', borderTopColor: 'transparent' }} />
                                Looking up...
                              </span>
                            ) : (
                              <><Search className="inline w-3 h-3 mr-1" />Web Lookup</>
                            )}
                          </button>
                        )}
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
                        ) : r.verdict === 'HUMAN_REVIEW' ? (
                          <div className="w-full">
                            <div className="font-semibold mb-2 text-xs" style={{ color: '#eab308' }}>Human Edit — fix fields and confirm</div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                              <div>
                                <span style={{ color: '#888', fontSize: '10px' }}>Brand</span>
                                <select value={r.aiSuggestion?.brand || r.brand}
                                  onChange={(e) => {
                                    const updated = [...results];
                                    updated[idx] = { ...r, brand: e.target.value, aiSuggestion: { ...(r.aiSuggestion || {}), brand: e.target.value } };
                                    setResults(updated);
                                  }}
                                  className="w-full mt-1 p-1 rounded text-xs" style={{ background: '#111', color: '#e8e8e8', border: '1px solid #333' }}>
                                  {['Patek Philippe','Rolex','Audemars Piguet','Richard Mille','Vacheron Constantin','Cartier','IWC','Omega','Tudor','Panerai','Hublot','Breitling','Jaeger-LeCoultre','Grand Seiko','Unknown'].map(b => <option key={b} value={b}>{b}</option>)}
                                </select>
                              </div>
                              <div>
                                <span style={{ color: '#888', fontSize: '10px' }}>Reference</span>
                                <input value={r.aiSuggestion?.reference || r.reference || ''}
                                  onChange={(e) => {
                                    const updated = [...results];
                                    updated[idx] = { ...r, reference: e.target.value, aiSuggestion: { ...(r.aiSuggestion || {}), reference: e.target.value } };
                                    setResults(updated);
                                  }}
                                  className="w-full mt-1 p-1 rounded text-xs font-mono" style={{ background: '#111', color: '#e8e8e8', border: '1px solid #333' }} />
                              </div>
                              <div>
                                <span style={{ color: '#888', fontSize: '10px' }}>Dial Color</span>
                                <input value={r.aiSuggestion?.dialColor || r.dialColor || ''}
                                  onChange={(e) => {
                                    const updated = [...results];
                                    updated[idx] = { ...r, dialColor: e.target.value, aiSuggestion: { ...(r.aiSuggestion || {}), dialColor: e.target.value } };
                                    setResults(updated);
                                  }}
                                  className="w-full mt-1 p-1 rounded text-xs font-mono" style={{ background: '#111', color: '#e8e8e8', border: '1px solid #333' }} />
                              </div>
                              <div>
                                <span style={{ color: '#888', fontSize: '10px' }}>Price</span>
                                <input type="number" value={r.aiSuggestion?.price || r.price || 0}
                                  onChange={(e) => {
                                    const updated = [...results];
                                    updated[idx] = { ...r, price: Number(e.target.value), aiSuggestion: { ...(r.aiSuggestion || {}), price: Number(e.target.value) } };
                                    setResults(updated);
                                  }}
                                  className="w-full mt-1 p-1 rounded text-xs font-mono" style={{ background: '#111', color: '#e8e8e8', border: '1px solid #333' }} />
                              </div>
                            </div>
                            <button onClick={() => {
                              const updated = [...results];
                              updated[idx] = { ...r, verdict: 'AI_REVIEW', aiSuggestion: undefined };
                              setResults(updated);
                              handleAskAI(idx);
                            }}
                              className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90"
                              style={{ backgroundColor: '#422006', color: '#eab308', border: '1px solid #854d0e' }}>
                              <RefreshCw className="inline w-3 h-3 mr-1" />Re-run with Edits
                            </button>
                          </div>
                        ) : (
                          <div className="w-full p-3 rounded-lg text-xs" style={{ backgroundColor: '#1a1a1a', color: '#aaa' }}>
                            <div className="font-semibold mb-2" style={{ color: '#eab308' }}>AI Suggestion</div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              <div><span style={{ color: '#888' }}>Ref: </span>{r.aiSuggestion?.reference}</div>
                              <div><span style={{ color: '#888' }}>Dial: </span>{r.aiSuggestion?.dialColor}</div>
                              <div><span style={{ color: '#888' }}>Price: </span>{r.aiSuggestion?.price?.toLocaleString()}</div>
                              <div><span style={{ color: '#888' }}>Brand: </span>{r.aiSuggestion?.brand}</div>
                            </div>
                            <button onClick={() => {
                              const updated = [...results];
                              updated[idx] = {
                                ...r,
                                brand: r.aiSuggestion?.brand || r.brand,
                                reference: r.aiSuggestion?.reference || r.reference,
                                dialColor: r.aiSuggestion?.dialColor || r.dialColor,
                                price: r.aiSuggestion?.price || r.price,
                                aiSuggestion: undefined,
                                verdict: 'HUMAN_REVIEW',
                              };
                              setResults(updated);
                            }}
                              className="mt-2 px-3 py-1.5 rounded text-[10px] font-semibold transition-opacity hover:opacity-90"
                              style={{ backgroundColor: '#052e16', color: '#22c55e', border: '1px solid #166534' }}>
                              <CheckCircle2 className="inline w-3 h-3 mr-1" />Accept & Edit
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {r.verdict === 'AUTO_APPROVED' && (
                      <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: '#22c55e' }}>
                        <CheckCircle2 className="w-4 h-4" />
                        Auto-approved. Confidence ≥90%. Ready for database.
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {results.length > BATCH_MAX_RENDER && (
              <div className="text-center py-6 text-sm" style={{ color: '#666' }}>
                +{results.length - BATCH_MAX_RENDER} more entries hidden (max {BATCH_MAX_RENDER} displayed). Export Excel/CSV for complete data.
              </div>
            )}
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
        <div className="fixed bottom-6 right-6 rounded-xl p-4 text-xs shadow-xl" style={{ backgroundColor: '#0a0a0a', border: '1px solid #222', maxWidth: '220px' }}>
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
            <div className="flex items-center gap-2" style={{ color: '#60a5fa' }}>
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#60a5fa' }} />
              <span>Web Lookup → +conf</span>
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

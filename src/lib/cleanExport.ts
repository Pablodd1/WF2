/**
 * Export Clean Analysis results as a branded Excel report.
 * Uses xlsx (SheetJS) with styling via the xlsx-style approach
 * (cell styles applied after workbook creation).
 */

import type { CleanWatch, CleanStage, Verdict } from './cleanAnalyze';

// WatchFacts brand colors
const COLORS = {
  navy: { fg: { rgb: 'FFFFFFFF' }, bg: { rgb: 'FF1F4E78' } },
  lightGreen: { bg: { rgb: 'FF90EE90' } },
  orange: { bg: { rgb: 'FFFFA500' } },
  yellow: { bg: { rgb: 'FFFFFFE0' } },
  red: { bg: { rgb: 'FFFF6B6B' } },
  white: { bg: { rgb: 'FFFFFFFF' } },
};

function verdictColor(v: Verdict) {
  if (v === 'APPROVED') return COLORS.lightGreen;
  if (v === 'HUMAN') return COLORS.orange;
  return COLORS.red; // RECYCLE
}

function stageColor(stage: string, verdict?: string) {
  if (verdict === 'MISMATCH') return COLORS.red;
  if (stage === 'PARSE') return COLORS.white;
  if (stage === 'AI_TEXT') return { bg: { rgb: 'FFE0F7FA' } };
  if (stage === 'ONLINE') return { bg: { rgb: 'FFFFF3E0' } };
  if (stage === 'IMAGE') return { bg: { rgb: 'FFF3E5F5' } };
  return COLORS.white;
}

// Build styled cell
function cell(v: any, style?: any) {
  return { v, s: style || {} };
}

function headerCell(v: string) {
  return cell(v, {
    font: { bold: true, color: COLORS.navy.fg, sz: 11 },
    fill: { fgColor: COLORS.navy.bg, patternType: 'solid' },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: {
      top: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      bottom: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      left: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      right: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
    },
  });
}

function dataCell(v: any, bg?: any, align?: string) {
  return cell(v, {
    font: { sz: 10, color: { rgb: 'FF000000' } },
    fill: bg ? { fgColor: bg, patternType: 'solid' } : undefined,
    alignment: { horizontal: align || 'left', vertical: 'center', wrapText: true },
    border: {
      top: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      bottom: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      left: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      right: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
    },
  });
}

function numCell(v: number | null, bg?: any) {
  return cell(v, {
    font: { sz: 10, color: { rgb: 'FF000000' } },
    fill: bg ? { fgColor: bg, patternType: 'solid' } : undefined,
    alignment: { horizontal: 'right', vertical: 'center' },
    numFmt: '#,##0',
    border: {
      top: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      bottom: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      left: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      right: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
    },
  });
}

function pctCell(v: number, bg?: any) {
  return cell(v, {
    font: { sz: 10, color: { rgb: 'FF000000' } },
    fill: bg ? { fgColor: bg, patternType: 'solid' } : undefined,
    alignment: { horizontal: 'right', vertical: 'center' },
    numFmt: '0"%"',
    border: {
      top: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      bottom: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      left: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
      right: { style: 'thin', color: { rgb: 'FFCCCCCC' } },
    },
  });
}

export function exportCleanExcel(watches: CleanWatch[], summary: any) {
  const XLSX = (window as any).XLSX;
  if (!XLSX) {
    // Load xlsx dynamically if not available
    throw new Error('xlsx library not loaded');
  }

  const wb = XLSX.utils.book_new();

  // ═══════════════════════ Sheet 1: Analysis Results ═══════════════════════
  const ws1Data: any[][] = [];

  // Title rows
  ws1Data.push([
    cell('WATCHFACTS CLEAN ANALYSIS REPORT', {
      font: { bold: true, sz: 16, color: { rgb: 'FF1F4E78' } },
      alignment: { horizontal: 'center' },
    }),
  ]);
  ws1Data.push([
    cell(`Generated: ${new Date().toLocaleString()} | Total Watches: ${watches.length} | Threshold: ${summary.threshold}%`, {
      font: { sz: 10, italic: true, color: { rgb: 'FF666666' } },
      alignment: { horizontal: 'center' },
    }),
  ]);
  ws1Data.push([]);

  // Summary metrics row
  ws1Data.push([
    headerCell('SUMMARY'),
    headerCell('Approved'),
    headerCell('Human Review'),
    headerCell('Recycle'),
    headerCell('Total'),
  ]);
  ws1Data.push([
    dataCell('Count'),
    numCell(summary.approved, COLORS.lightGreen.bg),
    numCell(summary.human, COLORS.orange.bg),
    numCell(summary.recycle, COLORS.red.bg),
    numCell(summary.total),
  ]);
  ws1Data.push([
    dataCell('Percentage'),
    pctCell(Math.round((summary.approved / summary.total) * 100), COLORS.lightGreen.bg),
    pctCell(Math.round((summary.human / summary.total) * 100), COLORS.orange.bg),
    pctCell(Math.round((summary.recycle / summary.total) * 100), COLORS.red.bg),
    pctCell(100),
  ]);
  ws1Data.push([]);

  // Per-watch detail headers
  const detailHeaders = [
    '#', 'Input Description', 'Brand', 'Reference', 'Dial', 'Condition',
    'Year', 'Price', 'Currency', 'Confidence', 'Verdict', 'Reason',
    'Has Image', 'Has Link', 'Image URL', 'Page URL',
  ];
  ws1Data.push(detailHeaders.map(h => headerCell(h)));

  // Per-watch data
  watches.forEach((w, i) => {
    const bg = verdictColor(w.verdict).bg;
    ws1Data.push([
      numCell(i + 1, bg),
      dataCell(w.input, bg),
      dataCell(w.parsed.brand, bg),
      dataCell(w.parsed.reference || '—', bg),
      dataCell(w.parsed.dialColor || '—', bg),
      dataCell(w.parsed.condition, bg),
      numCell(w.parsed.year, bg),
      numCell(w.parsed.price, bg),
      dataCell(w.parsed.currency || '—', bg),
      numCell(w.confidence, bg),
      dataCell(w.verdict, bg, 'center'),
      dataCell(w.reason, bg),
      dataCell(w.hasImage ? 'Yes' : 'No', bg, 'center'),
      dataCell(w.hasLink ? 'Yes' : 'No', bg, 'center'),
      dataCell(w.imageUrl || '—', bg),
      dataCell(w.pageUrl || '—', bg),
    ]);
  });

  const ws1 = XLSX.utils.aoa_to_sheet(ws1Data);
  // Set column widths
  ws1['!cols'] = [
    { wch: 5 }, { wch: 50 }, { wch: 16 }, { wch: 16 }, { wch: 12 },
    { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
    { wch: 14 }, { wch: 45 }, { wch: 10 }, { wch: 10 }, { wch: 35 }, { wch: 35 },
  ];
  // Merge title cells
  ws1['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 15 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 15 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 0 } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: 0 } },
    { s: { r: 5, c: 0 }, e: { r: 5, c: 0 } },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'Analysis Results');

  // ═══════════════════════ Sheet 2: Stage Details ═══════════════════════
  const ws2Data: any[][] = [];
  ws2Data.push([
    cell('WATCHFACTS STAGE-BY-STAGE WORKFLOW', {
      font: { bold: true, sz: 16, color: { rgb: 'FF1F4E78' } },
      alignment: { horizontal: 'center' },
    }),
  ]);
  ws2Data.push([
    cell('Every stage for every watch — full visibility into the analysis pipeline', {
      font: { sz: 10, italic: true, color: { rgb: 'FF666666' } },
      alignment: { horizontal: 'center' },
    }),
  ]);
  ws2Data.push([]);

  const stageHeaders = ['Watch #', 'Stage', 'Engine', 'Confidence', 'Verdict', 'Note', 'Extracted Data'];
  ws2Data.push(stageHeaders.map(h => headerCell(h)));

  watches.forEach((w, wi) => {
    w.stages.forEach((s: CleanStage) => {
      const bg = stageColor(s.stage, s.verdict).bg;
      const dataStr = s.data
        ? Object.entries(s.data)
            .filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== 'Unknown')
            .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`)
            .join(' | ')
        : '';

      ws2Data.push([
        numCell(wi + 1, bg),
        dataCell(s.stage, bg),
        dataCell(s.engine, bg),
        numCell(s.confidence, bg),
        dataCell(s.verdict || '—', bg, 'center'),
        dataCell(s.note || s.error || '—', bg),
        dataCell(dataStr || '—', bg),
      ]);
    });
  });

  const ws2 = XLSX.utils.aoa_to_sheet(ws2Data);
  ws2['!cols'] = [
    { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 12 },
    { wch: 12 }, { wch: 50 }, { wch: 55 },
  ];
  ws2['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, 'Stage Details');

  // ═══════════════════════ Sheet 3: Verdict Summary ═══════════════════════
  const ws3Data: any[][] = [];
  ws3Data.push([
    cell('VERDICT SUMMARY', {
      font: { bold: true, sz: 16, color: { rgb: 'FF1F4E78' } },
      alignment: { horizontal: 'center' },
    }),
  ]);
  ws3Data.push([]);

  ws3Data.push([
    headerCell('Verdict'),
    headerCell('Count'),
    headerCell('Percentage'),
    headerCell('Avg Confidence'),
    headerCell('Has Image'),
    headerCell('Has Link'),
  ]);

  const verdicts: Verdict[] = ['APPROVED', 'HUMAN', 'RECYCLE'];
  verdicts.forEach(v => {
    const group = watches.filter(w => w.verdict === v);
    const avgConf = group.length > 0
      ? Math.round(group.reduce((s, w) => s + w.confidence, 0) / group.length)
      : 0;
    const bg = verdictColor(v).bg;
    ws3Data.push([
      dataCell(v, bg, 'center'),
      numCell(group.length, bg),
      pctCell(group.length > 0 ? Math.round((group.length / watches.length) * 100) : 0, bg),
      numCell(avgConf, bg),
      numCell(group.filter(w => w.hasImage).length, bg),
      numCell(group.filter(w => w.hasLink).length, bg),
    ]);
  });

  // Add per-watch quick reference
  ws3Data.push([]);
  ws3Data.push([
    headerCell('#'),
    headerCell('Brand'),
    headerCell('Reference'),
    headerCell('Verdict'),
    headerCell('Confidence'),
    headerCell('Stages'),
  ]);
  watches.forEach((w, i) => {
    const bg = verdictColor(w.verdict).bg;
    ws3Data.push([
      numCell(i + 1, bg),
      dataCell(w.parsed.brand, bg),
      dataCell(w.parsed.reference || '—', bg),
      dataCell(w.verdict, bg, 'center'),
      numCell(w.confidence, bg),
      dataCell(w.stages.map(s => s.stage).join(' → '), bg),
    ]);
  });

  const ws3 = XLSX.utils.aoa_to_sheet(ws3Data);
  ws3['!cols'] = [{ wch: 6 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 30 }];
  ws3['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Verdict Summary');

  // Download
  const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  XLSX.writeFile(wb, `WatchFacts_CleanAnalysis_${now}.xlsx`);
}

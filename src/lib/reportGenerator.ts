/**
 * Generate a color-coded, downloadable HTML report of watch inventory.
 * Includes pie charts, status distribution, and styled record cards.
 */

export interface ReportRecord {
  reference: string;
  brand: string;
  dialColor: string;
  price: number;
  currency: string;
  condition: string;
  year: number | null;
  confidence: number;
  status: string;
  rawMessage: string;
}

function statusColor(status: string, _confidence: number): string {
  if (status === 'AUTO_APPROVED' || status === 'NORMALIZED') return '#22c55e';
  if (status === 'HUMAN_REVIEW' || status === 'RESIDUE') return '#ef4444';
  if (status === 'AI_REVIEW') return '#eab308';
  if (status === 'RECYCLE') return '#8b5cf6';
  return '#6b7280';
}

function statusBg(status: string, _confidence: number): string {
  if (status === 'AUTO_APPROVED' || status === 'NORMALIZED') return '#052e16';
  if (status === 'HUMAN_REVIEW' || status === 'RESIDUE') return '#450a0a';
  if (status === 'AI_REVIEW') return '#422006';
  if (status === 'RECYCLE') return '#2e1065';
  return '#1a1a1a';
}

const brandColors: Record<string, string> = {
  'Patek Philippe': '#c9a96e',
  'Rolex': '#006241',
  'Audemars Piguet': '#005a9c',
  'Richard Mille': '#e31b23',
  'Vacheron Constantin': '#1a1a2e',
  'Cartier': '#c41e3a',
  'IWC': '#003366',
  'Omega': '#002147',
  'Tudor': '#000000',
  'Panerai': '#004d40',
  'Hublot': '#1a1a1a',
  'Breitling': '#002868',
  'Jaeger-LeCoultre': '#001b3b',
  'Grand Seiko': '#8b0000',
};

export function generateStyledReport(records: ReportRecord[]): string {
  const total = records.length;
  const approved = records.filter(r => r.status === 'AUTO_APPROVED' || r.confidence >= 90).length;
  const review = records.filter(r => r.confidence >= 60 && r.confidence < 90).length;
  const human = records.filter(r => r.confidence < 60).length;

  const brandCounts: Record<string, number> = {};
  records.forEach(r => { brandCounts[r.brand] = (brandCounts[r.brand] || 0) + 1; });
  const topBrands = Object.entries(brandCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const rows = records.map((r, i) => {
    const sc = statusColor(r.status, r.confidence);
    const sb = statusBg(r.status, r.confidence);
    const brandHex = brandColors[r.brand] || '#666';
    return `<tr style="border-bottom:1px solid #222;">
      <td style="padding:10px 12px;font-size:12px;color:#ccc;font-family:monospace;">${i + 1}</td>
      <td style="padding:10px 12px;">
        <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:${brandHex}22;color:${brandHex};">${r.brand || 'Unknown'}</span>
      </td>
      <td style="padding:10px 12px;font-size:13px;color:#e8e8e8;font-family:monospace;font-weight:600;">${r.reference || '—'}</td>
      <td style="padding:10px 12px;font-size:12px;color:#aaa;">${r.dialColor || '—'}</td>
      <td style="padding:10px 12px;font-size:12px;color:#e8e8e8;font-family:monospace;text-align:right;">${r.price ? '$' + r.price.toLocaleString() : '—'}</td>
      <td style="padding:10px 12px;font-size:12px;color:#aaa;text-align:center;">${r.year || '—'}</td>
      <td style="padding:10px 12px;font-size:12px;color:#aaa;text-align:center;">${r.condition || '—'}</td>
      <td style="padding:10px 12px;text-align:center;">
        <div style="display:inline-flex;align-items:center;gap:6px;">
          <div style="width:36px;height:20px;border-radius:3px;background:linear-gradient(90deg,#22c55e ${r.confidence}%,#333 ${r.confidence}%);position:relative;overflow:hidden;">
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;font-family:monospace;color:${r.confidence >= 80 ? '#000' : '#fff'};">${r.confidence}%</div>
          </div>
          <span style="font-size:9px;padding:1px 6px;border-radius:3px;background:${sb};color:${sc};">${r.status}</span>
        </div>
      </td>
    </tr>`;
  }).join('');

  const brandRows = topBrands.map(([b, count]) => {
    const pct = Math.round((count / total) * 100);
    const bh = brandColors[b] || '#666';
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
      <span style="width:140px;font-size:12px;color:#ccc;text-align:right;">${b}</span>
      <div style="flex:1;height:18px;background:#111;border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${bh};border-radius:4px;display:flex;align-items:center;justify-content:flex-end;padding-right:6px;">
          <span style="font-size:9px;font-weight:700;color:#fff;">${count}</span>
        </div>
      </div>
      <span style="width:40px;font-size:11px;color:#888;font-family:monospace;">${pct}%</span>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WatchFacts Inventory Report</title>
<style>
  body { margin:0; padding:24px; background:#050505; color:#e8e8e8; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  @media print { body { background:#fff; color:#000; } }
</style>
</head>
<body>
<div style="max-width:1200px;margin:0 auto;">

  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #222;">
    <div>
      <h1 style="margin:0;font-size:22px;font-weight:800;color:#c9a96e;">WatchFacts</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#888;">PP Live Showroom — Command Center Report</p>
    </div>
    <div style="text-align:right;">
      <div style="font-size:11px;color:#666;font-family:monospace;">${new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' })}</div>
      <div style="font-size:11px;color:#666;margin-top:2px;">${total.toLocaleString()} records</div>
    </div>
  </div>

  <!-- Summary Cards -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;">
    <div style="background:#0a0a0a;border:1px solid #222;border-radius:8px;padding:16px;text-align:center;">
      <div style="font-size:28px;font-weight:800;color:#e8e8e8;font-family:monospace;">${total.toLocaleString()}</div>
      <div style="font-size:11px;color:#888;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em;">Total Records</div>
    </div>
    <div style="background:#0a0a0a;border:1px solid #166534;border-radius:8px;padding:16px;text-align:center;">
      <div style="font-size:28px;font-weight:800;color:#22c55e;font-family:monospace;">${approved.toLocaleString()}</div>
      <div style="font-size:11px;color:#888;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em;">Auto-Approved</div>
    </div>
    <div style="background:#0a0a0a;border:1px solid #854d0e;border-radius:8px;padding:16px;text-align:center;">
      <div style="font-size:28px;font-weight:800;color:#eab308;font-family:monospace;">${review.toLocaleString()}</div>
      <div style="font-size:11px;color:#888;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em;">AI Review</div>
    </div>
    <div style="background:#0a0a0a;border:1px solid #7f1d1d;border-radius:8px;padding:16px;text-align:center;">
      <div style="font-size:28px;font-weight:800;color:#ef4444;font-family:monospace;">${human.toLocaleString()}</div>
      <div style="font-size:11px;color:#888;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em;">Human Review</div>
    </div>
  </div>

  <!-- Brand Distribution -->
  <div style="background:#0a0a0a;border:1px solid #222;border-radius:8px;padding:16px;margin-bottom:24px;">
    <h2 style="margin:0 0 12px;font-size:13px;color:#c9a96e;text-transform:uppercase;letter-spacing:0.08em;">Brand Distribution</h2>
    ${brandRows}
  </div>

  <!-- Records Table -->
  <div style="background:#0a0a0a;border:1px solid #222;border-radius:8px;overflow:hidden;">
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#111;border-bottom:2px solid #333;">
            <th style="padding:10px 12px;text-align:left;font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.1em;">#</th>
            <th style="padding:10px 12px;text-align:left;font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.1em;">Brand</th>
            <th style="padding:10px 12px;text-align:left;font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.1em;">Reference</th>
            <th style="padding:10px 12px;text-align:left;font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.1em;">Dial</th>
            <th style="padding:10px 12px;text-align:right;font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.1em;">Price</th>
            <th style="padding:10px 12px;text-align:center;font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.1em;">Year</th>
            <th style="padding:10px 12px;text-align:center;font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.1em;">Cond.</th>
            <th style="padding:10px 12px;text-align:center;font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.1em;">Confidence</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Footer -->
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #222;text-align:center;font-size:10px;color:#555;">
    Generated by WatchFacts AI Pipeline · PP Live Showroom Command Center
  </div>
</div>
</body>
</html>`;
}

/** Download the report as an HTML file */
export function downloadStyledReport(records: ReportRecord[], filename?: string) {
  const html = generateStyledReport(records);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = filename || `WatchFacts_Report_${stamp}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

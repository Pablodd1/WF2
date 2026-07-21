'use strict';

const fs = require('node:fs');
const readline = require('node:readline');

const inputPath = process.env.DUPLICATE_CANDIDATE_CSV;
const apply = String(process.env.APPLY_DUPLICATE_REVIEW_CANDIDATES || 'false').toLowerCase() === 'true';
const maxRows = Math.max(1, Math.min(Number(process.env.DUPLICATE_CANDIDATE_MAX_ROWS || 100), 1000));

function required(name) {
  const value = String(process.env[name] || '').trim().replace(/\/$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseCsvLine(line) {
  const cells = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  cells.push(value);
  return cells;
}

async function readCandidates(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('DUPLICATE_CANDIDATE_CSV must point to a readable candidate-clusters.csv');
  const input = fs.createReadStream(filePath);
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  const rows = [];
  let headers = null;
  for await (const line of reader) {
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    if (!headers) {
      headers = cells;
      continue;
    }
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] || '']));
    rows.push(row);
    if (rows.length >= maxRows) break;
  }
  return rows;
}

async function upsertRows(baseUrl, key, rows) {
  const payload = rows.map(row => ({
    canonical_id: row.canonical_id,
    duplicate_id: row.candidate_id,
    match_type: row.category || 'UNCLASSIFIED',
    confidence: Math.min(1, Math.max(0, Number(row.confidence) || 0)),
    suppress_from_analytics: String(row.suppress_from_analytics).toLowerCase() === 'true',
    bundle_risk: String(row.bundle_risk).toLowerCase() === 'true',
    evidence: {
      canonical_date: row.canonical_date || null,
      candidate_date: row.candidate_date || null,
      reference: row.reference || null,
      dial: row.dial || null,
      condition: row.condition || null,
      canonical_price: row.canonical_price || null,
      candidate_price: row.candidate_price || null,
      source_hash: row.source_hash || null,
      source_report: inputPath,
    },
  }));
  const response = await fetch(`${baseUrl}/rest/v1/duplicate_review_candidates?on_conflict=canonical_id,duplicate_id`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
}

async function main() {
  const rows = await readCandidates(inputPath);
  const invalid = rows.filter(row => !row.canonical_id || !row.candidate_id || row.canonical_id === row.candidate_id);
  if (invalid.length) throw new Error(`Invalid duplicate candidate rows: ${invalid.length}`);
  if (apply && rows.length) await upsertRows(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), rows);
  process.stdout.write(`${JSON.stringify({ event: 'duplicate_review_candidates_staged', rows: rows.length, invalid: invalid.length, write: apply, publicRowsMutated: 0 })}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'duplicate_review_candidates_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { parseCsvLine, readCandidates };

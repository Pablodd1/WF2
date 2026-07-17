'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { classifyPair, hash, signaturesFor, sourceIdentity } = require('./duplicate-signatures.cjs');

const brand = process.env.DUPLICATE_AUDIT_BRAND || 'Patek Philippe';
const pageSize = Math.min(1000, Math.max(50, Number(process.env.DUPLICATE_AUDIT_PAGE_SIZE || 500)));
const maxRows = Math.max(0, Number(process.env.DUPLICATE_AUDIT_MAX_ROWS || 0));
const outputRoot = path.resolve(process.env.DUPLICATE_AUDIT_OUTPUT || 'audit-output/duplicates');
const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const outputDir = path.join(outputRoot, slug);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/$/, '');
}

function csv(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function chooseCanonical(left, right) {
  const leftDate = Date.parse(left.created_at || '') || 0;
  const rightDate = Date.parse(right.created_at || '') || 0;
  if (rightDate !== leftDate) return rightDate > leftDate ? right : left;
  return String(right.id).localeCompare(String(left.id)) > 0 ? right : left;
}

function likelyBundle(raw) {
  const text = String(raw || '');
  const refs = text.match(/\b\d{3,6}(?:\/[0-9A-Z-]{1,12})?(?:-[0-9A-Z]{1,8})?\b/gi) || [];
  return new Set(refs.map(value => value.toUpperCase())).size >= 3 || text.split(/\r?\n/).filter(Boolean).length >= 8;
}

async function fetchPage(baseUrl, serviceKey, lastId) {
  const params = new URLSearchParams({
    select: 'id,brand,reference,dial_color,condition,price_usd,currency,raw_message,created_at,listing_type,source,source_type,seller_phone,seller_name,flags',
    brand: `eq.${brand}`,
    order: 'id.asc',
    limit: String(pageSize),
  });
  if (lastId) params.set('id', `gt.${lastId}`);
  const response = await fetch(`${baseUrl}/rest/v1/watch_records?${params}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  return response.json();
}

function writeSummary(summary, samples) {
  const lines = [
    `# ${brand} Duplicate Audit`, '', `Generated: ${new Date().toISOString()}`, '',
    '## Scope', '',
    `- Rows scanned: ${summary.rowsScanned.toLocaleString()}`,
    `- Rows with bundle-like source text: ${summary.bundleRows.toLocaleString()}`,
    `- Candidate duplicate members: ${summary.candidateMembers.toLocaleString()}`,
    `- Safe automatic suppressions proposed: ${summary.safeSuppressions.toLocaleString()}`,
    `- Review-only candidates: ${summary.reviewOnly.toLocaleString()}`, '',
    '## Categories', '',
    ...Object.entries(summary.categories).sort().map(([key, value]) => `- ${key}: ${value.toLocaleString()}`), '',
    '## Interpretation', '',
    'This is a read-only candidate report. No production row was deleted, modified, or hidden. Bundle-like rows are not eligible for automatic suppression because normalized columns may belong to different lines in the source message.', '',
    'Different dealers are not automatically merged. Price updates remain historical market observations. A changed date raises a repost candidate but does not prove physical-watch identity.', '',
    '## Redacted Examples', '',
    ...samples.map(sample => `- ${sample.type}: canonical ${sample.canonicalId}; candidate ${sample.candidateId}; confidence ${sample.confidence}; source ${sample.sourceHash}`), '',
  ];
  fs.writeFileSync(path.join(outputDir, 'summary.md'), `${lines.join('\n')}\n`);
}

async function main() {
  const baseUrl = required('SUPABASE_URL');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  fs.mkdirSync(outputDir, { recursive: true });
  const stream = fs.createWriteStream(path.join(outputDir, 'candidate-clusters.csv'), { encoding: 'utf8' });
  stream.write('category,confidence,suppress_from_analytics,canonical_id,candidate_id,canonical_date,candidate_date,reference,dial,condition,canonical_price,candidate_price,source_hash,bundle_risk\n');
  const indexes = { exactRaw: new Map(), exactListing: new Map(), dateAgnosticRaw: new Map(), configuration: new Map(), marketConfiguration: new Map() };
  const summary = { rowsScanned: 0, bundleRows: 0, candidateMembers: 0, safeSuppressions: 0, reviewOnly: 0, categories: {} };
  const samples = [];
  let lastId = '';

  while (!maxRows || summary.rowsScanned < maxRows) {
    const rows = await fetchPage(baseUrl, serviceKey, lastId);
    if (!rows.length) break;
    for (const row of rows) {
      if (maxRows && summary.rowsScanned >= maxRows) break;
      summary.rowsScanned += 1;
      lastId = row.id;
      const bundleRisk = likelyBundle(row.raw_message);
      if (bundleRisk) summary.bundleRows += 1;
      const signatures = signaturesFor(row);
      const matches = [];
      for (const key of Object.keys(indexes)) {
        const signature = signatures[key];
        if (signature && indexes[key].has(signature)) matches.push(indexes[key].get(signature));
      }
      const uniqueMatches = [...new Map(matches.map(match => [match.id, match])).values()];
      let best = null;
      for (const match of uniqueMatches) {
        const classification = classifyPair(match, row);
        if (classification && (!best || classification.confidence > best.classification.confidence)) best = { match, classification };
      }
      if (best) {
        const canonical = chooseCanonical(best.match, row);
        const candidate = canonical.id === row.id ? best.match : row;
        const safe = best.classification.suppressFromAnalytics && !bundleRisk && !likelyBundle(best.match.raw_message);
        summary.candidateMembers += 1;
        summary.categories[best.classification.type] = (summary.categories[best.classification.type] || 0) + 1;
        if (safe) summary.safeSuppressions += 1; else summary.reviewOnly += 1;
        const sourceHash = hash(sourceIdentity(row)).slice(0, 12);
        stream.write([
          best.classification.type, best.classification.confidence.toFixed(2), safe, canonical.id, candidate.id,
          canonical.created_at || '', candidate.created_at || '', canonical.reference, canonical.dial_color,
          canonical.condition, canonical.price_usd, candidate.price_usd, sourceHash,
          bundleRisk || likelyBundle(best.match.raw_message),
        ].map(csv).join(',') + '\n');
        if (samples.length < 20) samples.push({ type: best.classification.type, canonicalId: canonical.id, candidateId: candidate.id, confidence: best.classification.confidence.toFixed(2), sourceHash });
      }
      for (const key of Object.keys(indexes)) {
        const signature = signatures[key];
        if (!signature) continue;
        const current = indexes[key].get(signature);
        indexes[key].set(signature, current ? chooseCanonical(current, row) : row);
      }
    }
    process.stdout.write(`${JSON.stringify({ event: 'duplicate_audit_page', brand, rowsScanned: summary.rowsScanned, candidates: summary.candidateMembers, lastId })}\n`);
    if (rows.length < pageSize) break;
  }
  await new Promise((resolve, reject) => stream.end(error => error ? reject(error) : resolve()));
  writeSummary(summary, samples);
  fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify({ brand, generatedAt: new Date().toISOString(), ...summary }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'duplicate_audit_complete', brand, outputDir, ...summary })}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'duplicate_audit_error', brand, error: error.message })}\n`);
  process.exitCode = 1;
});

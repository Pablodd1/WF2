'use strict';

const fs = require('node:fs');
const path = require('node:path');

const pageSize = Math.min(1000, Math.max(100, Number(process.env.MULTILISTING_PAGE_SIZE || 500)));
const maxRows = Math.max(0, Number(process.env.MULTILISTING_MAX_ROWS || 0));
const outputDir = path.resolve(process.env.MULTILISTING_OUTPUT || 'audit-output/multilistings');
const reset = String(process.env.MULTILISTING_RESET || 'false').toLowerCase() === 'true';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/$/, '');
}

async function fetchJson(baseUrl, key, resource, params) {
  const response = await fetch(`${baseUrl}/rest/v1/${resource}?${params}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

async function fetchShadowPage(baseUrl, key, lastId) {
  const params = new URLSearchParams({
    select: 'source_record_id,candidate_count,proposed_candidates,change_flags,review_status,analyzed_at',
    change_flags: 'cs.{BUNDLE_SPLIT_REQUIRED}',
    order: 'source_record_id.asc',
    limit: String(pageSize),
  });
  if (lastId) params.set('source_record_id', `gt.${lastId}`);
  return fetchJson(baseUrl, key, 'normalization_shadow_v4', params);
}

async function fetchSources(baseUrl, key, ids) {
  if (!ids.length) return [];
  const params = new URLSearchParams({
    select: 'id,raw_message,brand,reference,listing_type,created_at,source,seller_name,seller_phone',
    id: `in.(${ids.map(id => `"${String(id).replaceAll('"', '')}"`).join(',')})`,
  });
  return fetchJson(baseUrl, key, 'watch_records', params);
}

async function main() {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'multilistings.jsonl');
  const checkpointPath = path.join(outputDir, 'checkpoint.json');
  if (reset) {
    fs.rmSync(outputPath, { force: true });
    fs.rmSync(checkpointPath, { force: true });
  }
  const checkpoint = fs.existsSync(checkpointPath)
    ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8'))
    : { lastId: '', exported: 0, completed: false };
  if (checkpoint.completed) {
    process.stdout.write(`${JSON.stringify({ event: 'multilisting_export_already_complete', ...checkpoint })}\n`);
    return;
  }

  let lastId = checkpoint.lastId || '';
  let exported = Number(checkpoint.exported || 0);
  while (!maxRows || exported < maxRows) {
    const shadowRows = await fetchShadowPage(baseUrl, key, lastId);
    if (!shadowRows.length) break;
    const boundedRows = maxRows ? shadowRows.slice(0, Math.max(0, maxRows - exported)) : shadowRows;
    const sources = await fetchSources(baseUrl, key, boundedRows.map(row => row.source_record_id));
    const sourceById = new Map(sources.map(row => [row.id, row]));
    const lines = boundedRows.map(row => JSON.stringify({
      ...row,
      source: sourceById.get(row.source_record_id) || null,
      review_policy: {
        parent_immutable: true,
        split_children_before_duplicate_review: true,
        suppress_parent_only_after_approval: true,
      },
    })).join('\n');
    if (lines) fs.appendFileSync(outputPath, `${lines}\n`);
    exported += boundedRows.length;
    lastId = boundedRows.at(-1)?.source_record_id || lastId;
    const nextCheckpoint = { lastId, exported, completed: false, updatedAt: new Date().toISOString(), outputPath };
    fs.writeFileSync(`${checkpointPath}.tmp`, `${JSON.stringify(nextCheckpoint, null, 2)}\n`);
    fs.renameSync(`${checkpointPath}.tmp`, checkpointPath);
    process.stdout.write(`${JSON.stringify({ event: 'multilisting_export_page', exported, lastId })}\n`);
    if (shadowRows.length < pageSize || boundedRows.length < shadowRows.length) break;
  }
  const completed = !maxRows || exported < maxRows;
  const finalCheckpoint = { lastId, exported, completed, updatedAt: new Date().toISOString(), outputPath };
  fs.writeFileSync(checkpointPath, `${JSON.stringify(finalCheckpoint, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'multilisting_export_complete', ...finalCheckpoint })}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'multilisting_export_error', error: error.message })}\n`);
  process.exitCode = 1;
});

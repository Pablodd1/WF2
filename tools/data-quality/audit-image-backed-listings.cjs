'use strict';

const path = require('node:path');
const { confirmCatalogCandidate } = require('../../api/_lib/catalog-confirmation.cjs');
const { supabaseFetch, writeCsv, writeJson } = require('./recovery-control.cjs');

async function paged(table, select, extra = '') {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const query = new URLSearchParams({ select, limit: '1000', offset: String(offset) });
    const page = await supabaseFetch(`/rest/v1/${table}?${query}${extra}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function auditImageRows(records, manifest) {
  const manifestsByRecord = new Map();
  const urlOwners = new Map();
  for (const item of manifest) {
    if (item.matched_record_id) {
      const entries = manifestsByRecord.get(item.matched_record_id) || [];
      entries.push(item);
      manifestsByRecord.set(item.matched_record_id, entries);
    }
    if (item.public_url && item.matched_record_id) {
      const owners = urlOwners.get(item.public_url) || new Set();
      owners.add(item.matched_record_id);
      urlOwners.set(item.public_url, owners);
    }
  }

  return records.map(record => {
    const linked = manifestsByRecord.get(record.id) || [];
    const confirmation = confirmCatalogCandidate(record);
    const brandConflict = confirmation.reason === 'CATALOG_BRAND_CONFLICT';
    const dialConflict = confirmation.confirmed && confirmation.dialConfirmed === false;
    const duplicateOwner = linked.some(item => (urlOwners.get(item.public_url)?.size || 0) > 1);
    const manifestMissing = linked.length === 0;
    const issues = [
      manifestMissing && 'MANIFEST_MISSING',
      duplicateOwner && 'URL_LINKED_TO_MULTIPLE_RECORDS',
      brandConflict && 'CATALOG_BRAND_CONFLICT',
      dialConflict && 'CATALOG_DIAL_CONFLICT',
    ].filter(Boolean);
    return {
      record_id: record.id,
      brand: record.brand,
      model: record.model,
      reference: record.reference,
      dial_color: record.dial_color,
      thumbnail_url: record.thumbnail_url,
      manifest_objects: linked.length,
      image_status: issues.length ? 'REJECT_STRUCTURAL' : 'VISUAL_REVIEW_REQUIRED',
      issues: issues.join('|'),
      catalog_reason: confirmation.reason || '',
    };
  });
}

async function run() {
  const [records, manifest] = await Promise.all([
    paged(
      'watch_records',
      'id,brand,model,reference,dial_color,has_images,thumbnail_url',
      '&or=(has_images.eq.true,thumbnail_url.not.is.null)',
    ),
    paged(
      'media_manifest',
      'source_object_key,public_url,matched_record_id,migration_status,verification_status',
      '&matched_record_id=not.is.null',
    ),
  ]);
  const audited = auditImageRows(records, manifest);
  const counts = audited.reduce((result, row) => {
    result[row.image_status] = (result[row.image_status] || 0) + 1;
    for (const issue of row.issues.split('|').filter(Boolean)) {
      result[issue] = (result[issue] || 0) + 1;
    }
    return result;
  }, {});
  const stamp = new Date().toISOString().slice(0, 10);
  const folder = process.env.IMAGE_AUDIT_OUTPUT
    || path.join('audit-output', 'data-quality', `image-backed-${stamp}`);
  writeJson(path.join(folder, 'summary.json'), {
    generated_at: new Date().toISOString(),
    read_only: true,
    records_scanned: records.length,
    manifest_rows_scanned: manifest.length,
    counts,
    important: 'VISUAL_REVIEW_REQUIRED is not visual verification.',
  });
  writeCsv(path.join(folder, 'image-review.csv'), audited, [
    'record_id', 'brand', 'model', 'reference', 'dial_color', 'thumbnail_url',
    'manifest_objects', 'image_status', 'issues', 'catalog_reason',
  ]);
  process.stdout.write(`${JSON.stringify({
    event: 'image_backed_audit_complete',
    output: folder,
    records_scanned: records.length,
    manifest_rows_scanned: manifest.length,
    counts,
  }, null, 2)}\n`);
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'image_backed_audit_error',
      error: error.message,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { auditImageRows };

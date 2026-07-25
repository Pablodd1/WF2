'use strict';

const path = require('node:path');
const { supabaseFetch, writeJson } = require('./recovery-control.cjs');

async function run() {
  const report = await supabaseFetch('/rest/v1/rpc/global_data_quality_blocker_counts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const query = new URLSearchParams({
    select: 'id,brand,reference,dial_color,listing_type,has_images,thumbnail_url',
    order: 'created_at.desc,id.desc',
    limit: '100',
  });
  const sample = await supabaseFetch(`/rest/v1/trading_floor_verified_listings?${query}`);
  const ids = sample.map(row => row.id);
  const reviews = ids.length
    ? await supabaseFetch(`/rest/v1/listing_identity_reviews?${new URLSearchParams({
      select: 'record_id,status',
      record_id: `in.(${ids.join(',')})`,
    })}`)
    : [];
  const statusById = new Map(reviews.map(row => [row.record_id, row.status]));
  const identityLeaks = sample.filter(row => !['CATALOG_CONFIRMED', 'HUMAN_APPROVED'].includes(statusById.get(row.id)));
  const imageIds = sample.filter(row => row.has_images || row.thumbnail_url).map(row => row.id);
  const imageReviews = imageIds.length
    ? await supabaseFetch(`/rest/v1/listing_image_reviews?${new URLSearchParams({
      select: 'record_id,status',
      record_id: `in.(${imageIds.join(',')})`,
      status: 'eq.VISUALLY_VERIFIED',
    })}`)
    : [];
  const verifiedImageIds = new Set(imageReviews.map(row => row.record_id));
  const imageLeaks = sample.filter(row => (row.has_images || row.thumbnail_url) && !verifiedImageIds.has(row.id));
  const result = {
    generated_at: new Date().toISOString(),
    blocker_report: report,
    verified_sample_rows: sample.length,
    identity_leaks: identityLeaks.map(row => row.id),
    image_leaks: imageLeaks.map(row => row.id),
    passed: identityLeaks.length === 0 && imageLeaks.length === 0,
  };
  const output = process.env.RECOVERY_READBACK_OUTPUT
    || path.join('audit-output', 'data-quality', `recovery-readback-${new Date().toISOString().slice(0, 10)}.json`);
  writeJson(output, result);
  process.stdout.write(`${JSON.stringify({
    event: 'recovery_readback_complete',
    output,
    ...result,
  }, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'recovery_readback_error',
      error: error.message,
    })}\n`);
    process.exitCode = 1;
  });
}

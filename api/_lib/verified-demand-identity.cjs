'use strict';

const WATCH_RECORD_BATCH_SIZE = 100;
const MAX_BATCH_CONCURRENCY = 3;

function clean(value) {
  const text = String(value || '').trim();
  return text || null;
}

function exactReferenceVariants(values) {
  return [...new Set((values || []).flatMap(value => {
    const reference = clean(value);
    return reference ? [reference, reference.toUpperCase(), reference.toLowerCase()] : [];
  }))];
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function mapWithConcurrency(values, concurrency, task) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await task(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function loadVerifiedDemandIdentityRows(client, {
  brand,
  referenceVariants,
  limit = 500,
  watchColumns,
}) {
  const normalizedBrand = clean(brand);
  const references = exactReferenceVariants(referenceVariants);
  const boundedLimit = Math.min(1000, Math.max(1, Number(limit) || 500));
  if (!normalizedBrand || !references.length) return { rows: [], sampleCapped: false };

  const { data: reviewData, error: reviewError } = await client
    .from('listing_identity_reviews')
    .select('record_id,canonical_brand,canonical_model,canonical_reference,canonical_dial_color,status')
    .eq('canonical_brand', normalizedBrand)
    .in('canonical_reference', references)
    .in('status', ['CATALOG_CONFIRMED', 'HUMAN_APPROVED'])
    .order('record_id', { ascending: false })
    .limit(boundedLimit + 1);
  if (reviewError) throw reviewError;

  const sampleCapped = (reviewData || []).length > boundedLimit;
  const reviews = (reviewData || []).slice(0, boundedLimit);
  const recordIds = [...new Set(reviews.map(row => clean(row.record_id)).filter(Boolean))];
  if (!recordIds.length) return { rows: [], sampleCapped };

  const batches = chunks(recordIds, WATCH_RECORD_BATCH_SIZE);
  const results = await mapWithConcurrency(batches, MAX_BATCH_CONCURRENCY, batch => client
    .from('watch_records')
    .select(watchColumns)
    .in('id', batch)
    .in('listing_type', ['WTB', 'NTQ'])
    .or('listing_status.is.null,listing_status.not.in.(HIDDEN,REJECTED,DELETED)'));
  const recordError = results.find(result => result?.error)?.error;
  if (recordError) throw recordError;

  const recordsById = new Map(results
    .flatMap(result => result?.data || [])
    .map(row => [String(row.id), row]));
  const rows = reviews.flatMap(review => {
    const row = recordsById.get(String(review.record_id));
    if (!row) return [];
    return [{
      ...row,
      brand: clean(review.canonical_brand) || row.brand,
      model: clean(review.canonical_model) || row.model,
      reference: clean(review.canonical_reference) || row.reference,
      dial_color: clean(review.canonical_dial_color) || row.dial_color,
      owner_reviewed_identity: true,
      identity_review_status: review.status,
    }];
  });

  return { rows, sampleCapped };
}

module.exports = {
  MAX_BATCH_CONCURRENCY,
  WATCH_RECORD_BATCH_SIZE,
  exactReferenceVariants,
  loadVerifiedDemandIdentityRows,
};

'use strict';

async function loadVerifiedListingRows(client, ids) {
  const uniqueIds = [...new Set((ids || []).map(String).filter(Boolean))];
  if (!uniqueIds.length) return new Map();

  const batches = [];
  for (let index = 0; index < uniqueIds.length; index += 100) {
    batches.push(uniqueIds.slice(index, index + 100));
  }
  const results = await Promise.all(batches.map(batch => client
    .from('trading_floor_verified_listings')
    .select('id,brand,model,reference,dial_color,has_images,thumbnail_url,image_urls')
    .in('id', batch)));
  const error = results.find(result => result.error)?.error;
  if (error) throw error;

  return new Map(results
    .flatMap(result => result.data || [])
    .map(row => [String(row.id), row]));
}

module.exports = { loadVerifiedListingRows };

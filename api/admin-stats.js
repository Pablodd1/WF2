/** ADMIN STATS — live production summary for the owner dashboard. */
const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

async function plannedCount(client, configure) {
  let query = client.from('watch_records').select('id', { count: 'planned', head: true });
  if (configure) query = configure(query);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authorization = await authorizeDealer(req, res);
  if (authorization.error) return res.status(authorization.status).json({ error: authorization.error });
  const client = authorization.client;

  try {
    const types = ['WTS', 'WTB', 'NTQ', 'TRADE', 'MULTI', 'OTHER'];
    const [totalRecords, approved, human, recycle, typeEstimates, sampleResult, patekRecords, patekWts, patekImages] = await Promise.all([
      plannedCount(client),
      plannedCount(client, query => query.eq('verdict', 'APPROVED')),
      plannedCount(client, query => query.eq('verdict', 'HUMAN')),
      plannedCount(client, query => query.eq('verdict', 'RECYCLE')),
      Promise.all(types.map(async type => [type, await plannedCount(client, query => query.eq('listing_type', type))])),
      client.from('watch_records')
        .select('reference,price_usd,brand,dial_color,year,confidence,created_at')
        .order('created_at', { ascending: false })
        .limit(1000),
      plannedCount(client, query => query.eq('brand', 'Patek Philippe')),
      plannedCount(client, query => query.eq('brand', 'Patek Philippe').eq('verdict', 'APPROVED').eq('listing_type', 'WTS')),
      plannedCount(client, query => query.eq('brand', 'Patek Philippe').eq('has_images', true)),
    ]);
    if (sampleResult.error) throw sampleResult.error;

    const sample = sampleResult.data || [];
    const missing = value => value == null || String(value).trim() === '';
    const unknown = value => missing(value) || ['UNKNOWN', 'UNSPECIFIED', 'N/A', 'NA'].includes(String(value).trim().toUpperCase());
    const confidences = sample.map(row => Number(row.confidence)).filter(Number.isFinite);
    const typeCounts = Object.fromEntries(typeEstimates);

    // Planner estimates return 1 for an empty rare category. Confirm those
    // categories with a bounded existence lookup so the admin panel never
    // claims inventory that is not actually present.
    await Promise.all(types.filter(type => typeCounts[type] <= 1).map(async type => {
      const { data, error } = await client.from('watch_records').select('id').eq('listing_type', type).limit(1);
      if (error) throw error;
      typeCounts[type] = data?.length ? Math.max(1, typeCounts[type]) : 0;
    }));

    return res.status(200).json({
      success: true,
      countsEstimated: true,
      totalRecords,
      approved,
      human,
      recycle,
      typeCounts,
      patek: { records: patekRecords, approvedWts: patekWts, imageBacked: patekImages, countsEstimated: true },
      qualitySampleSize: sample.length,
      missingRef: sample.filter(row => missing(row.reference)).length,
      missingPrice: sample.filter(row => !Number.isFinite(Number(row.price_usd)) || Number(row.price_usd) <= 0).length,
      unknownBrand: sample.filter(row => unknown(row.brand)).length,
      unknownDial: sample.filter(row => unknown(row.dial_color)).length,
      missingYear: sample.filter(row => missing(row.year)).length,
      avgConfidence: confidences.length ? Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length) : 0,
      lastUpdatedAt: sample[0]?.created_at || null,
    });
  } catch (error) {
    console.error('[admin-stats] error:', error.message);
    return res.status(500).json({ error: 'Failed to load live admin statistics' });
  }
};

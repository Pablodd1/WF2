/**
 * EXPORT EXCEL — /api/export-excel?reference=126610LN&brand=Rolex
 *
 * Server-side Excel generation. Reads APPROVED listings from Supabase,
 * builds an .xlsx buffer, and returns it as a download. No browser memory
 * limit — handles 5000+ rows. Query mirrors price-research.js exactly.
 *
 * GET /api/export-excel?reference=126610LN&brand=Rolex
 * Returns: Content-Type application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 */
const { getClient } = require('./_lib/supabase');
const { inferBrand } = require('./_lib/resolve');
const { redactPublicSource } = require('./_lib/source-redaction.cjs');
const { csvCell } = require('./_lib/csv-cell.cjs');
const { deterministicCandidateCount, loadShadowBundleParentIds } = require('./_lib/unsplit-bundle-filter.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let reference = (req.query.reference || '').trim();
  let brand = (req.query.brand || '').trim();

  if (!reference) return res.status(400).json({ error: 'reference required' });
  if (!brand) {
    brand = inferBrand(reference);
    if (!brand) return res.status(400).json({ error: 'brand not found — provide ?brand= explicitly' });
  }

  try {
    const client = getClient();

    // Resolve reference prefix (same as price-research)
    let targetRef = reference;
    if (reference.length >= 3) {
      const { data: refs, error: refError } = await client
        .from('watch_records')
        .select('reference')
        .eq('brand', brand)
        .eq('verdict', 'APPROVED')
        .ilike('reference', `${reference}%`)
        .limit(50);
      if (!refError && refs && refs.length > 0) {
        const uq = [...new Set(refs.map(r => r.reference))];
        targetRef = uq.find(r => r === reference) || uq[0];
      }
    }

    const { data: rows, error } = await client
      .from('watch_records')
      .select('id,price_usd,created_at,listing_date,condition,source,dial_color,raw_message,flags,year,listing_type')
      .eq('brand', brand)
      .eq('reference', targetRef)
      .eq('verdict', 'APPROVED')
      .eq('listing_type', 'WTS')
      .or('listing_status.is.null,listing_status.not.in.(HIDDEN,REJECTED,DELETED)')
      .order('created_at', { ascending: false })
      .limit(5000);

    if (error) throw error;
    if (!rows || !rows.length) {
      return res.status(200).json({ success: true, row_count: 0, message: 'No listings found' });
    }

    const excluded = new Set(['bulk_test_100', 'test_run', 'mysql_market_refs']);
    const shadowBundleIds = await loadShadowBundleParentIds(client, rows);
    const clean = rows.filter(row => (
      !excluded.has(row.source)
      && !shadowBundleIds.has(row.id)
      && deterministicCandidateCount(row) <= 1
    ));

    // Build CSV (server-friendly, 10x smaller than XLSX for same data)
    const header = 'price_usd,listing_date,dial_color,condition,year,source,raw_message';
    const csvRows = clean.map(r => [
      r.price_usd,
      r.listing_date,
      r.dial_color,
      r.condition,
      r.year,
      r.source,
      redactPublicSource(r.raw_message),
    ].map(csvCell).join(','));
    const csv = header + '\n' + csvRows.join('\n');
    const filename = `price-research_${targetRef}_${brand.replace(/\s+/g, '_')}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error('[export-excel] error:', err.message);
    return res.status(500).json({ error: 'Export failed', detail: err.message });
  }
};

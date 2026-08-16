'use strict';

const { getClient } = require('./_lib/supabase.js');
const { tokensMatch } = require('./_lib/require-service-token.cjs');

const TABLE = 'reviewed_workbook_inventory';
const MAX_ROWS = 50;
const ALLOWED_BRANDS = new Set([
  'Blancpain', 'Bulgari', 'Chopard', 'Girard-Perregaux', 'Glashütte Original',
  'Grand Seiko', 'H. Moser & Cie', 'Jacob & Co', 'Ulysse Nardin', 'Zenith',
]);

function authorized(req) {
  const expected = process.env.ADMISSION_IMPORT_TOKEN;
  const header = String(req.headers?.authorization || '');
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return Boolean(expected) && tokensMatch(supplied, expected);
}

function validateRow(row, brand, sourceFileSha256) {
  if (!row || typeof row !== 'object') return 'ROW_INVALID';
  if (!/^admission_[a-f0-9]{64}$/.test(String(row.id || ''))) return 'ID_INVALID';
  if (!/^[a-f0-9]{64}$/.test(String(row.content_hash || ''))) return 'CONTENT_HASH_INVALID';
  if (row.brand_scope !== brand || row.canonical_brand !== brand) return 'BRAND_SCOPE_INVALID';
  if (row.source_file_sha256 !== sourceFileSha256) return 'SOURCE_HASH_MISMATCH';
  if (row.verification_status !== 'APPROVED_SINGLE_CANDIDATE' || row.confidence !== 100) return 'ADMISSION_INVALID';
  if (!['WTS', 'WTB'].includes(row.listing_type)) return 'LISTING_TYPE_INVALID';
  if (!row.source_record_id || !row.raw_message || !row.posting_date || !row.posted_by) return 'LINEAGE_INVALID';
  if (row.phone_number !== null || row.contact_publication_approved !== false) return 'CONTACT_NOT_FAIL_CLOSED';
  if (row.user_image_url !== null || row.catalog_image_url !== null
    || row.final_image_url !== null || row.display_image_url !== null
    || row.image_evidence_type !== null) return 'INHERITED_MEDIA_FORBIDDEN';
  if (row.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH') {
    if (row.listing_type !== 'WTS' || !row.normalized_reference
      || !['USD', 'USDT'].includes(row.source_currency)
      || !(Number(row.workbook_price_usd) > 0)) return 'PRICE_RESEARCH_CONTRACT_INVALID';
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.ADMISSION_IMPORT_TOKEN) return res.status(503).json({ error: 'Import disabled' });
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const brand = String(req.body?.brand || '').trim();
  const sourceFileSha256 = String(req.body?.source_file_sha256 || '').trim().toLowerCase();
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!ALLOWED_BRANDS.has(brand) || !/^[a-f0-9]{64}$/.test(sourceFileSha256)
    || rows.length < 1 || rows.length > MAX_ROWS) {
    return res.status(400).json({ error: 'Invalid bounded import request' });
  }
  for (const row of rows) {
    const reason = validateRow(row, brand, sourceFileSha256);
    if (reason) return res.status(400).json({ error: reason });
  }

  try {
    const client = getClient();
    const { error } = await client.from(TABLE).upsert(rows, { onConflict: 'id' });
    if (error) throw error;
    const { count, error: countError } = await client
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('brand_scope', brand)
      .eq('source_file_sha256', sourceFileSha256)
      .eq('verification_status', 'APPROVED_SINGLE_CANDIDATE');
    if (countError) throw countError;
    return res.status(200).json({ status: 'ok', accepted: rows.length, reconciled_rows: Number(count || 0) });
  } catch (error) {
    console.error('[admin-admission-import] bounded import failed:', error.message);
    return res.status(503).json({ error: 'Bounded admission import failed' });
  }
};

module.exports.ALLOWED_BRANDS = ALLOWED_BRANDS;
module.exports.MAX_ROWS = MAX_ROWS;
module.exports.authorized = authorized;
module.exports.validateRow = validateRow;

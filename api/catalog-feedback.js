/**
 * CATALOG FEEDBACK API
 * POST /api/catalog-feedback
 *
 * When human approves a record, add ref+brand to catalog for future auto-recognition.
 * This creates a feedback loop: human review → catalog training → better auto-parse.
 *
 * Request: { reference, brand, collection?, model?, source: 'human_approval' }
 * Response: { success, added, message }
 */

const fs = require('fs');
const path = require('path');

const CATALOG_PATH = path.resolve(process.cwd(), 'public', 'enriched_refs.json');

function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveCatalog(catalog) {
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf-8');
}

function normalizeRef(ref) {
  return String(ref || '').toUpperCase().replace(/[^A-Z0-9\/]/g, '');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { reference, brand, collection, model, dialColor, source = 'human_approval' } = req.body || {};

  if (!reference || !brand) {
    return res.status(400).json({ success: false, error: 'reference and brand required' });
  }

  try {
    const catalog = loadCatalog();
    const normRef = normalizeRef(reference);

    // Check if already exists
    const exists = catalog.some(e => normalizeRef(e.reference) === normRef);
    if (exists) {
      return res.status(200).json({ success: true, added: false, message: 'Reference already in catalog' });
    }

    // Add new entry
    const newEntry = {
      reference: reference.toUpperCase(),
      brand: brand,
      collection: collection || null,
      model: model || null,
      dial_color: dialColor || null,
      source: source,
      added_at: new Date().toISOString(),
      // Default values for optional fields
      case_metal: null,
      production_years: null,
      status: null,
      total_mentions: 1,
      buyer_ratio: null,
      seller_ratio: null,
      liquidity_score: null,
    };

    // Note: Vercel filesystem is read-only at runtime.
    // In production, this would write to a database (Supabase/Postgres).
    // For now, we return success but don't persist (filesystem is RO).
    // TODO: Connect to Supabase table 'catalog_feedback' for persistence.

    return res.status(200).json({
      success: true,
      added: true,
      message: `Would add ${reference} (${brand}) to catalog (Vercel RO filesystem — use Supabase in production)`,
      catalogSize: catalog.length,
      note: 'Vercel serverless has read-only filesystem. Connect to database for persistence.',
    });
  } catch (e) {
    console.error('[catalog-feedback]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
}

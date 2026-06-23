/**
 * GET /api/health
 * Health check endpoint for WatchFacts monitoring.
 */
module.exports = async function handler(req, res) {
  const fs = require('fs');
  const path = require('path');

  const status = {
    status: 'ok',
    service: 'watchfacts-poc',
    timestamp: new Date().toISOString(),
    checks: {},
  };

  // Check enriched_refs.json (catalog)
  try {
    const catalogPath = path.resolve(process.cwd(), 'public', 'enriched_refs.json');
    const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    status.checks.catalog = {
      ok: true,
      refs: Array.isArray(raw) ? raw.length : 'unknown',
    };
  } catch (e) {
    status.checks.catalog = { ok: false, error: e.message };
  }

  // Check parsedWatches.json (dataset)
  try {
    const dataPath = path.resolve(process.cwd(), 'public', 'parsedWatches.json');
    const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    status.checks.dataset = {
      ok: true,
      records: Array.isArray(raw) ? raw.length : 'unknown',
    };
  } catch (e) {
    status.checks.dataset = { ok: false, error: e.message };
  }

  // Check Supabase env
  status.checks.supabase = {
    ok: !!(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL),
  };

  // Check AI provider keys (presence only)
  status.checks.aiProviders = {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    deepseek: !!process.env.DEEPSEEK_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    kimi: !!process.env.KIMI_API_KEY,
  };

  const allOk = status.checks.catalog.ok && status.checks.dataset.ok;
  if (!allOk) status.status = 'degraded';

  res.status(200).json(status);
}

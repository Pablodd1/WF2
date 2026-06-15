/**
 * STUDY LOG  —  /api/study-log
 *
 * Persists each study session to a local JSON file.
 * Gives permanent memory: every paste + result is saved and versioned.
 * On Vercel, /tmp is ephemeral so this is per-session — but the client
 * also caches locally via localStorage for cross-session persistence.
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE = '/tmp/watchfacts-study-log.ndjson';

function saveLine(line) {
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf-8');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }

  const { entry, sessionId } = req.body || {};
  if (!entry || !entry.input || !entry.watch) {
    return res.status(400).json({ error: 'entry with input and watch required' });
  }

  try {
    const record = {
      ts: new Date().toISOString(),
      sessionId: sessionId || 'unknown',
      input: entry.input.slice(0, 200),
      verdict: entry.watch.verdict,
      confidence: entry.watch.confidence,
      brand: entry.watch.parsed.brand,
      reference: entry.watch.parsed.reference,
      dialColor: entry.watch.parsed.dialColor,
      price: entry.watch.parsed.price,
      currency: entry.watch.parsed.currency,
      condition: entry.watch.parsed.condition,
      year: entry.watch.parsed.year,
      reason: entry.watch.reason,
    };
    saveLine(JSON.stringify(record));
    return res.status(200).json({ success: true, saved: true });
  } catch (e) {
    console.error('[study-log] save error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};

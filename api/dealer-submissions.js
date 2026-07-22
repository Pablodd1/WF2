'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

const INTENTS = new Set(['WTS', 'WTB']);
const CATEGORIES = new Set(['WATCH', 'HANDBAG', 'JEWELRY', 'ACCESSORY', 'OTHER']);
const CURRENCIES = new Set(['USD', 'HKD', 'EUR', 'GBP', 'CHF', 'CNY', 'JPY', 'SGD', 'USDT']);

function clean(value, max = 200) {
  const result = String(value || '').trim();
  return result ? result.slice(0, max) : null;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try { return new URL(origin).host === host; } catch { return false; }
}

function validateSubmission(body = {}) {
  const intent = clean(body.intent, 3)?.toUpperCase();
  const category = clean(body.category, 20)?.toUpperCase();
  const rawInput = String(body.raw_message || '').trim();
  const rawMessage = rawInput || null;
  if (!INTENTS.has(intent)) return { error: 'Choose For sale or Want to buy.' };
  if (!CATEGORIES.has(category)) return { error: 'Choose a valid category.' };
  if (!rawMessage || rawMessage.length < 3) return { error: 'Enter the original listing or request message.' };
  if (rawMessage.length > 10000) return { error: 'Original message is limited to 10,000 characters.' };

  const claimed = {
    brand: clean(body.brand), model: clean(body.model), reference: clean(body.reference),
    dial_color: clean(body.dial_color), condition: clean(body.condition, 40),
    price_amount: body.price_amount == null || body.price_amount === '' ? null : Number(body.price_amount),
    currency: clean(body.currency, 8)?.toUpperCase() || null,
    location: clean(body.location, 160), title: clean(body.title, 240),
  };
  if (category === 'WATCH') {
    const missing = ['brand', 'model', 'reference', 'dial_color'].filter(field => !claimed[field]);
    if (intent === 'WTS' && (!Number.isFinite(claimed.price_amount) || claimed.price_amount <= 0)) missing.push('price_amount');
    if (missing.length) return { error: `Required watch fields: ${missing.join(', ')}.` };
  }
  if (claimed.price_amount != null && (!Number.isFinite(claimed.price_amount) || claimed.price_amount <= 0 || claimed.price_amount > 1_000_000_000)) {
    return { error: 'Enter a valid positive price.' };
  }
  if (claimed.currency && !CURRENCIES.has(claimed.currency)) return { error: 'Choose a supported currency.' };
  if (intent === 'WTS' && claimed.price_amount && !claimed.currency) return { error: 'Choose the original price currency.' };
  return { intent, category, rawMessage, claimed };
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const authorization = await authorizeDealer(req, res);
  if (authorization.error) return res.status(authorization.status).json({ error: authorization.error });

  if (req.method === 'GET') {
    const { data, error } = await authorization.client.from('dealer_listing_submissions')
      .select('id,intent,category,claimed_fields,review_status,created_at')
      .eq('auth_user_id', authorization.user.id)
      .order('created_at', { ascending: false }).limit(25);
    if (error) return res.status(500).json({ error: 'Unable to load submissions.' });
    return res.status(200).json({ success: true, submissions: data || [] });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Invalid request origin.' });
  const validated = validateSubmission(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const { data: dealer } = await authorization.client.from('dealers')
    .select('id').eq('auth_user_id', authorization.user.id).maybeSingle();
  const { data, error } = await authorization.client.from('dealer_listing_submissions').insert({
    auth_user_id: authorization.user.id,
    dealer_id: dealer?.id || null,
    intent: validated.intent,
    category: validated.category,
    raw_message: validated.rawMessage,
    claimed_fields: validated.claimed,
  }).select('id,review_status,created_at').single();
  if (error) {
    console.error('[dealer-submissions]', error.message);
    return res.status(500).json({ error: 'Unable to save the submission.' });
  }
  return res.status(201).json({ success: true, submission: data, publication: 'REVIEW_REQUIRED' });
}

module.exports = handler;
module.exports.validateSubmission = validateSubmission;

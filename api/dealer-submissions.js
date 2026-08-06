'use strict';

const crypto = require('node:crypto');
const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

const INTENTS = new Set(['WTS', 'WTB']);
const CATEGORIES = new Set(['WATCH', 'HANDBAG', 'JEWELRY', 'ACCESSORY', 'OTHER']);
const CURRENCIES = new Set(['USD', 'HKD', 'EUR', 'GBP', 'CHF', 'CNY', 'JPY', 'SGD', 'USDT']);
const MAX_BULK_ITEMS = 20;

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
    poster_name: clean(body.poster_name, 160), poster_phone: clean(body.poster_phone, 50),
  };
  if (category === 'WATCH') {
    const missing = ['brand', 'model', 'reference', 'dial_color'].filter(field => !claimed[field]);
    if (missing.length) return { error: `Required watch fields: ${missing.join(', ')}.` };
  }
  if (!claimed.poster_name || !claimed.poster_phone || !claimed.location) {
    return { error: 'Posting user name, phone number, and location are required.' };
  }
  if (claimed.price_amount != null && (!Number.isFinite(claimed.price_amount) || claimed.price_amount <= 0 || claimed.price_amount > 1_000_000_000)) {
    return { error: 'Enter a valid positive price.' };
  }
  if (claimed.currency && !CURRENCIES.has(claimed.currency)) return { error: 'Choose a supported currency.' };
  if (intent === 'WTS' && claimed.price_amount && !claimed.currency) return { error: 'Choose the original price currency.' };
  const imageUrls = Array.isArray(body.image_urls) ? body.image_urls.map(value => clean(value, 2000)).filter(Boolean).slice(0, 5) : [];
  if (!imageUrls.length) return { error: 'Add at least one item photo.' };
  if (imageUrls.some(value => !/^https:\/\//i.test(value))) return { error: 'Invalid item photo URL.' };
  const posterImageUrl = clean(body.poster_image_url, 2000);
  if (posterImageUrl && !/^https:\/\//i.test(posterImageUrl)) return { error: 'Invalid posting-user photo URL.' };
  return { intent, category, rawMessage, claimed, imageUrls, posterImageUrl };
}

function validateBatch(body = {}) {
  const items = Array.isArray(body.items) ? body.items : [body];
  if (!items.length || items.length > MAX_BULK_ITEMS) return { error: `Submit between 1 and ${MAX_BULK_ITEMS} items at a time.` };
  const validated = items.map(item => validateSubmission({
    ...item,
    poster_name: item.poster_name || body.poster_name,
    poster_phone: item.poster_phone || body.poster_phone,
    location: item.location || body.location,
    poster_image_url: item.poster_image_url || body.poster_image_url,
  }));
  const failedIndex = validated.findIndex(item => item.error);
  if (failedIndex >= 0) return { error: `Item ${failedIndex + 1}: ${validated[failedIndex].error}` };
  return { items: validated };
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const authorization = await authorizeDealer(req, res);
  if (authorization.error) return res.status(authorization.status).json({ error: authorization.error });

  if (req.method === 'GET') {
    const { data, error } = await authorization.client.from('dealer_listing_submissions')
      .select('id,intent,category,claimed_fields,review_status,publication_status,created_at')
      .eq('auth_user_id', authorization.user.id)
      .order('created_at', { ascending: false }).limit(25);
    if (error) return res.status(500).json({ error: 'Unable to load submissions.' });
    return res.status(200).json({ success: true, submissions: data || [] });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Invalid request origin.' });
  const batch = validateBatch(req.body);
  if (batch.error) return res.status(400).json({ error: batch.error });

  const { data: dealer } = await authorization.client.from('dealers')
    .select('id,avatar_url,rating').eq('auth_user_id', authorization.user.id).maybeSingle();
  const bulkSubmissionId = batch.items.length > 1 ? crypto.randomUUID() : null;
  const submissionRows = batch.items.map(validated => ({
    auth_user_id: authorization.user.id, dealer_id: dealer?.id || null,
    intent: validated.intent, category: validated.category, raw_message: validated.rawMessage,
    claimed_fields: { ...validated.claimed, dealer_rating: dealer?.rating || null }, image_urls: validated.imageUrls,
    poster_image_url: validated.posterImageUrl || dealer?.avatar_url || null,
    submission_checksum: crypto.createHash('sha256').update(JSON.stringify({
      intent: validated.intent, category: validated.category, raw_message: validated.rawMessage,
      claimed: validated.claimed, image_urls: validated.imageUrls,
    })).digest('hex'),
    bulk_submission_id: bulkSubmissionId, publication_status: 'PUBLISHED',
    review_status: 'APPROVED', normalized_at: new Date().toISOString(),
  }));
  const { data, error } = await authorization.client.from('dealer_listing_submissions').insert(submissionRows)
    .select('id,review_status,publication_status,created_at,intent,category,claimed_fields,image_urls,poster_image_url');
  if (error) {
    console.error('[dealer-submissions]', error.message);
    if (error.code === '23505') return res.status(409).json({ error: 'This exact item post already exists.' });
    return res.status(500).json({ error: 'Unable to save the submission.' });
  }
  const stagingRows = data.map((submission, index) => {
    const validated = batch.items[index];
    const price = validated.claimed.price_amount;
    return {
      source_submission_id: submission.id, dealer_id: dealer?.id || null,
      raw_message_text: validated.rawMessage, category: validated.category,
      intent: validated.intent, listing_type: 'SINGLE', is_bundle: false,
      brand_original: validated.claimed.brand, brand_normalized: validated.claimed.brand,
      model_original: validated.claimed.model, model_normalized: validated.claimed.model,
      reference_original: validated.claimed.reference, reference_normalized: validated.claimed.reference,
      dial_color_original: validated.claimed.dial_color, dial_color_normalized: validated.claimed.dial_color,
      condition_original: validated.claimed.condition, condition_normalized: validated.claimed.condition,
      price_original: price, price_normalized: price,
      price_usd: validated.claimed.currency === 'USD' ? price : null,
      currency_original: validated.claimed.currency, currency_normalized: validated.claimed.currency,
      image_url: validated.imageUrls[0], image_urls: validated.imageUrls,
      user_image_url: validated.posterImageUrl || dealer?.avatar_url || null,
      user_name: validated.claimed.poster_name, from_name: validated.claimed.poster_name,
      contact_number: validated.claimed.poster_phone, from_number: validated.claimed.poster_phone,
      location: validated.claimed.location, rating: dealer?.rating || 0, dealer_rating: dealer?.rating || 0,
      contact_consent: true, are_attributes_extracted: true,
      identification_status: validated.category === 'WATCH' ? 'identified' : 'normalized',
      verdict: 'approved', normalization_status: 'normalized', trading_floor_status: 'published',
      price_research_status: validated.category !== 'WATCH' ? 'ineligible_non_watch' : price == null ? 'ineligible_no_price' : validated.claimed.currency === 'USD' ? 'eligible' : 'provisional_needs_review',
      provenance_metadata: { source: 'authenticated_user_form', submission_id: submission.id, poster_image_url: validated.posterImageUrl || dealer?.avatar_url || null },
      overall_confidence: 1,
    };
  });
  const { error: publicationError } = await authorization.client.schema('staging').from('listings').insert(stagingRows);
  if (publicationError) {
    await authorization.client.from('dealer_listing_submissions').update({ publication_status: 'PUBLICATION_FAILED', review_status: 'IN_REVIEW' }).in('id', data.map(item => item.id));
    console.error('[dealer-submissions-publication]', publicationError.message);
    return res.status(500).json({ error: 'Listings were saved, but publication needs attention.' });
  }
  return res.status(201).json({ success: true, submissions: data, submission: data[0], publication: 'PUBLISHED', count: data.length });
}

module.exports = handler;
module.exports.validateSubmission = validateSubmission;
module.exports.validateBatch = validateBatch;
module.exports.MAX_BULK_ITEMS = MAX_BULK_ITEMS;

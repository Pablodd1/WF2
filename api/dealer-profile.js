'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authorization = await authorizeDealer(req, res);
  if (authorization.error) return res.status(authorization.status).json({ error: authorization.error });
  const identity = String(req.query?.id || '').trim().slice(0, 160);
  if (!identity) return res.status(400).json({ error: 'Dealer id or slug required' });

  try {
    let query = authorization.client
      .from('dealers')
      .select('id,slug,display_name,company_name,country_code,city,rating,review_count,whatsapp_group_count,avatar_url,profile_summary,verified_at,status,contact_consent');
    query = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(identity) ? query.eq('id', identity) : query.eq('slug', identity);
    const { data: dealer, error } = await query.maybeSingle();
    if (error) throw error;
    if (!dealer || dealer.status !== 'VERIFIED') return res.status(404).json({ error: 'Verified dealer profile not found' });

    const [statsResult, listingsResult] = await Promise.all([
      authorization.client.from('dealer_profile_stats').select('*').eq('dealer_id', dealer.id).maybeSingle(),
      authorization.client.from('watch_records')
        .select('id,brand,reference,dial_color,condition,price_usd,currency,listing_type,listing_date,created_at,listing_status,verdict,raw_message')
        .eq('dealer_id', dealer.id)
        .or('verdict.is.null,verdict.neq.RECYCLE')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    if (statsResult.error) throw statsResult.error;
    if (listingsResult.error) throw listingsResult.error;
    const mayViewRaw = authorization.role === 'admin' || authorization.role === 'reviewer';

    return res.status(200).json({
      success: true,
      dealer,
      stats: statsResult.data || null,
      listings: (listingsResult.data || []).map(listing => ({
        ...listing,
        raw_message: mayViewRaw ? listing.raw_message : undefined,
      })),
      raw_message_access: mayViewRaw,
    });
  } catch (error) {
    console.error('[dealer-profile]', error.message);
    const missingSchema = /relation .* does not exist|column .* does not exist|schema cache/i.test(error.message);
    return res.status(missingSchema ? 503 : 500).json({
      error: missingSchema ? 'Dealer profiles are awaiting the production migration.' : 'Unable to load dealer profile.',
    });
  }
};

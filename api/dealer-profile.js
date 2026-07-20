'use strict';

const { getClient } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const identity = String(req.query?.id || '').trim().slice(0, 160);
  if (!identity) return res.status(400).json({ error: 'Dealer id or slug required' });

  try {
    const client = getClient();
    let query = client
      .from('dealers')
      .select('id,slug,display_name,company_name,country_code,city,rating,review_count,whatsapp_group_count,avatar_url,profile_summary,verified_at,status,contact_consent');
    query = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(identity) ? query.eq('id', identity) : query.eq('slug', identity);
    const { data: dealer, error } = await query.maybeSingle();
    if (error) throw error;
    if (!dealer || dealer.status !== 'VERIFIED') return res.status(404).json({ error: 'Verified dealer profile not found' });

    const [statsResult, listingsResult] = await Promise.all([
      client.from('dealer_profile_stats').select('*').eq('dealer_id', dealer.id).maybeSingle(),
      client.from('watch_records')
        .select('id,brand,reference,dial_color,condition,price_usd,currency,listing_type,listing_date,created_at,listing_status,verdict')
        .eq('dealer_id', dealer.id)
        .not('listing_type', 'eq', 'MULTI')
        .not('flags', 'cs', '["BUNDLE_SPLIT_REQUIRED"]')
        .or('verdict.is.null,verdict.neq.RECYCLE')
        .or('listing_status.is.null,listing_status.not.in.(HIDDEN,REJECTED,DELETED)')
        .order('listing_date', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true })
        .limit(50),
    ]);
    if (statsResult.error) throw statsResult.error;
    if (listingsResult.error) throw listingsResult.error;
    const listingRows = listingsResult.data || [];
    const listingIds = listingRows.map(listing => listing.id);
    const { data: bundleParents, error: bundleError } = listingIds.length
      ? await client.from('normalization_shadow_v4').select('source_record_id').in('source_record_id', listingIds).gt('candidate_count', 1)
      : { data: [], error: null };
    if (bundleError) throw bundleError;
    const excludedIds = new Set((bundleParents || []).map(row => row.source_record_id));
    return res.status(200).json({
      success: true,
      dealer,
      stats: statsResult.data || null,
      listings: listingRows.filter(listing => !excludedIds.has(listing.id)),
      raw_message_access: false,
    });
  } catch (error) {
    console.error('[dealer-profile]', error.message);
    const missingSchema = /relation .* does not exist|column .* does not exist|schema cache/i.test(error.message);
    return res.status(missingSchema ? 503 : 500).json({
      error: missingSchema ? 'Dealer profiles are awaiting the production migration.' : 'Unable to load dealer profile.',
    });
  }
};

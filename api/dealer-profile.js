'use strict';

const { getClient } = require('./_lib/supabase');
const { loadAnalyticsSuppressedIds } = require('./_lib/duplicate-suppression.cjs');
const { deduplicateReposts } = require('./_lib/repost-deduplication.cjs');
const { MIN_RELEASE_CONFIDENCE, isReleaseListingEligible } = require('./_lib/publication-references.cjs');
const fullDirectoryCrawl = require('../data/dealer-directory/full-crawl-2026-08-09.json');

function sourceProfileId(identity) {
  return String(identity || '').match(/^watchfacts-source-(\d+)$/i)?.[1] || null;
}

function sourcePrice(displayPrice) {
  const value = Number(String(displayPrice || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function sourceDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function sourceProfilePayload(identity) {
  const id = sourceProfileId(identity);
  if (!id) return null;
  const profile = fullDirectoryCrawl.profiles.find(row => String(row.id) === id);
  if (!profile) return null;
  const listings = fullDirectoryCrawl.listings
    .filter(row => String(row.dealer_id) === id)
    .sort((left, right) => String(right.posted_on || '').localeCompare(String(left.posted_on || '')))
    .map(row => ({
      id: `watchfacts-${row.id}`,
      brand: null,
      reference: null,
      dial_color: null,
      condition: null,
      title: row.title || null,
      price_usd: sourcePrice(row.display_price),
      currency: sourcePrice(row.display_price) == null ? null : 'USD',
      raw_message: row.title || null,
      listing_type: row.intent,
      listing_date: sourceDate(row.posted_on),
      created_at: sourceDate(row.posted_on),
      image_url: row.source_images?.[0] || row.image_url || null,
      source_url: row.detail_url || null,
      source_display_price: row.display_price || null,
      box: row.box || null,
      papers: row.papers || null,
      seller_name: row.seller_name || profile.name,
      seller_review_count: row.seller_review_count ?? null,
      seller_wts_count: row.seller_wts_count ?? null,
      seller_wtb_count: row.seller_wtb_count ?? null,
      availability_url: row.availability_url || null,
    }));
  const dates = listings.map(row => row.listing_date).filter(Boolean).sort();
  const phone = String(profile.whatsapp_url || '').replace(/[^0-9]/g, '') || null;
  return {
    success: true,
    source: 'watchfacts_directory_crawl',
    source_crawled_at: fullDirectoryCrawl.crawled_at,
    dealer: {
      id: `watchfacts-source-${id}`,
      slug: null,
      display_name: profile.name,
      company_name: null,
      country_code: profile.country || profile.region || null,
      city: null,
      rating: null,
      review_count: Number(profile.profile_rating_count ?? profile.reviews ?? 0),
      whatsapp_group_count: Number(profile.common_groups || 0),
      avatar_url: null,
      profile_summary: profile.trust_status || null,
      verified_at: profile.member_since?.replace('Member since ', '') || null,
      status: 'SOURCE_PUBLISHED',
      contact_consent: true,
    },
    stats: {
      wts_count: Number(profile.wts || 0),
      wtb_count: Number(profile.wtb || 0),
      group_count: Number(profile.common_groups || 0),
      first_post: dates[0] || null,
      latest_post: dates.at(-1) || null,
      verified_contact_info: phone ? { phone, verification_status: 'SOURCE_PUBLISHED' } : null,
    },
    source_metrics: {
      profile_listing_total: profile.listing_total ?? null,
      feedback_received: profile.feedback_received ?? null,
      rendered_feedback_rows: Array.isArray(profile.reviews) ? profile.reviews.length : 0,
      feedback_given: profile.feedback_given ?? null,
      feedback_requested: profile.feedback_requested ?? null,
      own_account_view: Boolean(profile.own_account_view),
    },
    source_workflow: {
      profile: profile.profile_url || null,
      reviews: profile.profile_url ? `${profile.profile_url}#dealer-feedback-div` : null,
      wts: profile.wts_url || null,
      wtb: profile.wtb_url || null,
      whatsapp: profile.whatsapp_url || null,
      request_feedback: profile.request_feedback_url || null,
    },
    reviews: profile.reviews || [],
    listings,
    raw_message_access: true,
  };
}

function buildDealerStats(listings, dealer, verifiedPhone, aggregate = null) {
  const dates = listings
    .map(listing => listing.listing_date || listing.created_at)
    .filter(Boolean)
    .map(value => new Date(value))
    .filter(value => !Number.isNaN(value.getTime()))
    .sort((left, right) => left - right);
  const countIntent = intent => listings.filter(listing =>
    String(listing.listing_type || '').trim().toUpperCase() === intent).length;
  return {
    wts_count: Number(aggregate?.wts_posts ?? countIntent('WTS')),
    wtb_count: Number(aggregate?.wtb_posts ?? countIntent('WTB')),
    group_count: Number(dealer.whatsapp_group_count || 0),
    first_post: aggregate?.first_post_at || dates[0]?.toISOString() || null,
    latest_post: aggregate?.last_post_at || dates.at(-1)?.toISOString() || null,
    verified_contact_info: dealer.contact_consent && verifiedPhone
      ? { phone: verifiedPhone, verification_status: 'VERIFIED' }
      : null,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const identity = String(req.query?.id || '').trim().slice(0, 160);
  if (!identity) return res.status(400).json({ error: 'Dealer id or slug required' });

  const crawledProfile = sourceProfilePayload(identity);
  if (crawledProfile) return res.status(200).json(crawledProfile);

  try {
    const client = getClient();
    let query = client
      .from('dealers')
      .select('id,slug,display_name,company_name,country_code,city,rating,review_count,whatsapp_group_count,avatar_url,profile_summary,verified_at,status,contact_consent');
    query = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(identity) ? query.eq('id', identity) : query.eq('slug', identity);
    const { data: dealer, error } = await query.maybeSingle();
    if (error) throw error;
    if (!dealer || dealer.status !== 'VERIFIED') return res.status(404).json({ error: 'Verified dealer profile not found' });

    const [listingsResult, phoneResult, statsResult] = await Promise.all([
      client.from('watch_records')
      .select('id,brand,reference,dial_color,condition,price_usd,currency,raw_message,dealer_id,listing_type,listing_date,created_at,listing_status,verdict,confidence')
      .eq('dealer_id', dealer.id)
      .eq('verdict', 'APPROVED')
      .gte('confidence', MIN_RELEASE_CONFIDENCE)
      .not('listing_type', 'eq', 'MULTI')
      .not('flags', 'cs', '["BUNDLE_SPLIT_REQUIRED"]')
      .or('listing_status.is.null,listing_status.not.in.(HIDDEN,REJECTED,DELETED)')
      .order('listing_date', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .limit(50),
      client.from('dealer_source_identities')
        .select('source_identity,identity_type,verification_status')
        .eq('dealer_id', dealer.id)
        .eq('verification_status', 'VERIFIED')
        .in('identity_type', ['PHONE', 'WHATSAPP', 'phone', 'whatsapp'])
        .limit(1),
      client.from('verified_dealer_profile_stats')
        .select('wts_posts,wtb_posts,first_post_at,last_post_at')
        .eq('dealer_id', dealer.id)
        .maybeSingle(),
    ]);
    if (listingsResult.error) throw listingsResult.error;
    if (phoneResult.error) throw phoneResult.error;
    if (statsResult.error) throw statsResult.error;
    const listingRows = listingsResult.data || [];
    const listingIds = listingRows.map(listing => listing.id);
    const suppressedIds = await loadAnalyticsSuppressedIds(client, listingIds);
    const { data: bundleParents, error: bundleError } = listingIds.length
      ? await client.from('normalization_shadow_v4').select('source_record_id').in('source_record_id', listingIds).gt('candidate_count', 1)
      : { data: [], error: null };
    if (bundleError) throw bundleError;
    const { data: verifiedIdentities, error: identityError } = listingIds.length
      ? await client.from('listing_identity_reviews')
        .select('record_id,canonical_brand,canonical_reference,canonical_dial_color')
        .in('record_id', listingIds)
        .in('status', ['CATALOG_CONFIRMED', 'HUMAN_APPROVED'])
      : { data: [], error: null };
    if (identityError) throw identityError;
    const { data: appliedLineage, error: lineageError } = listingIds.length
      ? await client.from('seller_listing_lineage_staging')
        .select('source_record_id')
        .in('source_record_id', listingIds)
        .eq('matched_dealer_id', dealer.id)
        .eq('match_status', 'APPLIED')
      : { data: [], error: null };
    if (lineageError) throw lineageError;
    const excludedIds = new Set((bundleParents || []).map(row => row.source_record_id));
    const identityById = new Map((verifiedIdentities || []).map(row => [row.record_id, row]));
    const lineageIds = new Set((appliedLineage || []).map(row => row.source_record_id));
    const safeCandidates = listingRows.flatMap(listing => {
      const verified = identityById.get(listing.id);
      if (!verified || !lineageIds.has(listing.id) || excludedIds.has(listing.id) || suppressedIds.has(String(listing.id))) return [];
      const resolved = {
        ...listing,
        brand: verified.canonical_brand || listing.brand,
        reference: verified.canonical_reference || listing.reference,
        dial_color: verified.canonical_dial_color || listing.dial_color,
      };
      if (!isReleaseListingEligible(resolved)) return [];
      return [resolved];
    });
    const { uniqueRows } = deduplicateReposts(safeCandidates);
    const safeListings = uniqueRows.map(listing => {
      const { dealer_id: _dealerId, ...publicListing } = listing;
      return publicListing;
    });
    const verifiedPhone = phoneResult.data?.[0]?.source_identity || null;
    const stats = buildDealerStats(safeListings, dealer, verifiedPhone, statsResult.data);
    return res.status(200).json({
      success: true,
      dealer,
      stats,
      listings: safeListings,
      raw_message_access: true,
    });
  } catch (error) {
    console.error('[dealer-profile]', error.message);
    const missingSchema = /relation .* does not exist|column .* does not exist|schema cache/i.test(error.message);
    return res.status(missingSchema ? 503 : 500).json({
      error: missingSchema ? 'Dealer profiles are awaiting the production migration.' : 'Unable to load dealer profile.',
    });
  }
};

module.exports.buildDealerStats = buildDealerStats;
module.exports.sourceProfilePayload = sourceProfilePayload;

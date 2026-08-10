'use strict';

const { getClient } = require('./_lib/supabase');
const fullDirectoryCrawl = require('../data/dealer-directory/full-crawl-2026-08-09.json');
const topRatedSnapshot = fullDirectoryCrawl.profiles;

const SOURCE_ROOT = 'https://watchfacts.com';

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function digits(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function sourceUserId(dealer) {
  const fromUrl = String(dealer.directory_url || '').match(/\/user\/(\d+)\/profile/i)?.[1];
  const fromSource = String(dealer.directory_source_id || '').match(/\d+/)?.[0];
  return fromUrl || fromSource || null;
}

function buildSourceLinks(dealer, verifiedPhone = null) {
  const sourceId = sourceUserId(dealer);
  const profile = dealer.directory_url || (sourceId ? `${SOURCE_ROOT}/user/${sourceId}/profile` : null);
  const phone = digits(verifiedPhone);
  return {
    profile,
    reviews: profile ? `${profile.split('#')[0]}#dealer-feedback-div` : null,
    wts: sourceId ? `${SOURCE_ROOT}/profile-listings?profileId=${sourceId}&for=sale` : null,
    wtb: sourceId ? `${SOURCE_ROOT}/profile-listings?profileId=${sourceId}&for=search` : null,
    whatsapp: phone ? `https://wa.me/${phone}` : null,
  };
}

function snapshotDealer(row, index) {
  const sourceId = String(row.id || row.source_id);
  const directoryUrl = row.profile_url || `${SOURCE_ROOT}/user/${sourceId}/profile`;
  const reviewCount = Number(row.profile_rating_count ?? row.reviews ?? row.review_count ?? 0);
  const groupCount = Number(row.common_groups ?? row.whatsapp_group_count ?? 0);
  const phone = row.whatsapp_url || row.phone || null;
  return {
    id: `watchfacts-source-${sourceId}`,
    slug: null,
    display_name: row.name || row.display_name,
    company_name: null,
    country_code: row.country || row.region,
    city: null,
    rating: null,
    review_count: reviewCount,
    whatsapp_group_count: groupCount,
    avatar_url: null,
    profile_summary: row.trust_status || null,
    verified_at: row.member_since?.replace('Member since ', '') || row.member_since || null,
    directory_url: directoryUrl,
    directory_source_id: sourceId,
    source_rank: index + 1,
    source_system: 'WATCHFACTS_TOP_RATED_2026_08_09',
    verified_phone: phone,
    source_links: buildSourceLinks({ directory_url: directoryUrl, directory_source_id: sourceId }, phone),
    source_metrics: {
      profile_listing_total: row.listing_total ?? null,
      feedback_received: row.feedback_received ?? null,
      rendered_feedback_rows: Array.isArray(row.reviews) ? row.reviews.length : null,
      source_crawled_at: fullDirectoryCrawl.crawled_at,
    },
    stats: {
      wts_posts: Number(row.wts ?? row.wts_posts ?? 0),
      wtb_posts: Number(row.wtb ?? row.wtb_posts ?? 0),
      first_post_at: null,
      last_post_at: null,
    },
  };
}

function snapshotDirectory(search, page, pageSize) {
  const needle = String(search || '').trim().toLocaleLowerCase();
  const phoneNeedle = digits(search);
  const matched = topRatedSnapshot.filter(row => {
    if (!needle) return true;
    return [row.name, row.display_name, row.country, row.region].some(value => String(value || '').toLocaleLowerCase().includes(needle))
      || (phoneNeedle.length >= 4 && digits(row.whatsapp_url || row.phone).includes(phoneNeedle));
  });
  const from = (page - 1) * pageSize;
  return {
    total: matched.length,
    dealers: matched.slice(from, from + pageSize).map((row, offset) => snapshotDealer(row, from + offset)),
  };
}

async function loadVerifiedPhones(client, dealerIds) {
  if (!dealerIds.length) return new Map();
  const { data, error } = await client
    .from('dealer_source_identities')
    .select('dealer_id,source_identity,identity_type,verification_status')
    .in('dealer_id', dealerIds)
    .eq('verification_status', 'VERIFIED')
    .in('identity_type', ['PHONE', 'WHATSAPP', 'phone', 'whatsapp']);
  if (error) throw error;
  const result = new Map();
  for (const identity of data || []) {
    if (!result.has(identity.dealer_id)) result.set(identity.dealer_id, identity.source_identity);
  }
  return result;
}

async function phoneMatchedDealerIds(client, search) {
  const needle = digits(search);
  if (needle.length < 4) return null;
  const { data, error } = await client
    .from('dealer_source_identities')
    .select('dealer_id,source_identity')
    .eq('verification_status', 'VERIFIED')
    .in('identity_type', ['PHONE', 'WHATSAPP', 'phone', 'whatsapp'])
    .limit(5000);
  if (error) throw error;
  return [...new Set((data || []).filter(row => digits(row.source_identity).includes(needle)).map(row => row.dealer_id))];
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=120, stale-while-revalidate=300');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const page = boundedInteger(req.query?.page, 1, 1, 100000);
  const pageSize = boundedInteger(req.query?.pageSize, 24, 1, 100);
  const search = String(req.query?.q || '').trim().slice(0, 100);
  const mode = String(req.query?.mode || '').trim().toLowerCase();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  if (mode === 'top-rated') {
    const snapshot = snapshotDirectory('', page, pageSize);
    return res.status(200).json({ success: true, page, pageSize, ...snapshot, source: 'watchfacts_top_rated_crawl' });
  }

  try {
    const client = getClient();
    const phoneIds = await phoneMatchedDealerIds(client, search);
    let query = client
      .from('dealers')
      .select('id,slug,display_name,company_name,country_code,city,rating,review_count,whatsapp_group_count,avatar_url,profile_summary,verified_at,directory_url,directory_source_id', { count: 'exact' })
      .eq('status', 'VERIFIED')
      .order('rating', { ascending: false, nullsFirst: false })
      .order('review_count', { ascending: false })
      .order('display_name', { ascending: true })
      .range(from, to);

    if (phoneIds !== null) {
      if (!phoneIds.length) {
        const fallback = snapshotDirectory(search, page, pageSize);
        return res.status(200).json({ success: true, page, pageSize, ...fallback, source: 'watchfacts_top_rated_snapshot' });
      }
      query = query.in('id', phoneIds);
    } else if (search) {
      const escaped = search.replace(/[%_,()]/g, ' ').trim();
      if (escaped) query = query.or(`display_name.ilike.%${escaped}%,company_name.ilike.%${escaped}%,city.ilike.%${escaped}%`);
    }

    const { data: dealers, count, error } = await query;
    if (error) throw error;
    if (!(dealers || []).length && page === 1) {
      const fallback = snapshotDirectory(search, page, pageSize);
      return res.status(200).json({ success: true, page, pageSize, ...fallback, source: 'watchfacts_top_rated_snapshot' });
    }

    const ids = (dealers || []).map(item => item.id);
    const [{ data: stats, error: statsError }, phonesByDealer] = await Promise.all([
      ids.length
        ? client.from('dealer_profile_stats').select('*').in('dealer_id', ids)
        : Promise.resolve({ data: [], error: null }),
      loadVerifiedPhones(client, ids),
    ]);
    if (statsError) throw statsError;
    const statsById = new Map((stats || []).map(item => [item.dealer_id, item]));
    const publicDealers = (dealers || []).map((dealer, index) => {
      const verifiedPhone = phonesByDealer.get(dealer.id) || null;
      return {
        ...dealer,
        source_rank: from + index + 1,
        source_system: 'WATCHFACTS_VERIFIED_DEALERS',
        verified_phone: verifiedPhone,
        source_links: buildSourceLinks(dealer, verifiedPhone),
        stats: statsById.get(dealer.id) || null,
      };
    });

    return res.status(200).json({
      success: true,
      page,
      pageSize,
      total: count || 0,
      dealers: publicDealers,
      source: 'database',
    });
  } catch (error) {
    console.error('[dealers]', error.message);
    const missingSchema = /relation .* does not exist|column .* does not exist|schema cache/i.test(error.message);
    if (missingSchema) {
      const fallback = snapshotDirectory(search, page, pageSize);
      return res.status(200).json({ success: true, page, pageSize, ...fallback, source: 'watchfacts_top_rated_snapshot' });
    }
    return res.status(500).json({ error: 'Unable to load dealer profiles.' });
  }
};

module.exports.buildSourceLinks = buildSourceLinks;
module.exports.snapshotDirectory = snapshotDirectory;

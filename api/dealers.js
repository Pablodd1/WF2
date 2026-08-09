'use strict';

const { getClient } = require('./_lib/supabase');
const topRatedSnapshot = require('../data/dealer-directory/top-rated-2026-08-08.json');

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
  const directoryUrl = `${SOURCE_ROOT}/user/${row.source_id}/profile`;
  return {
    id: `watchfacts-source-${row.source_id}`,
    slug: null,
    display_name: row.display_name,
    company_name: null,
    country_code: row.region,
    city: null,
    rating: null,
    review_count: row.review_count,
    whatsapp_group_count: 0,
    avatar_url: null,
    profile_summary: null,
    verified_at: row.member_since,
    directory_url: directoryUrl,
    directory_source_id: row.source_id,
    source_rank: index + 1,
    source_system: 'WATCHFACTS_TOP_RATED_2026_08_08',
    verified_phone: row.phone,
    source_links: buildSourceLinks({ directory_url: directoryUrl, directory_source_id: row.source_id }, row.phone),
    stats: {
      wts_posts: row.wts_posts,
      wtb_posts: row.wtb_posts,
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
    return [row.display_name, row.region].some(value => String(value || '').toLocaleLowerCase().includes(needle))
      || (phoneNeedle.length >= 4 && digits(row.phone).includes(phoneNeedle));
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
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

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

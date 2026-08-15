'use strict';

const PENDING_LINKAGE = 'PENDING_EXACT_LISTING_LINKAGE';
const LINKED_OR_EMPTY = 'LINKED_OR_NO_RELEASED_ACTIVITY';

async function loadAppliedDealerIds(client, dealerIds) {
  const ids = [...new Set((dealerIds || []).filter(Boolean))];
  const checks = await Promise.all(ids.map(async dealerId => {
    const { data, error } = await client
      .from('dealer_listing_links')
      .select('dealer_id')
      .eq('dealer_id', dealerId)
      .eq('link_status', 'APPLIED')
      .limit(1);
    if (error) throw error;
    return Array.isArray(data) && data.length > 0 ? dealerId : null;
  }));
  return new Set(checks.filter(Boolean));
}

function directoryDealersWithLinkageState(dealers, appliedDealerIds) {
  const linkedIds = appliedDealerIds instanceof Set ? appliedDealerIds : new Set();
  return (dealers || []).map(dealer => {
    const hasAppliedLinks = linkedIds.has(dealer.id);
    return ({
      ...dealer,
      listing_linkage_status: hasAppliedLinks ? LINKED_OR_EMPTY : PENDING_LINKAGE,
      stats: hasAppliedLinks
        ? dealer.stats
        : {
            ...(dealer.stats || {}),
            wts_posts: null,
            wtb_posts: null,
            first_post_at: null,
            last_post_at: null,
            current_counts_are_dynamic: false,
            current_counts_scope: PENDING_LINKAGE,
          },
    });
  });
}

function profileWithLinkageState(profile, hasAppliedLinks) {
  if (hasAppliedLinks) {
    return {
      ...profile,
      listing_linkage_status: LINKED_OR_EMPTY,
    };
  }
  return {
    ...profile,
    listing_linkage_status: PENDING_LINKAGE,
    stats: {
      ...(profile?.stats || {}),
      wts_count: null,
      wtb_count: null,
      first_post: null,
      latest_post: null,
      current_counts_are_dynamic: false,
      current_counts_scope: PENDING_LINKAGE,
    },
  };
}

module.exports = {
  LINKED_OR_EMPTY,
  PENDING_LINKAGE,
  directoryDealersWithLinkageState,
  loadAppliedDealerIds,
  profileWithLinkageState,
};

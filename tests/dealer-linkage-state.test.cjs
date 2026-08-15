'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  directoryDealersWithLinkageState,
  loadAppliedDealerIds,
  profileWithLinkageState,
} = require('../api/_lib/dealer-linkage-state.cjs');
const {
  sourceProfilePayload,
  topRatedProfiles,
} = require('../api/_lib/dealer-directory-source.cjs');

test('canonical directory never presents missing linkage as factual zero activity', () => {
  const [dealer] = directoryDealersWithLinkageState([{
    id: 'dealer-1', review_count: 22, whatsapp_group_count: 25,
    stats: { wts_posts: 0, wtb_posts: 0, first_post_at: null, last_post_at: null },
  }], new Set());
  assert.equal(dealer.listing_linkage_status, 'PENDING_EXACT_LISTING_LINKAGE');
  assert.equal(dealer.stats.wts_posts, null);
  assert.equal(dealer.stats.wtb_posts, null);
  assert.equal(dealer.review_count, 22);
  assert.equal(dealer.whatsapp_group_count, 25);
});

test('profile linkage decoration preserves review and group detail while withholding unknown activity', () => {
  const profile = profileWithLinkageState({
    dealer: { display_name: 'Dealer A' },
    stats: { wts_count: 0, wtb_count: 0, group_count: 3, first_post: null, latest_post: null },
    reviews: [{ reviewer: 'Reviewer A' }],
    groups: [{ name: 'Published group' }],
    listings: [],
  }, false);
  assert.equal(profile.stats.wts_count, null);
  assert.equal(profile.stats.wtb_count, null);
  assert.equal(profile.stats.group_count, 3);
  assert.equal(profile.reviews.length, 1);
  assert.equal(profile.groups.length, 1);
});

test('completed linkage preserves genuine zero released activity', () => {
  const [dealer] = directoryDealersWithLinkageState([{
    id: 'dealer-1',
    stats: { wts_posts: 0, wtb_posts: 0 },
  }], new Set(['dealer-1']));
  assert.equal(dealer.listing_linkage_status, 'LINKED_OR_NO_RELEASED_ACTIVITY');
  assert.equal(dealer.stats.wts_posts, 0);
  assert.equal(dealer.stats.wtb_posts, 0);
});

test('linkage readiness uses bounded per-dealer existence lookups', async () => {
  const calls = [];
  const client = {
    from(table) {
      calls.push(['from', table]);
      return {
        select(columns) {
          calls.push(['select', columns]);
          return {
            eq(column, value) {
              calls.push(['eq', column, value]);
              return {
                eq(secondColumn, secondValue) {
                  calls.push(['eq', secondColumn, secondValue]);
                  return {
                    async limit(limitValue) {
                      calls.push(['limit', limitValue]);
                      const dealerId = calls.findLast(call => call[0] === 'eq' && call[1] === 'dealer_id')?.[2];
                      return { data: dealerId === 'linked' ? [{ dealer_id: dealerId }] : [], error: null };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const linked = await loadAppliedDealerIds(client, ['linked', 'unlinked']);
  assert.deepEqual([...linked], ['linked']);
  assert.deepEqual(calls.at(-1), ['limit', 1]);
  assert.equal(JSON.stringify(calls).includes('count'), false);
});

test('mixed directory results preserve zero only for the individually linked dealer', () => {
  const dealers = directoryDealersWithLinkageState([
    { id: 'linked', stats: { wts_posts: 0, wtb_posts: 0 } },
    { id: 'unlinked', stats: { wts_posts: 0, wtb_posts: 0 } },
  ], new Set(['linked']));
  assert.equal(dealers[0].listing_linkage_status, 'LINKED_OR_NO_RELEASED_ACTIVITY');
  assert.equal(dealers[0].stats.wts_posts, 0);
  assert.equal(dealers[1].listing_linkage_status, 'PENDING_EXACT_LISTING_LINKAGE');
  assert.equal(dealers[1].stats.wts_posts, null);
});

test('source-backed profile details reconcile without exposing external source links', () => {
  const profiles = topRatedProfiles();
  assert.equal(profiles.length, 25);
  let capturedListings = 0;
  let capturedReviews = 0;
  for (const summary of profiles) {
    const payload = sourceProfilePayload(summary.id);
    assert.ok(payload);
    assert.equal(payload.stats.wts_count, summary.stats.wts_posts);
    assert.equal(payload.stats.wtb_count, summary.stats.wtb_posts);
    assert.equal(payload.stats.group_count, summary.whatsapp_group_count);
    assert.equal(payload.reviews.length, payload.source_provenance.captured_review_count);
    assert.equal(JSON.stringify(payload).includes('watchfacts.com'), false);
    assert.equal(Object.hasOwn(payload.dealer, 'source_url'), false);
    capturedListings += payload.listings.length;
    capturedReviews += payload.reviews.length;
  }
  assert.equal(capturedListings, 376);
  assert.equal(capturedReviews, 268);
});

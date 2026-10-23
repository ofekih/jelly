import { describe, expect, it } from 'vitest';
import {
  computeGroupBlend,
  computeUserTasteSimilarity,
  deduplicateUserLists,
  deriveDefaultHandle,
  getFriendMatchesForSpot,
  getSpotSocialMetrics,
  isSameSpot,
  sanitizeHandle,
} from './friendsService';
import { BookmarkEntry, RestaurantEntry, SharedListPayload } from '../types';

function makeRestaurant(overrides: Partial<RestaurantEntry> & { name: string }): RestaurantEntry {
  return {
    id: overrides.id || overrides.name.toLowerCase().replace(/\s+/g, '-'),
    placeId: overrides.placeId,
    name: overrides.name,
    formattedAddress: overrides.formattedAddress || '123 Main St',
    city: overrides.city || 'Irvine',
    category: overrides.category || 'restaurants',
    categories: overrides.categories || ['restaurants'],
    cuisines: overrides.cuisines || ['Japanese'],
    initialRating: overrides.initialRating ?? 8.5,
    rankIndex: overrides.rankIndex ?? 0,
    magicScore: overrides.magicScore ?? 8.8,
    comparisonsCount: overrides.comparisonsCount ?? 3,
    notes: overrides.notes,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makeBookmark(overrides: Partial<BookmarkEntry> & { name: string }): BookmarkEntry {
  return {
    id: overrides.id || overrides.name.toLowerCase().replace(/\s+/g, '-'),
    placeId: overrides.placeId,
    name: overrides.name,
    formattedAddress: overrides.formattedAddress || '123 Main St',
    city: overrides.city || 'Irvine',
    category: overrides.category || 'restaurants',
    categories: overrides.categories || ['restaurants'],
    cuisines: overrides.cuisines || ['Japanese'],
    createdAt: 1000,
    updatedAt: 1000,
  };
}

describe('friendsService', () => {
  it('sanitizes handles and derives default handles', () => {
    expect(sanitizeHandle('@Ofek_I.H!')).toBe('ofek_i.h');
    expect(deriveDefaultHandle('Maya Lin', 'maya@example.com')).toBe('maya');
    expect(deriveDefaultHandle('Maya Lin', null)).toBe('mayalin');
    expect(deriveDefaultHandle(null, 'alex.food@example.com')).toBe('alex.food');
  });

  it('matches spots by placeId or normalized name + city', () => {
    expect(
      isSameSpot(
        { placeId: 'pid_1', name: 'Boil & Bake', city: 'Costa Mesa' },
        { placeId: 'pid_1', name: 'Boil and Bake', city: 'Irvine' }
      )
    ).toBe(true);

    expect(
      isSameSpot(
        { name: 'The Boil & Bake!', city: 'Costa Mesa' },
        { name: 'Boil and Bake', city: 'Costa Mesa' }
      )
    ).toBe(true);

    expect(
      isSameSpot(
        { name: 'Momo Paradise', city: 'Irvine' },
        { name: 'Afuri Ramen', city: 'Costa Mesa' }
      )
    ).toBe(false);
  });

  it('extracts friend matches for a given spot', () => {
    const friendList: SharedListPayload = {
      id: 'maya_uid',
      ownerUid: 'maya_uid',
      ownerName: 'Maya',
      handle: 'maya',
      restaurants: [
        makeRestaurant({
          placeId: 'boil_1',
          name: 'Boil & Bake',
          magicScore: 9.4,
          rankIndex: 0,
          notes: 'Get the garlic sourdough bagel',
        }),
      ],
      bookmarks: [makeBookmark({ placeId: 'lilia_1', name: 'Lilia' })],
      createdAt: 1000,
      updatedAt: 1000,
    };

    const matches = getFriendMatchesForSpot(
      { placeId: 'boil_1', name: 'Boil & Bake' },
      [friendList]
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].friendName).toBe('Maya');
    expect(matches[0].magicScore).toBe(9.4);
    expect(matches[0].rankIndex).toBe(0);
    expect(matches[0].notes).toBe('Get the garlic sourdough bagel');
  });

  it('computes group blend (Both Want to Try, Shared Favorites, Try Next, and Taste Match %)', () => {
    const myRestaurants = [
      makeRestaurant({ placeId: 'p1', name: 'Bavel', magicScore: 9.5, rankIndex: 0 }),
      makeRestaurant({ placeId: 'p2', name: 'Bestia', magicScore: 8.8, rankIndex: 1 }),
    ];
    const myBookmarks = [
      makeBookmark({ placeId: 'p3', name: 'Kato' }),
    ];

    const friendList: SharedListPayload = {
      id: 'maya_uid',
      ownerUid: 'maya_uid',
      ownerName: 'Maya',
      restaurants: [
        makeRestaurant({ placeId: 'p1', name: 'Bavel', magicScore: 9.3, rankIndex: 0 }),
        makeRestaurant({ placeId: 'p3', name: 'Kato', magicScore: 9.1, rankIndex: 1 }),
        makeRestaurant({ placeId: 'p4', name: 'Hayato', magicScore: 9.6, rankIndex: 2 }),
      ],
      bookmarks: [
        makeBookmark({ placeId: 'p2', name: 'Bestia' }),
      ],
      createdAt: 1000,
      updatedAt: 1000,
    };

    const blend = computeGroupBlend(myRestaurants, myBookmarks, [friendList]);

    // Kato (my bookmark + Maya's 9.1) and Bestia (my 8.8 + Maya's bookmark) should be in bothWantToTry
    expect(blend.bothWantToTry.map((i) => i.name)).toContain('Kato');
    expect(blend.bothWantToTry.map((i) => i.name)).toContain('Bestia');

    // Bavel is ranked by both (9.5 and 9.3) -> sharedFavorites
    expect(blend.sharedFavorites).toHaveLength(1);
    expect(blend.sharedFavorites[0].name).toBe('Bavel');
    expect(blend.sharedFavorites[0].combinedScore).toBe(9.4);

    // Hayato is ranked 9.6 by Maya and not visited by me -> forYouFromFriends
    expect(blend.forYouFromFriends.map((i) => i.name)).toContain('Hayato');

    // Taste match should be high since Bavel is 9.5 vs 9.3
    expect(blend.tasteMatchPct).toBeGreaterThanOrEqual(80);
  });

  it('deduplicates multiple sharedList snapshots from the same ownerUid into a single canonical user list', () => {
    const lists: SharedListPayload[] = [
      {
        id: 'snap_old',
        ownerUid: 'u1',
        ownerName: 'Alex',
        restaurants: [makeRestaurant({ placeId: 'p1', name: 'Spot A', magicScore: 8.0 })],
        bookmarks: [],
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: 'u1',
        ownerUid: 'u1',
        ownerName: 'Alex',
        restaurants: [
          makeRestaurant({ placeId: 'p1', name: 'Spot A', magicScore: 9.0 }),
          makeRestaurant({ placeId: 'p2', name: 'Spot B', magicScore: 8.5 }),
        ],
        bookmarks: [],
        createdAt: 1000,
        updatedAt: 2000,
      },
    ];

    const deduped = deduplicateUserLists(lists);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe('u1');
    expect(deduped[0].restaurants).toHaveLength(2);
  });

  it('computes high taste similarity for aligned palates even when one user rates harsher', () => {
    // User A rates generously (mean ~8.5)
    const generousUser = [
      makeRestaurant({ placeId: 'p1', name: 'Sushi Sho', magicScore: 9.8, rankIndex: 0 }),
      makeRestaurant({ placeId: 'p2', name: 'Bavel', magicScore: 9.0, rankIndex: 1 }),
      makeRestaurant({ placeId: 'p3', name: 'Local Diner', magicScore: 7.5, rankIndex: 2 }),
      makeRestaurant({ placeId: 'p4', name: 'Chain Burger', magicScore: 6.8, rankIndex: 3 }),
    ];

    // User B has the exact same rank order and relative Z-scores, but rates 1.5 points harsher!
    const harshAlignedFriend = [
      makeRestaurant({ placeId: 'p1', name: 'Sushi Sho', magicScore: 8.3, rankIndex: 0 }),
      makeRestaurant({ placeId: 'p2', name: 'Bavel', magicScore: 7.5, rankIndex: 1 }),
      makeRestaurant({ placeId: 'p3', name: 'Local Diner', magicScore: 6.0, rankIndex: 2 }),
      makeRestaurant({ placeId: 'p4', name: 'Chain Burger', magicScore: 5.3, rankIndex: 3 }),
    ];

    // User C has the exact opposite rank order
    const oppositeUser = [
      makeRestaurant({ placeId: 'p4', name: 'Chain Burger', magicScore: 9.6, rankIndex: 0 }),
      makeRestaurant({ placeId: 'p3', name: 'Local Diner', magicScore: 8.9, rankIndex: 1 }),
      makeRestaurant({ placeId: 'p2', name: 'Bavel', magicScore: 7.2, rankIndex: 2 }),
      makeRestaurant({ placeId: 'p1', name: 'Sushi Sho', magicScore: 6.1, rankIndex: 3 }),
    ];

    const alignedSim = computeUserTasteSimilarity(generousUser, harshAlignedFriend);
    const oppositeSim = computeUserTasteSimilarity(generousUser, oppositeUser);

    expect(alignedSim.sharedCount).toBe(4);
    expect(alignedSim.similarity).toBeGreaterThan(0.5);
    expect(oppositeSim.similarity).toBeLessThan(0);
    expect(alignedSim.tasteMatchPct!).toBeGreaterThan(oppositeSim.tasteMatchPct! + 35);
  });

  it('computes global jelly Avg, Friends Avg, and Z-score calibrated predictedScore for a spot', () => {
    // Active user ("me") has a generous scale (mean ~8.3)
    const myRestaurants = [
      makeRestaurant({ placeId: 'p1', name: 'Sushi Sho', magicScore: 9.6, rankIndex: 0, cuisines: ['Japanese'] }),
      makeRestaurant({ placeId: 'p2', name: 'Bavel', magicScore: 8.8, rankIndex: 1, cuisines: ['Mediterranean'] }),
      makeRestaurant({ placeId: 'p3', name: 'Taco Stand', magicScore: 7.8, rankIndex: 2, cuisines: ['Mexican'] }),
      makeRestaurant({ placeId: 'p4', name: 'Mid Cafe', magicScore: 7.0, rankIndex: 3, cuisines: ['American'] }),
    ];

    // Friend "Maya" is a harsh grader (mean ~6.8) whose rank order matches mine (p1 > p2 > p3 > p4),
    // and she gives a new spot "Hayato" an 8.2 (which for her is her #1 spot, +1.5 SD above her mean!).
    const mayaList: SharedListPayload = {
      id: 'maya',
      ownerUid: 'maya',
      ownerName: 'Maya',
      restaurants: [
        makeRestaurant({ placeId: 'target_hayato', name: 'Hayato', magicScore: 8.2, rankIndex: 0, cuisines: ['Japanese'] }),
        makeRestaurant({ placeId: 'p1', name: 'Sushi Sho', magicScore: 8.0, rankIndex: 1 }),
        makeRestaurant({ placeId: 'p2', name: 'Bavel', magicScore: 7.2, rankIndex: 2 }),
        makeRestaurant({ placeId: 'p3', name: 'Taco Stand', magicScore: 6.2, rankIndex: 3 }),
        makeRestaurant({ placeId: 'p4', name: 'Mid Cafe', magicScore: 5.4, rankIndex: 4 }),
      ],
      bookmarks: [],
      createdAt: 1000,
      updatedAt: 1000,
    };

    const metrics = getSpotSocialMetrics(
      { placeId: 'target_hayato', name: 'Hayato', cuisines: ['Japanese'], categories: ['restaurants'] },
      {
        myUid: 'me_uid',
        myRestaurants,
        friendLists: [mayaList],
        // Server-kept stats for everyone who ranked it: Maya (8.2) + a stranger (6.0)
        communityStat: { sum: 14.2, count: 2 },
      }
    );

    // Friends Avg: only Maya (8.2)
    expect(metrics.friendsAvg).toBe(8.2);
    expect(metrics.friendsCount).toBe(1);

    // Global jelly Avg comes from the stats: 7.1 across 2 unique jelly users
    expect(metrics.communityAvg).toBe(7.1);
    expect(metrics.communityCount).toBe(2);

    // Without stats it falls back to me + the friends I follow (only Maya ranked it)
    const offline = getSpotSocialMetrics(
      { placeId: 'target_hayato', name: 'Hayato', cuisines: ['Japanese'], categories: ['restaurants'] },
      { myUid: 'me_uid', myRestaurants, friendLists: [mayaList] }
    );
    expect(offline.communityAvg).toBe(8.2);
    expect(offline.communityCount).toBe(1);

    // A stat that counts fewer raters than the friends visible here is lagging, so it's ignored
    const twin = { ...mayaList, id: 'twin', ownerUid: 'twin', ownerName: 'Twin' };
    const lagging = getSpotSocialMetrics(
      { placeId: 'target_hayato', name: 'Hayato', cuisines: ['Japanese'], categories: ['restaurants'] },
      { myUid: 'me_uid', myRestaurants, friendLists: [mayaList, twin], communityStat: { sum: 6, count: 1 } }
    );
    expect(lagging.communityAvg).toBe(8.2);
    expect(lagging.communityCount).toBe(2);

    // Predicted score for me:
    // Because Maya has strong positive correlation with me and 8.2 is well above her harsh 6.8 average,
    // my predicted score should be
    // projected onto MY generous scale (> 8.8, even higher than Maya's raw 8.2!).
    expect(metrics.predictedScore).not.toBeNull();
    expect(metrics.predictedScore!).toBeGreaterThan(8.8);
  });
});


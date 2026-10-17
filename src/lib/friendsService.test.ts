import { describe, expect, it } from 'vitest';
import {
  computeGroupBlend,
  deriveDefaultHandle,
  getFriendMatchesForSpot,
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
    meal: overrides.meal || 'Dinner',
    meals: overrides.meals || ['Dinner'],
    cuisines: overrides.cuisines || ['Japanese'],
    initialRating: overrides.initialRating ?? 8.5,
    elo: overrides.elo ?? 1600,
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
    meal: overrides.meal || 'Dinner',
    meals: overrides.meals || ['Dinner'],
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
    expect(blend.tasteMatchPct).toBeGreaterThanOrEqual(90);
  });
});

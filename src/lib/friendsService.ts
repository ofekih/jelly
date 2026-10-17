import {
  BookmarkEntry,
  FriendSpotMatch,
  MealCategory,
  RestaurantEntry,
  SharedListPayload,
} from '../types';

export function sanitizeHandle(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_.-]/g, '')
    .slice(0, 30);
}

export function deriveDefaultHandle(
  displayName?: string | null,
  email?: string | null,
  uid?: string
): string {
  if (email) {
    const prefix = sanitizeHandle(email.split('@')[0] || '');
    if (prefix.length >= 2) return prefix;
  }
  if (displayName) {
    const cleaned = sanitizeHandle(displayName.replace(/\s+/g, ''));
    if (cleaned.length >= 2) return cleaned;
  }
  return uid ? `jelly_${uid.slice(0, 6).toLowerCase()}` : 'jellyuser';
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/^the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSameSpot(
  a: { placeId?: string; name: string; city?: string; formattedAddress?: string },
  b: { placeId?: string; name: string; city?: string; formattedAddress?: string }
): boolean {
  if (
    a.placeId &&
    b.placeId &&
    !a.placeId.startsWith('manual_') &&
    !b.placeId.startsWith('manual_') &&
    a.placeId === b.placeId
  ) {
    return true;
  }

  const normA = normalizeName(a.name);
  const normB = normalizeName(b.name);
  if (!normA || normA !== normB) return false;

  if (a.city && b.city) {
    return a.city.toLowerCase().trim() === b.city.toLowerCase().trim();
  }
  return true;
}

/**
 * Returns all followed friends who have ranked or bookmarked a given restaurant.
 */
export function getFriendMatchesForSpot(
  spot: { placeId?: string; name: string; city?: string; formattedAddress?: string },
  friendLists: SharedListPayload[]
): FriendSpotMatch[] {
  const matches: FriendSpotMatch[] = [];

  for (const fl of friendLists) {
    // Check ranked restaurants first (if multiple meals, pick the highest scored one)
    const rankedMatches = (fl.restaurants || []).filter((r) => isSameSpot(spot, r));
    if (rankedMatches.length > 0) {
      rankedMatches.sort((a, b) => b.magicScore - a.magicScore);
      const best = rankedMatches[0];
      matches.push({
        friendUid: fl.ownerUid || fl.id,
        friendName: fl.ownerName || 'Friend',
        friendPhotoURL: fl.photoURL,
        status: 'ranked',
        magicScore: best.magicScore,
        rankIndex: best.rankIndex,
        meal: best.meal,
        notes: best.notes,
        favoriteDishes: best.favoriteDishes,
      });
      continue;
    }

    // Check Want to Try bookmarks
    const bmMatch = (fl.bookmarks || []).find((b) => isSameSpot(spot, b));
    if (bmMatch) {
      matches.push({
        friendUid: fl.ownerUid || fl.id,
        friendName: fl.ownerName || 'Friend',
        friendPhotoURL: fl.photoURL,
        status: 'want_to_try',
        meal: bmMatch.meal,
        notes: bmMatch.notes,
      });
    }
  }

  matches.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'ranked' ? -1 : 1;
    return (b.magicScore || 0) - (a.magicScore || 0);
  });

  return matches;
}

export interface BlendSpotItem {
  key: string;
  placeId?: string;
  name: string;
  formattedAddress: string;
  neighborhood?: string;
  city?: string;
  lat?: number;
  lng?: number;
  googleMapsUri?: string;
  priceLevel?: number;
  meal: MealCategory;
  meals: MealCategory[];
  cuisines: string[];
  primaryTypeDisplay?: string;
  combinedScore?: number;
  myScore?: number;
  myWantToTry?: boolean;
  friendBreakdown: Array<{
    friendUid: string;
    friendName: string;
    status: 'ranked' | 'want_to_try';
    score?: number;
    notes?: string;
  }>;
}

export interface BlendResult {
  bothWantToTry: BlendSpotItem[];
  sharedFavorites: BlendSpotItem[];
  forYouFromFriends: BlendSpotItem[];
  tasteMatchPct: number | null;
}

export function computeGroupBlend(
  myRestaurants: RestaurantEntry[],
  myBookmarks: BookmarkEntry[],
  selectedFriendLists: SharedListPayload[]
): BlendResult {
  const buckets = new Map<string, BlendSpotItem>();

  const getOrCreateBucket = (source: {
    placeId?: string;
    name: string;
    formattedAddress: string;
    neighborhood?: string;
    city?: string;
    lat?: number;
    lng?: number;
    googleMapsUri?: string;
    priceLevel?: number;
    meal: MealCategory;
    meals?: MealCategory[];
    cuisines?: string[];
    primaryTypeDisplay?: string;
  }): BlendSpotItem => {
    for (const existing of buckets.values()) {
      if (isSameSpot(existing, source)) {
        return existing;
      }
    }
    const key =
      source.placeId && !source.placeId.startsWith('manual_')
        ? source.placeId
        : `${normalizeName(source.name)}|${(source.city || '').toLowerCase()}`;

    const created: BlendSpotItem = {
      key,
      placeId: source.placeId,
      name: source.name,
      formattedAddress: source.formattedAddress,
      neighborhood: source.neighborhood,
      city: source.city,
      lat: source.lat,
      lng: source.lng,
      googleMapsUri: source.googleMapsUri,
      priceLevel: source.priceLevel,
      meal: source.meal,
      meals: source.meals?.length ? source.meals : [source.meal],
      cuisines: source.cuisines || [],
      primaryTypeDisplay: source.primaryTypeDisplay,
      friendBreakdown: [],
    };
    buckets.set(key, created);
    return created;
  };

  // 1. Add my ranked spots
  for (const r of myRestaurants) {
    const b = getOrCreateBucket(r);
    if (b.myScore === undefined || r.magicScore > b.myScore) {
      b.myScore = r.magicScore;
    }
  }

  // 2. Add my bookmarks
  for (const bm of myBookmarks) {
    const b = getOrCreateBucket(bm);
    b.myWantToTry = true;
  }

  // 3. Add selected friends' ranked spots & bookmarks
  for (const fl of selectedFriendLists) {
    const fUid = fl.ownerUid || fl.id;
    const fName = fl.ownerName || 'Friend';

    for (const r of fl.restaurants || []) {
      const b = getOrCreateBucket(r);
      const existingFriend = b.friendBreakdown.find((x) => x.friendUid === fUid);
      if (!existingFriend) {
        b.friendBreakdown.push({
          friendUid: fUid,
          friendName: fName,
          status: 'ranked',
          score: r.magicScore,
          notes: r.notes,
        });
      } else if (
        existingFriend.status === 'want_to_try' ||
        (r.magicScore > (existingFriend.score || 0))
      ) {
        existingFriend.status = 'ranked';
        existingFriend.score = r.magicScore;
        existingFriend.notes = r.notes;
      }
    }

    for (const bm of fl.bookmarks || []) {
      const b = getOrCreateBucket(bm);
      const existingFriend = b.friendBreakdown.find((x) => x.friendUid === fUid);
      if (!existingFriend) {
        b.friendBreakdown.push({
          friendUid: fUid,
          friendName: fName,
          status: 'want_to_try',
          notes: bm.notes,
        });
      }
    }
  }

  const bothWantToTry: BlendSpotItem[] = [];
  const sharedFavorites: BlendSpotItem[] = [];
  const forYouFromFriends: BlendSpotItem[] = [];

  let diffSum = 0;
  let sharedCount = 0;

  for (const item of buckets.values()) {
    const rankedFriends = item.friendBreakdown.filter((f) => f.status === 'ranked');
    const bookmarkFriends = item.friendBreakdown.filter((f) => f.status === 'want_to_try');

    // Compute average score across everyone who ranked it
    const allScores: number[] = [];
    if (item.myScore !== undefined) allScores.push(item.myScore);
    for (const rf of rankedFriends) {
      if (typeof rf.score === 'number') allScores.push(rf.score);
    }
    if (allScores.length > 0) {
      item.combinedScore =
        Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10) / 10;
    }

    // 1. Both Want to Try:
    //    - I want to try AND at least 1 friend wants to try (or ranked it >= 7.8)
    //    - OR a friend wants to try AND I already ranked it >= 7.8
    //    - OR 2+ friends want to try and I haven't ranked it yet
    const friendLovedOrBookmarked =
      bookmarkFriends.length > 0 || rankedFriends.some((f) => (f.score || 0) >= 7.8);
    if (
      (item.myWantToTry && friendLovedOrBookmarked) ||
      ((item.myScore || 0) >= 7.8 && bookmarkFriends.length > 0) ||
      (item.myScore === undefined && bookmarkFriends.length >= 2)
    ) {
      bothWantToTry.push(item);
    }

    // 2. Shared Favorites (Ranked by me + at least 1 friend)
    if (item.myScore !== undefined && rankedFriends.length > 0) {
      sharedFavorites.push(item);
      const friendAvg =
        rankedFriends.reduce((acc, f) => acc + (f.score || 7.5), 0) / rankedFriends.length;
      diffSum += Math.abs(item.myScore - friendAvg);
      sharedCount += 1;
    }

    // 3. Friends' Top Picks You Haven't Tried Yet (friend rated >= 7.8, I haven't ranked it)
    if (
      item.myScore === undefined &&
      rankedFriends.some((f) => (f.score || 0) >= 7.8)
    ) {
      forYouFromFriends.push(item);
    }
  }

  bothWantToTry.sort((a, b) => (b.combinedScore || 8.5) - (a.combinedScore || 8.5));
  sharedFavorites.sort((a, b) => (b.combinedScore || 0) - (a.combinedScore || 0));
  forYouFromFriends.sort((a, b) => (b.combinedScore || 0) - (a.combinedScore || 0));

  const tasteMatchPct =
    sharedCount > 0
      ? Math.max(48, Math.min(99, Math.round(100 - (diffSum / sharedCount) * 11)))
      : null;

  return {
    bothWantToTry,
    sharedFavorites,
    forYouFromFriends,
    tasteMatchPct,
  };
}

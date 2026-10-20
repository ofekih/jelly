import {
  BookmarkEntry,
  CATEGORY_GROUP,
  FriendSpotMatch,
  SpotCategory,
  RestaurantEntry,
  SharedListPayload,
} from '../types';
import {
  bestScoreFor,
  buildRater,
  computeTasteSimilarity,
  isSameSpot,
  isStrongerPrediction,
  normalizeName,
  predictTaste,
  type PredictionConfidence,
  type TastePrediction,
  type TasteRater,
  type TasteSimilarityResult,
} from './tasteModel';

export { isSameSpot };

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

/**
 * Returns all followed friends who have ranked or bookmarked a given restaurant.
 */
export function getFriendMatchesForSpot(
  spot: { placeId?: string; name: string; city?: string; formattedAddress?: string },
  friendLists: SharedListPayload[]
): FriendSpotMatch[] {
  const matches: FriendSpotMatch[] = [];

  for (const fl of friendLists) {
    // Check ranked restaurants first (if in multiple lists, pick the highest scored one)
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
        category: best.category,
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
        category: bmMatch.category,
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
  category: SpotCategory;
  categories: SpotCategory[];
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
    category: SpotCategory;
    categories?: SpotCategory[];
    cuisines?: string[];
    primaryTypeDisplay?: string;
  }): BlendSpotItem => {
    // Buckets are per (spot, category list): scores from different lists are never mixed
    for (const existing of buckets.values()) {
      if (existing.category === source.category && isSameSpot(existing, source)) {
        return existing;
      }
    }
    const spotKey =
      source.placeId && !source.placeId.startsWith('manual_')
        ? source.placeId
        : `${normalizeName(source.name)}|${(source.city || '').toLowerCase()}`;
    const key = `${spotKey}__${source.category}`;

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
      category: source.category,
      categories: source.categories?.length ? source.categories : [source.category],
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

  // Sort "For You" recommendations using our personalized taste prediction when available
  for (const item of forYouFromFriends) {
    const metrics = getSpotSocialMetrics(item, {
      myRestaurants,
      friendLists: selectedFriendLists,
    });
    if (metrics.predictedScore !== null) {
      item.combinedScore = metrics.predictedScore;
    }
  }

  bothWantToTry.sort((a, b) => (b.combinedScore || 8.5) - (a.combinedScore || 8.5));
  sharedFavorites.sort((a, b) => (b.combinedScore || 0) - (a.combinedScore || 0));
  forYouFromFriends.sort((a, b) => (b.combinedScore || 0) - (a.combinedScore || 0));

  // Compute group Taste Match % using pairwise palate similarity across selected friends
  const friendSimilarities = selectedFriendLists
    .map((fl) => computeUserTasteSimilarity(myRestaurants, fl.restaurants || []).tasteMatchPct)
    .filter((pct): pct is number => pct !== null);

  const tasteMatchPct =
    friendSimilarities.length > 0
      ? Math.round(
          friendSimilarities.reduce((acc, v) => acc + v, 0) / friendSimilarities.length
        )
      : sharedCount > 0
      ? Math.max(48, Math.min(99, Math.round(100 - (diffSum / sharedCount) * 11)))
      : null;

  return {
    bothWantToTry,
    sharedFavorites,
    forYouFromFriends,
    tasteMatchPct,
  };
}

/**
 * Deduplicates SharedListPayload documents by user UID so each jelly user is counted once,
 * preferring their canonical live document (`id === ownerUid`) or the most recently updated doc.
 */
export function deduplicateUserLists(lists: SharedListPayload[]): SharedListPayload[] {
  const byOwner = new Map<string, SharedListPayload>();
  for (const list of lists) {
    if (!list || !Array.isArray(list.restaurants)) continue;
    const uid = list.ownerUid || list.id;
    if (!uid) continue;
    const existing = byOwner.get(uid);
    if (!existing) {
      byOwner.set(uid, list);
      continue;
    }
    const isCanonical = list.id === list.ownerUid;
    const existingCanonical = existing.id === existing.ownerUid;
    if (isCanonical && !existingCanonical) {
      byOwner.set(uid, list);
    } else if (isCanonical === existingCanonical && (list.updatedAt || 0) > (existing.updatedAt || 0)) {
      byOwner.set(uid, list);
    }
  }
  return Array.from(byOwner.values());
}

export type { TasteSimilarityResult };

export function computeUserTasteSimilarity(
  myRestaurants: RestaurantEntry[],
  otherRestaurants: RestaurantEntry[]
): TasteSimilarityResult {
  return computeTasteSimilarity(myRestaurants, otherRestaurants);
}

export interface SpotSocialMetrics {
  friendsAvg: number | null;
  friendsCount: number;
  communityAvg: number | null;
  communityCount: number;
  predictedScore: number | null;
  predictionConfidence: PredictionConfidence | null;
  predictionBasis: string | null;
}

/** Server-kept community stats for one place in one list (`placeStats/{placeId}__{category}`). */
export interface CommunityStat {
  sum: number;
  count: number;
}

/**
 * Computes:
 * 1. `friendsAvg`: Average score among followed friends who ranked this spot
 * 2. `communityAvg`: Average score across all unique jelly users who ranked this spot (from
 *    `communityStat`; without one, or when it lags behind, you plus the friends you follow)
 * 3. `predictedScore`: Personalized prediction (`predictTaste` in `tasteModel.ts`) from the
 *    friends you follow, or the server's prediction from all taste-matched jelly users
 *    (`serverPrediction`, from `users/{uid}/private/predictions`) when that rests on more evidence.
 */
export function getSpotSocialMetrics(
  spot: {
    placeId?: string;
    name: string;
    city?: string;
    formattedAddress?: string;
    category?: SpotCategory;
    categories?: SpotCategory[];
    cuisines?: string[];
  },
  options: {
    myUid?: string | null;
    myRestaurants?: RestaurantEntry[];
    friendLists?: SharedListPayload[];
    communityStat?: CommunityStat | null;
    serverPrediction?: TastePrediction | null;
  }
): SpotSocialMetrics {
  const myRestaurants = options.myRestaurants || [];
  const friendLists = deduplicateUserLists(options.friendLists || []);

  // 1. Friends Average (when the spot belongs to a specific list, only that list counts)
  const friendScores: number[] = [];
  const raters: TasteRater[] = [];
  for (const fl of friendLists) {
    const uid = fl.ownerUid || fl.id;
    const best = bestScoreFor(spot, fl.restaurants || []);
    if (best === null) continue;
    friendScores.push(best);
    if (options.myUid && uid === options.myUid) continue;
    raters.push(
      buildRater(myRestaurants, fl.restaurants || [], best, {
        name: fl.ownerName || 'User',
        isFriend: true,
      })
    );
  }
  const friendsCount = friendScores.length;
  const friendsAvg =
    friendsCount > 0
      ? Math.round((friendScores.reduce((a, b) => a + b, 0) / friendsCount) * 10) / 10
      : null;

  // 2. Global jelly Community Average (all unique users including current user if ranked)
  const communityScores: number[] = raters.map((r) => r.score);
  const myBest = bestScoreFor(spot, myRestaurants);
  if (myBest !== null) communityScores.unshift(myBest);

  // The server stat covers everyone, but can lag behind what's visible here (scores just
  // changed, friends on older app versions); never show fewer raters than you + your friends
  const stat = options.communityStat;
  const useStat = Boolean(stat && stat.count > 0 && stat.count >= communityScores.length);
  const communityCount = useStat ? stat!.count : communityScores.length;
  const communitySum = useStat ? stat!.sum : communityScores.reduce((a, b) => a + b, 0);
  const communityAvg =
    communityCount > 0 ? Math.round((communitySum / communityCount) * 10) / 10 : null;

  // 3. Personalized Taste Prediction: friends here, everyone (privacy-guarded) on the server
  const local = predictTaste(spot, myRestaurants, raters, (c) => CATEGORY_GROUP[c as SpotCategory]);
  const server = myRestaurants.length > 0 ? options.serverPrediction : null;
  const prediction = server && isStrongerPrediction(server, local) ? server : local;

  return {
    friendsAvg,
    friendsCount,
    communityAvg,
    communityCount,
    predictedScore: prediction?.score ?? null,
    predictionConfidence: prediction?.confidence ?? null,
    predictionBasis: prediction?.basis ?? null,
  };
}

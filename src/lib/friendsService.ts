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

  // Sort "For You" recommendations using our personalized taste prediction when available
  for (const item of forYouFromFriends) {
    const metrics = getSpotSocialMetrics(item, {
      myRestaurants,
      friendLists: selectedFriendLists,
      communityLists: selectedFriendLists,
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

export interface UserRatingStats {
  mean: number;
  std: number;
  count: number;
}

export function computeUserRatingStats(restaurants: RestaurantEntry[]): UserRatingStats {
  if (!restaurants || restaurants.length === 0) {
    return { mean: 7.4, std: 1.1, count: 0 };
  }
  // Deduplicate by spot (take highest score if ranked across multiple meals)
  const scores = restaurants.map((r) => r.magicScore);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (scores.length < 2) {
    return { mean, std: 1.0, count: scores.length };
  }
  const variance =
    scores.reduce((acc, s) => acc + (s - mean) * (s - mean), 0) / scores.length;
  const std = Math.max(0.45, Math.sqrt(variance));
  return { mean, std, count: scores.length };
}

export interface TasteSimilarityResult {
  sharedCount: number;
  pearson: number;
  kendallTau: number;
  zAgreement: number;
  similarity: number; // Shrinkage-regularized [-1, 1] weight
  tasteMatchPct: number | null; // 0..99% human-readable taste match
}

/**
 * Computes taste similarity between two users' ranked lists using a hybrid of:
 * 1. Pearson linear correlation on shared spots (scale-invariant relative preference)
 * 2. Kendall's rank correlation tau on all pairs of shared spots (order concordance)
 * 3. Standardized Z-score proximity agreement (handles 1–2 shared spots gracefully)
 * 4. Bayesian significance shrinkage n / (n + 3) so tiny overlaps don't overfit.
 */
export function computeUserTasteSimilarity(
  myRestaurants: RestaurantEntry[],
  otherRestaurants: RestaurantEntry[]
): TasteSimilarityResult {
  if (!myRestaurants.length || !otherRestaurants.length) {
    return {
      sharedCount: 0,
      pearson: 0,
      kendallTau: 0,
      zAgreement: 0,
      similarity: 0.12, // Small positive baseline community prior
      tasteMatchPct: null,
    };
  }

  const myStats = computeUserRatingStats(myRestaurants);
  const otherStats = computeUserRatingStats(otherRestaurants);

  const sharedPairs: Array<{ myScore: number; otherScore: number; myZ: number; otherZ: number }> = [];
  const usedOtherIndices = new Set<number>();

  for (const mySpot of myRestaurants) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let j = 0; j < otherRestaurants.length; j++) {
      if (usedOtherIndices.has(j)) continue;
      if (isSameSpot(mySpot, otherRestaurants[j])) {
        if (otherRestaurants[j].magicScore > bestScore) {
          bestScore = otherRestaurants[j].magicScore;
          bestIdx = j;
        }
      }
    }
    if (bestIdx !== -1) {
      usedOtherIndices.add(bestIdx);
      const otherSpot = otherRestaurants[bestIdx];
      sharedPairs.push({
        myScore: mySpot.magicScore,
        otherScore: otherSpot.magicScore,
        myZ: (mySpot.magicScore - myStats.mean) / myStats.std,
        otherZ: (otherSpot.magicScore - otherStats.mean) / otherStats.std,
      });
    }
  }

  const n = sharedPairs.length;
  if (n === 0) {
    return {
      sharedCount: 0,
      pearson: 0,
      kendallTau: 0,
      zAgreement: 0,
      similarity: 0.12,
      tasteMatchPct: null,
    };
  }

  // 1. Standardized Z-Score + absolute score proximity agreement in [-1, 1]
  const meanZDiff =
    sharedPairs.reduce((acc, p) => acc + Math.min(2.2, Math.abs(p.myZ - p.otherZ)), 0) / n;
  const pureZAgreement = Math.max(-1, Math.min(1, 1 - meanZDiff));
  const meanAbsDiff =
    sharedPairs.reduce((acc, p) => acc + Math.min(4.5, Math.abs(p.myScore - p.otherScore)), 0) / n;
  const absAgreement = Math.max(-1, Math.min(1, 1 - meanAbsDiff / 2.2));
  const zAgreement = Math.max(pureZAgreement, 0.55 * pureZAgreement + 0.45 * absAgreement);

  if (n === 1) {
    const shrink = 1 / (1 + 3);
    const similarity = shrink * zAgreement + (1 - shrink) * 0.15;
    const rawPct = Math.round(68 + zAgreement * 28);
    return {
      sharedCount: 1,
      pearson: zAgreement,
      kendallTau: zAgreement,
      zAgreement,
      similarity,
      tasteMatchPct: Math.max(35, Math.min(98, rawPct)),
    };
  }

  // 2. Pearson correlation on shared spots
  const meanMy = sharedPairs.reduce((a, p) => a + p.myScore, 0) / n;
  const meanOther = sharedPairs.reduce((a, p) => a + p.otherScore, 0) / n;
  let num = 0;
  let denMy = 0;
  let denOther = 0;
  for (const p of sharedPairs) {
    const dMy = p.myScore - meanMy;
    const dOther = p.otherScore - meanOther;
    num += dMy * dOther;
    denMy += dMy * dMy;
    denOther += dOther * dOther;
  }
  const pearson =
    denMy > 1e-4 && denOther > 1e-4
      ? Math.max(-1, Math.min(1, num / Math.sqrt(denMy * denOther)))
      : zAgreement;

  // 3. Kendall's rank correlation tau on shared pairs
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const myDiff = sharedPairs[i].myScore - sharedPairs[j].myScore;
      const otherDiff = sharedPairs[i].otherScore - sharedPairs[j].otherScore;
      if (Math.abs(myDiff) < 0.05 && Math.abs(otherDiff) < 0.05) {
        concordant += 1;
      } else if (myDiff * otherDiff > 0) {
        concordant += 1;
      } else if (myDiff * otherDiff < 0) {
        discordant += 1;
      }
    }
  }
  const totalPairs = concordant + discordant;
  const kendallTau = totalPairs > 0 ? (concordant - discordant) / totalPairs : zAgreement;

  // Combine Pearson (50%), Kendall tau (35%), and Z-agreement (15%)
  const rawSim = 0.5 * pearson + 0.35 * kendallTau + 0.15 * zAgreement;

  // Bayesian shrinkage with prior s0 = 0.15 and shrinkage constant tau = 3
  const shrink = n / (n + 3);
  const similarity = Math.max(-1, Math.min(1, shrink * rawSim + (1 - shrink) * 0.15));

  // Map [-1, 1] similarity + rawSim into a human-friendly 35..99% Taste Match
  const blendedForDisplay = 0.65 * rawSim + 0.35 * zAgreement;
  const tasteMatchPct = Math.max(
    35,
    Math.min(99, Math.round(68 + blendedForDisplay * 30))
  );

  return {
    sharedCount: n,
    pearson,
    kendallTau,
    zAgreement,
    similarity,
    tasteMatchPct,
  };
}

export interface SpotSocialMetrics {
  friendsAvg: number | null;
  friendsCount: number;
  communityAvg: number | null;
  communityCount: number;
  predictedScore: number | null;
  predictionConfidence: 'high' | 'medium' | 'low' | null;
  predictionBasis: string | null;
}

/**
 * Computes:
 * 1. `friendsAvg`: Average score among followed friends who ranked this spot
 * 2. `communityAvg`: Average score across all unique jelly users who ranked this spot
 * 3. `predictedScore`: Personalized 1.0–10.0 score prediction for the active user using
 *    Resnick's Z-Score Collaborative Filtering (weighted by Pearson + Kendall palate similarity)
 *    blended with the user's personal Cuisine & Meal affinity prior.
 */
export function getSpotSocialMetrics(
  spot: {
    placeId?: string;
    name: string;
    city?: string;
    formattedAddress?: string;
    meal?: MealCategory;
    meals?: MealCategory[];
    cuisines?: string[];
  },
  options: {
    myUid?: string | null;
    myRestaurants?: RestaurantEntry[];
    friendLists?: SharedListPayload[];
    communityLists?: SharedListPayload[];
  }
): SpotSocialMetrics {
  const myRestaurants = options.myRestaurants || [];
  const friendLists = deduplicateUserLists(options.friendLists || []);
  const allExternalLists = deduplicateUserLists([
    ...(options.communityLists || []),
    ...friendLists,
  ]);

  const friendUidSet = new Set(friendLists.map((fl) => fl.ownerUid || fl.id));

  // 1. Friends Average
  const friendScores: number[] = [];
  for (const fl of friendLists) {
    const matches = (fl.restaurants || []).filter((r) => isSameSpot(spot, r));
    if (matches.length > 0) {
      const best = Math.max(...matches.map((m) => m.magicScore));
      friendScores.push(best);
    }
  }
  const friendsCount = friendScores.length;
  const friendsAvg =
    friendsCount > 0
      ? Math.round((friendScores.reduce((a, b) => a + b, 0) / friendsCount) * 10) / 10
      : null;

  // 2. Global jelly Community Average (all unique users including current user if ranked)
  const communityScores: number[] = [];
  const myMatches = myRestaurants.filter((r) => isSameSpot(spot, r));
  if (myMatches.length > 0) {
    communityScores.push(Math.max(...myMatches.map((m) => m.magicScore)));
  }

  const otherRaters: Array<{
    uid: string;
    name: string;
    isFriend: boolean;
    score: number;
    list: RestaurantEntry[];
  }> = [];

  for (const cl of allExternalLists) {
    const uid = cl.ownerUid || cl.id;
    if (options.myUid && uid === options.myUid) continue;
    const matches = (cl.restaurants || []).filter((r) => isSameSpot(spot, r));
    if (matches.length > 0) {
      const bestScore = Math.max(...matches.map((m) => m.magicScore));
      // If we didn't already include the user's own local score, or if this is a distinct user:
      if (!options.myUid && myMatches.length > 0 && cl.restaurants?.length === myRestaurants.length) {
        // Avoid double-counting unauthenticated user's identical list
      } else {
        communityScores.push(bestScore);
      }
      otherRaters.push({
        uid,
        name: cl.ownerName || 'User',
        isFriend: friendUidSet.has(uid),
        score: bestScore,
        list: cl.restaurants || [],
      });
    }
  }

  const communityCount = communityScores.length;
  const communityAvg =
    communityCount > 0
      ? Math.round((communityScores.reduce((a, b) => a + b, 0) / communityCount) * 10) / 10
      : null;

  // 3. Personalized Taste Prediction Model
  if (myRestaurants.length === 0) {
    return {
      friendsAvg,
      friendsCount,
      communityAvg,
      communityCount,
      predictedScore: null,
      predictionConfidence: null,
      predictionBasis: null,
    };
  }

  const myStats = computeUserRatingStats(myRestaurants);

  // 3a. Personal Cuisine & Meal Affinity Prior
  const spotCuisines = (spot.cuisines || []).map((c) => c.toLowerCase());
  const spotMeals = new Set<MealCategory>(
    spot.meals?.length ? spot.meals : spot.meal ? [spot.meal] : []
  );

  let cuisineDelta = 0;
  let matchedCuisineName: string | null = null;
  let matchedCuisineCount = 0;

  if (spotCuisines.length > 0) {
    const sameCuisineSpots = myRestaurants.filter((r) =>
      (r.cuisines || []).some((c) => spotCuisines.includes(c.toLowerCase()))
    );
    matchedCuisineCount = sameCuisineSpots.length;
    if (matchedCuisineCount > 0) {
      const rawAvg =
        sameCuisineSpots.reduce((acc, r) => acc + r.magicScore, 0) / matchedCuisineCount;
      // Bayesian damping n / (n + 2)
      cuisineDelta = ((rawAvg - myStats.mean) * matchedCuisineCount) / (matchedCuisineCount + 2);
      matchedCuisineName = spot.cuisines?.[0] || null;
    }
  }

  let mealDelta = 0;
  if (spotMeals.size > 0) {
    const sameMealSpots = myRestaurants.filter((r) => spotMeals.has(r.meal));
    if (sameMealSpots.length >= 2) {
      const rawMealAvg =
        sameMealSpots.reduce((acc, r) => acc + r.magicScore, 0) / sameMealSpots.length;
      mealDelta = ((rawMealAvg - myStats.mean) * sameMealSpots.length) / (sameMealSpots.length + 3);
    }
  }

  const personalAffinityPrior = Math.max(
    1.0,
    Math.min(10.0, myStats.mean + cuisineDelta + 0.35 * mealDelta)
  );

  // 3b. Collaborative Filtering across positively correlated raters (Resnick's Z-score projection)
  let weightedZSum = 0;
  let weightSum = 0;
  let tasteMatchedRatersCount = 0;
  let bestFriendMatch: { name: string; pct: number } | null = null;

  for (const rater of otherRaters) {
    const raterStats = computeUserRatingStats(rater.list);
    const raterZ = Math.max(-2.6, Math.min(2.6, (rater.score - raterStats.mean) / raterStats.std));
    const sim = computeUserTasteSimilarity(myRestaurants, rater.list);

    // Only include positively correlated raters in the taste neighborhood
    if (sim.similarity <= 0) {
      continue;
    }

    if (sim.sharedCount > 0) {
      tasteMatchedRatersCount += 1;
      if (
        rater.isFriend &&
        sim.tasteMatchPct !== null &&
        (!bestFriendMatch || sim.tasteMatchPct > bestFriendMatch.pct)
      ) {
        bestFriendMatch = { name: rater.name, pct: sim.tasteMatchPct };
      }
    }

    // Friends you follow get a 1.35x trust boost
    const friendMultiplier = rater.isFriend ? 1.35 : 1.0;
    const effectiveWeight = sim.similarity * friendMultiplier;

    weightedZSum += effectiveWeight * raterZ;
    weightSum += effectiveWeight;
  }

  if (otherRaters.length === 0 && matchedCuisineCount < 2) {
    return {
      friendsAvg,
      friendsCount,
      communityAvg,
      communityCount,
      predictedScore: null,
      predictionConfidence: null,
      predictionBasis: null,
    };
  }

  let predictedRaw: number;
  if (weightSum > 0.02) {
    const predictedZ = weightedZSum / weightSum;
    const cfEstimate = myStats.mean + myStats.std * predictedZ;
    // Blend CF estimate with personal cuisine/meal affinity prior based on total weight evidence
    const cfAlpha = weightSum / (weightSum + 0.35);
    predictedRaw = cfAlpha * cfEstimate + (1 - cfAlpha) * personalAffinityPrior;
  } else {
    predictedRaw = personalAffinityPrior;
  }

  const predictedScore = Math.max(1.0, Math.min(10.0, Math.round(predictedRaw * 10) / 10));

  const predictionConfidence: 'high' | 'medium' | 'low' =
    tasteMatchedRatersCount >= 2 || (tasteMatchedRatersCount >= 1 && matchedCuisineCount >= 2)
      ? 'high'
      : otherRaters.length >= 1 || matchedCuisineCount >= 3
      ? 'medium'
      : 'low';

  let predictionBasis = 'Based on your rating distribution';
  if (bestFriendMatch) {
    predictionBasis = `Based on ${bestFriendMatch.name} (${bestFriendMatch.pct}% taste match)${
      matchedCuisineName && matchedCuisineCount >= 2 ? ` & your ${matchedCuisineName} ratings` : ''
    }`;
  } else if (tasteMatchedRatersCount > 0) {
    predictionBasis = `Based on ${tasteMatchedRatersCount} taste-matched jelly ${
      tasteMatchedRatersCount === 1 ? 'user' : 'users'
    }${matchedCuisineName && matchedCuisineCount >= 2 ? ` & your ${matchedCuisineName} ratings` : ''}`;
  } else if (otherRaters.length > 0 && matchedCuisineName && matchedCuisineCount >= 2) {
    predictionBasis = `Based on jelly raters & your ${matchedCuisineName} history`;
  } else if (otherRaters.length > 0) {
    predictionBasis = `Calibrated from ${otherRaters.length} jelly ${
      otherRaters.length === 1 ? 'rater' : 'raters'
    } to your scale`;
  } else if (matchedCuisineName && matchedCuisineCount >= 2) {
    predictionBasis = `Based on your ${matchedCuisineCount} ranked ${matchedCuisineName} spots`;
  }

  return {
    friendsAvg,
    friendsCount,
    communityAvg,
    communityCount,
    predictedScore,
    predictionConfidence,
    predictionBasis,
  };
}


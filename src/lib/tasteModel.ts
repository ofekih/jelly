/**
 * Taste model: how alike two people's lists are, and what score a spot would likely get from
 * you. Pure and dependency-free on purpose: the web app (`friendsService.ts`, predictions from
 * the friends you follow) and the Cloud Functions (`functions/src/predictions.ts`, predictions
 * from every jelly user, stored privately per user) import this one copy.
 */

/** A ranked entry as far as the model cares (`RestaurantEntry` fits). */
export interface TasteEntry {
  placeId?: string;
  name: string;
  city?: string;
  formattedAddress?: string;
  category: string;
  cuisines?: string[];
  magicScore: number;
}

/** The spot being predicted. With `category` only that list counts; else any of `categories`. */
export interface TasteSpot {
  placeId?: string;
  name: string;
  city?: string;
  formattedAddress?: string;
  category?: string;
  categories?: string[];
  cuisines?: string[];
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/^the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

type SpotLike = { placeId?: string; name: string; city?: string; formattedAddress?: string };

const isRealPlaceId = (placeId?: string): placeId is string =>
  Boolean(placeId) && !placeId!.startsWith('manual_');

/** A movie or show (`tmdb:movie:<id>` / `tmdb:tv:<id>`) rather than a place. */
export const isMediaPlaceId = (placeId?: string): boolean => Boolean(placeId?.startsWith('tmdb:'));

function sameSpotNormalized(a: SpotLike, normA: string, b: SpotLike, normB: string): boolean {
  if (isRealPlaceId(a.placeId) && isRealPlaceId(b.placeId)) {
    if (a.placeId === b.placeId) return true;
    // Remakes and namesakes share titles, so titles only match by ID
    if (isMediaPlaceId(a.placeId) || isMediaPlaceId(b.placeId)) return false;
  }
  if (!normA || normA !== normB) return false;
  if (a.city && b.city) {
    return a.city.toLowerCase().trim() === b.city.toLowerCase().trim();
  }
  return true;
}

/**
 * Same Google place (or TMDB title), or the same normalized name in the same city (or no city on
 * either).
 */
export function isSameSpot(a: SpotLike, b: SpotLike): boolean {
  return sameSpotNormalized(a, normalizeName(a.name), b, normalizeName(b.name));
}

/** Per-list lookup of entries by (category, placeId) and (category, normalized name). */
interface SpotIndex {
  norms: string[];
  byPlace: Map<string, number[]>;
  byName: Map<string, number[]>;
}

const indexCache = new WeakMap<readonly TasteEntry[], SpotIndex>();

function indexOf(list: readonly TasteEntry[]): SpotIndex {
  const cached = indexCache.get(list);
  if (cached) return cached;
  const index: SpotIndex = { norms: [], byPlace: new Map(), byName: new Map() };
  const push = (map: Map<string, number[]>, key: string, i: number) => {
    const bucket = map.get(key);
    if (bucket) bucket.push(i);
    else map.set(key, [i]);
  };
  list.forEach((entry, i) => {
    const norm = normalizeName(entry.name);
    index.norms.push(norm);
    if (isRealPlaceId(entry.placeId)) push(index.byPlace, `${entry.category}\u0000${entry.placeId}`, i);
    if (norm) push(index.byName, `${entry.category}\u0000${norm}`, i);
  });
  indexCache.set(list, index);
  return index;
}

/** Indices (ascending) of entries in `list` from `category` that are the same spot as `spot`. */
function matchingIndices(list: readonly TasteEntry[], spot: SpotLike, category: string): number[] {
  const index = indexOf(list);
  const norm = normalizeName(spot.name);
  const candidates = new Set<number>([
    ...(isRealPlaceId(spot.placeId) ? index.byPlace.get(`${category}\u0000${spot.placeId}`) || [] : []),
    ...(norm ? index.byName.get(`${category}\u0000${norm}`) || [] : []),
  ]);
  return [...candidates]
    .sort((a, b) => a - b)
    .filter((i) => sameSpotNormalized(spot, norm, list[i], index.norms[i]));
}

/**
 * Best score `list` gives `spot` (their max if they ranked it in several lists), or null.
 * With a `spot.category`, only that list counts.
 */
export function bestScoreFor(spot: TasteSpot, list: readonly TasteEntry[]): number | null {
  const categories = spot.category ? [spot.category] : [...new Set(list.map((e) => e.category))];
  let best: number | null = null;
  for (const category of categories) {
    for (const i of matchingIndices(list, spot, category)) {
      if (best === null || list[i].magicScore > best) best = list[i].magicScore;
    }
  }
  return best;
}

export interface RatingStats {
  mean: number;
  std: number;
  count: number;
}

export function computeRatingStats(entries: readonly TasteEntry[]): RatingStats {
  if (!entries || entries.length === 0) {
    return { mean: 7.4, std: 1.1, count: 0 };
  }
  const scores = entries.map((r) => r.magicScore);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (scores.length < 2) {
    return { mean, std: 1.0, count: scores.length };
  }
  const variance = scores.reduce((acc, s) => acc + (s - mean) * (s - mean), 0) / scores.length;
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

/** Similarity everyone starts from (and is shrunk towards) when lists barely overlap. */
export const SIMILARITY_PRIOR = 0.15;

const NO_OVERLAP: TasteSimilarityResult = {
  sharedCount: 0,
  pearson: 0,
  kendallTau: 0,
  zAgreement: 0,
  similarity: 0.12, // Small positive baseline community prior
  tasteMatchPct: null,
};

/**
 * Computes taste similarity between two users' ranked lists using a hybrid of:
 * 1. Pearson linear correlation on shared spots (scale-invariant relative preference)
 * 2. Kendall's rank correlation tau on all pairs of shared spots (order concordance)
 * 3. Standardized Z-score proximity agreement (handles 1–2 shared spots gracefully)
 * 4. Bayesian significance shrinkage n / (n + 3) so tiny overlaps don't overfit.
 */
export function computeTasteSimilarity(
  myEntries: readonly TasteEntry[],
  otherEntries: readonly TasteEntry[]
): TasteSimilarityResult {
  if (!myEntries.length || !otherEntries.length) return { ...NO_OVERLAP };

  const myStats = computeRatingStats(myEntries);
  const otherStats = computeRatingStats(otherEntries);

  const sharedPairs: Array<{ myScore: number; otherScore: number; myZ: number; otherZ: number }> = [];
  const usedOtherIndices = new Set<number>();

  for (const mySpot of myEntries) {
    // Only pair up scores from the same category list; their best unused match
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (const j of matchingIndices(otherEntries, mySpot, mySpot.category)) {
      if (usedOtherIndices.has(j)) continue;
      if (otherEntries[j].magicScore > bestScore) {
        bestScore = otherEntries[j].magicScore;
        bestIdx = j;
      }
    }
    if (bestIdx !== -1) {
      usedOtherIndices.add(bestIdx);
      const otherSpot = otherEntries[bestIdx];
      sharedPairs.push({
        myScore: mySpot.magicScore,
        otherScore: otherSpot.magicScore,
        myZ: (mySpot.magicScore - myStats.mean) / myStats.std,
        otherZ: (otherSpot.magicScore - otherStats.mean) / otherStats.std,
      });
    }
  }

  const n = sharedPairs.length;
  if (n === 0) return { ...NO_OVERLAP };

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
    const similarity = shrink * zAgreement + (1 - shrink) * SIMILARITY_PRIOR;
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
  const similarity = Math.max(-1, Math.min(1, shrink * rawSim + (1 - shrink) * SIMILARITY_PRIOR));

  // Map [-1, 1] similarity + rawSim into a human-friendly 35..99% Taste Match
  const blendedForDisplay = 0.65 * rawSim + 0.35 * zAgreement;
  const tasteMatchPct = Math.max(35, Math.min(99, Math.round(68 + blendedForDisplay * 30)));

  return { sharedCount: n, pearson, kendallTau, zAgreement, similarity, tasteMatchPct };
}

/** One person who ranked the spot, with how their taste relates to yours. */
export interface TasteRater {
  /** Shown in the basis text, only ever for friends you follow. */
  name?: string;
  isFriend: boolean;
  /** Their score for the spot. */
  score: number;
  stats: RatingStats;
  similarity: TasteSimilarityResult;
}

export function buildRater(
  myEntries: readonly TasteEntry[],
  theirEntries: readonly TasteEntry[],
  score: number,
  who: { name?: string; isFriend: boolean }
): TasteRater {
  return {
    name: who.name,
    isFriend: who.isFriend,
    score,
    stats: computeRatingStats(theirEntries),
    similarity: computeTasteSimilarity(myEntries, theirEntries),
  };
}

/** Shared spots before someone you don't follow counts as a taste match. */
export const MIN_SHARED_FOR_CORRELATION = 3;
/** Taste-matched raters you don't follow needed before their scores are used at all. */
export const MIN_STRANGER_RATERS = 3;

/** Real evidence of alike taste: enough shared spots, agreeing more than the baseline prior. */
export function isPositivelyCorrelated(sim: TasteSimilarityResult): boolean {
  return sim.sharedCount >= MIN_SHARED_FOR_CORRELATION && sim.similarity > SIMILARITY_PRIOR;
}

export type PredictionConfidence = 'high' | 'medium' | 'low';

export interface TastePrediction {
  score: number; // 1.0–10.0, one decimal
  confidence: PredictionConfidence;
  basis: string;
  /** Raters whose scores went into the prediction (friends + taste-matched others). */
  raters: number;
}

/**
 * Personalized 1.0–10.0 score prediction using Resnick's Z-Score Collaborative Filtering
 * (weighted by Pearson + Kendall palate similarity) blended with your personal Cuisine &
 * Category affinity prior.
 *
 * Privacy guard: raters you don't follow only count when they're positively correlated with
 * you, and only when at least `MIN_STRANGER_RATERS` of them are, so one person's score can never
 * be read back out of a prediction. They are never named in the basis text.
 *
 * `groupOf` maps a category to its group; cuisine tags only compare within a group.
 */
export function predictTaste(
  spot: TasteSpot,
  myEntries: readonly TasteEntry[],
  raters: readonly TasteRater[],
  groupOf: (category: string) => string | undefined = () => undefined
): TastePrediction | null {
  if (myEntries.length === 0) return null;

  const friends = raters.filter((r) => r.isFriend);
  const matchedStrangers = raters.filter((r) => !r.isFriend && isPositivelyCorrelated(r.similarity));
  const otherRaters =
    matchedStrangers.length >= MIN_STRANGER_RATERS ? [...friends, ...matchedStrangers] : friends;

  const myStats = computeRatingStats(myEntries);

  // 1. Personal Cuisine & Category Affinity Prior
  const spotCuisines = (spot.cuisines || []).map((c) => c.toLowerCase());
  const spotCategories = new Set<string>(spot.category ? [spot.category] : spot.categories || []);

  let cuisineDelta = 0;
  let matchedCuisineName: string | null = null;
  let matchedCuisineCount = 0;

  if (spotCuisines.length > 0) {
    // Tags only mean the same thing within a group (e.g. "History" museum vs. "History" city)
    const spotGroups = new Set([...spotCategories].map(groupOf));
    const sameCuisineSpots = myEntries.filter(
      (r) =>
        (spotGroups.size === 0 || spotGroups.has(groupOf(r.category))) &&
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

  let categoryDelta = 0;
  if (spotCategories.size > 0) {
    const sameCategorySpots = myEntries.filter((r) => spotCategories.has(r.category));
    if (sameCategorySpots.length >= 2) {
      const rawCategoryAvg =
        sameCategorySpots.reduce((acc, r) => acc + r.magicScore, 0) / sameCategorySpots.length;
      categoryDelta =
        ((rawCategoryAvg - myStats.mean) * sameCategorySpots.length) / (sameCategorySpots.length + 3);
    }
  }

  const personalAffinityPrior = Math.max(
    1.0,
    Math.min(10.0, myStats.mean + cuisineDelta + 0.35 * categoryDelta)
  );

  // 2. Collaborative Filtering across positively correlated raters (Resnick's Z-score projection)
  let weightedZSum = 0;
  let weightSum = 0;
  let tasteMatchedRatersCount = 0;
  let bestFriendMatch: { name: string; pct: number } | null = null;

  for (const rater of otherRaters) {
    const raterZ = Math.max(-2.6, Math.min(2.6, (rater.score - rater.stats.mean) / rater.stats.std));
    const sim = rater.similarity;

    // Only include positively correlated raters in the taste neighborhood
    if (sim.similarity <= 0) continue;

    if (sim.sharedCount > 0) {
      tasteMatchedRatersCount += 1;
      if (
        rater.isFriend &&
        rater.name &&
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

  if (otherRaters.length === 0 && matchedCuisineCount < 2) return null;

  let predictedRaw: number;
  if (weightSum > 0.02) {
    const predictedZ = weightedZSum / weightSum;
    const cfEstimate = myStats.mean + myStats.std * predictedZ;
    // Blend CF estimate with personal cuisine/category affinity prior based on total weight evidence
    const cfAlpha = weightSum / (weightSum + 0.35);
    predictedRaw = cfAlpha * cfEstimate + (1 - cfAlpha) * personalAffinityPrior;
  } else {
    predictedRaw = personalAffinityPrior;
  }

  const score = Math.max(1.0, Math.min(10.0, Math.round(predictedRaw * 10) / 10));

  const confidence: PredictionConfidence =
    tasteMatchedRatersCount >= 2 || (tasteMatchedRatersCount >= 1 && matchedCuisineCount >= 2)
      ? 'high'
      : otherRaters.length >= 1 || matchedCuisineCount >= 3
      ? 'medium'
      : 'low';

  const withCuisine = matchedCuisineName && matchedCuisineCount >= 2;
  let basis = 'Based on your rating distribution';
  if (bestFriendMatch) {
    basis = `Based on ${bestFriendMatch.name} (${bestFriendMatch.pct}% taste match)${
      withCuisine ? ` & your ${matchedCuisineName} ratings` : ''
    }`;
  } else if (tasteMatchedRatersCount > 0) {
    basis = `Based on ${tasteMatchedRatersCount} taste-matched jelly ${
      tasteMatchedRatersCount === 1 ? 'user' : 'users'
    }${withCuisine ? ` & your ${matchedCuisineName} ratings` : ''}`;
  } else if (otherRaters.length > 0 && withCuisine) {
    basis = `Based on jelly raters & your ${matchedCuisineName} history`;
  } else if (otherRaters.length > 0) {
    basis = `Calibrated from ${otherRaters.length} jelly ${
      otherRaters.length === 1 ? 'rater' : 'raters'
    } to your scale`;
  } else if (withCuisine) {
    basis = `Based on your ${matchedCuisineCount} ranked ${matchedCuisineName} spots`;
  }

  return { score, confidence, basis, raters: otherRaters.length };
}

const CONFIDENCE_RANK: Record<PredictionConfidence, number> = { low: 0, medium: 1, high: 2 };

/** True when `a` rests on more evidence than `b` (confidence first, then number of raters). */
export function isStrongerPrediction(
  a: Pick<TastePrediction, 'confidence' | 'raters'>,
  b: Pick<TastePrediction, 'confidence' | 'raters'> | null
): boolean {
  if (!b) return true;
  const diff = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
  return diff !== 0 ? diff > 0 : a.raters > b.raters;
}

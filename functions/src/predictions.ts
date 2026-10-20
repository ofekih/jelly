/**
 * Pure server-side taste predictions: from every user's ranked spots, the private
 * `users/{uid}/private/predictions` doc for one user. The math is the app's own
 * (`src/lib/tasteModel.ts`, shared), including its privacy guard: people the user doesn't follow
 * only count when at least 3 of them are positively correlated with the user, and are never named.
 */
import {
  computeRatingStats,
  computeTasteSimilarity,
  isPositivelyCorrelated,
  isStrongerPrediction,
  MIN_STRANGER_RATERS,
  predictTaste,
  type RatingStats,
  type TasteEntry,
  type TastePrediction,
  type TasteRater,
  type TasteSimilarityResult,
} from '../../src/lib/tasteModel';
import { CATEGORY_GROUP, type SpotCategory } from '../../src/types';
import { placeKeyOf, placeStatId } from './placeStats';

/** A ranked or bookmarked spot as stored at `users/{uid}/restaurants|bookmarks/{id}`. */
export interface SpotDoc {
  placeId?: string;
  name: string;
  city?: string;
  category: string;
  cuisines: string[];
}

export interface RankedDoc extends SpotDoc {
  magicScore: number;
}

export interface CorpusUser {
  uid: string;
  entries: RankedDoc[];
  /** Only loaded for users whose predictions are being computed. */
  bookmarks?: SpotDoc[];
  /** Who this user follows (`profiles/{uid}.followingIds`). */
  followingIds?: string[];
  /** Shown in the basis text of people who follow this user. */
  displayName?: string;
}

/** Everyone's ranked spots, indexed by `placeId__category` for quick rater lookups. */
export interface Corpus {
  users: Map<string, CorpusUser>;
  /** placeId__category → each rater's best score and the entry it came from */
  raters: Map<string, Map<string, RankedDoc>>;
}

/** Most predictions kept per user (the doc must stay well under Firestore's 1 MiB). */
export const MAX_PREDICTIONS = 2000;

const groupOf = (category: string) => CATEGORY_GROUP[category as SpotCategory];

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** A spot doc as the model needs it, or null when unusable. */
export function toSpotDoc(data: Record<string, unknown> | undefined): SpotDoc | null {
  if (!data) return null;
  const name = str(data.name);
  const category = str(data.category);
  if (!name || !category) return null;
  return {
    placeId: str(data.placeId),
    name,
    city: str(data.city),
    category,
    cuisines: Array.isArray(data.cuisines) ? data.cuisines.filter((c): c is string => typeof c === 'string') : [],
  };
}

export function toRankedDoc(data: Record<string, unknown> | undefined): RankedDoc | null {
  const spot = toSpotDoc(data);
  const score = data?.magicScore;
  if (!spot || typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10) return null;
  return { ...spot, magicScore: score };
}

export function buildCorpus(users: CorpusUser[]): Corpus {
  const corpus: Corpus = { users: new Map(), raters: new Map() };
  for (const user of users) {
    corpus.users.set(user.uid, user);
    for (const entry of user.entries) {
      const key = placeKeyOf(entry as unknown as Record<string, unknown>);
      if (!key) continue;
      const id = placeStatId(key);
      let byUser = corpus.raters.get(id);
      if (!byUser) corpus.raters.set(id, (byUser = new Map()));
      const prev = byUser.get(user.uid);
      if (!prev || entry.magicScore > prev.magicScore) byUser.set(user.uid, entry);
    }
  }
  return corpus;
}

/** Cuisine tags for a spot from everyone's entries, most common first. */
function mergedCuisines(entries: SpotDoc[]): string[] {
  const counts = new Map<string, number>();
  for (const e of entries) for (const c of new Set(e.cuisines)) counts.set(c, (counts.get(c) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}

/**
 * Predictions for `uid` keyed by `placeId__category`: spots others ranked that the user hasn't
 * (only when someone's score went into it), plus the user's bookmarks.
 */
export function computeUserPredictions(corpus: Corpus, uid: string): Record<string, TastePrediction> {
  const me = corpus.users.get(uid);
  const mine: TasteEntry[] = me?.entries ?? [];
  if (!me || mine.length === 0) return {};

  const myKeys = new Set(
    mine.map((e) => placeKeyOf(e as unknown as Record<string, unknown>)).filter(Boolean).map((k) => placeStatId(k!))
  );
  const following = new Set(me.followingIds ?? []);

  // How each other person's taste relates to mine, computed once and only when needed
  const relation = new Map<string, { stats: RatingStats; similarity: TasteSimilarityResult }>();
  const relationTo = (other: CorpusUser) => {
    let rel = relation.get(other.uid);
    if (!rel) {
      rel = { stats: computeRatingStats(other.entries), similarity: computeTasteSimilarity(mine, other.entries) };
      relation.set(other.uid, rel);
    }
    return rel;
  };

  const bookmarks = new Map<string, SpotDoc>();
  for (const b of me.bookmarks ?? []) {
    const key = placeKeyOf(b as unknown as Record<string, unknown>);
    if (key && !myKeys.has(placeStatId(key))) bookmarks.set(placeStatId(key), b);
  }

  const candidates = new Set<string>([...bookmarks.keys()]);
  for (const key of corpus.raters.keys()) if (!myKeys.has(key)) candidates.add(key);

  const results: Array<{ key: string; bookmarked: boolean; prediction: TastePrediction }> = [];
  for (const key of candidates) {
    const raters: TasteRater[] = [];
    let correlatedStrangers = 0;
    const rated = [...(corpus.raters.get(key) ?? new Map<string, RankedDoc>()).entries()]
      .filter(([raterUid]) => raterUid !== uid)
      .sort(([a], [b]) => a.localeCompare(b));
    for (const [raterUid, entry] of rated) {
      const other = corpus.users.get(raterUid)!;
      const isFriend = following.has(raterUid);
      const rel = relationTo(other);
      if (!isFriend && isPositivelyCorrelated(rel.similarity)) correlatedStrangers += 1;
      raters.push({
        name: isFriend ? other.displayName : undefined,
        isFriend,
        score: entry.magicScore,
        ...rel,
      });
    }

    const bookmark = bookmarks.get(key);
    const usable = raters.some((r) => r.isFriend) || correlatedStrangers >= MIN_STRANGER_RATERS;
    // Without anyone usable it would only be the user's own cuisine prior, which the app computes
    if (!usable && !bookmark) continue;

    const sources: SpotDoc[] = [...(bookmark ? [bookmark] : []), ...rated.map(([, e]) => e)];
    const first = sources[0];
    const prediction = predictTaste(
      { placeId: first.placeId, name: first.name, city: first.city, category: first.category, cuisines: mergedCuisines(sources) },
      mine,
      raters,
      groupOf
    );
    if (!prediction || (prediction.raters === 0 && !bookmark)) continue;
    results.push({ key, bookmarked: Boolean(bookmark), prediction });
  }

  // Bookmarks first, then the best-supported predictions
  results.sort((a, b) => {
    if (a.bookmarked !== b.bookmarked) return a.bookmarked ? -1 : 1;
    if (isStrongerPrediction(a.prediction, b.prediction)) return -1;
    if (isStrongerPrediction(b.prediction, a.prediction)) return 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return Object.fromEntries(results.slice(0, MAX_PREDICTIONS).map((r) => [r.key, r.prediction]));
}

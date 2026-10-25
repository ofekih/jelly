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
import { parsePriceRange } from '../../src/lib/price';
import { CATEGORY_GROUP, type MediaInfo, type PredictionPlace, type PriceRange, type SpotCategory } from '../../src/types';
import { placeKeyOf, placeStatId } from './placeStats';

/** A ranked or bookmarked spot as stored at `users/{uid}/restaurants|bookmarks/{id}`. */
export interface SpotDoc {
  placeId?: string;
  name: string;
  city?: string;
  neighborhood?: string;
  lat?: number;
  lng?: number;
  category: string;
  cuisines: string[];
  media?: MediaInfo;
  priceLevel?: number;
  priceRange?: PriceRange;
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

/** A prediction as stored, with what the "For you" list needs to show the spot. */
export type StoredPrediction = TastePrediction & { place: PredictionPlace };

/** Most predictions kept per user (the doc must stay well under Firestore's 1 MiB). */
export const MAX_PREDICTIONS = 1500;
/** Longest stored place name and most cuisine tags per spot, so one odd entry can't bloat the doc. */
const MAX_NAME_LENGTH = 80;
const MAX_PLACE_CUISINES = 3;

const groupOf = (category: string) => CATEGORY_GROUP[category as SpotCategory];

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const coord = (v: unknown, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max ? v : undefined;

/** A title's year, poster, creator and game details, trimmed so one odd entry can't bloat the doc. */
function mediaOf(v: unknown): MediaInfo | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const m = v as Record<string, unknown>;
  const media: MediaInfo = {};
  if (typeof m.year === 'number' && Number.isInteger(m.year)) media.year = m.year;
  const poster = str(m.poster);
  if (poster && poster.length <= 200) media.poster = poster;
  const creator = str(m.creator);
  if (creator) media.creator = creator.slice(0, MAX_NAME_LENGTH);
  for (const key of ['players', 'best', 'time'] as const) {
    const r = m[key];
    if (Array.isArray(r) && r.length === 2 && r.every((n) => Number.isInteger(n) && n > 0)) media[key] = [r[0], r[1]];
  }
  if (typeof m.weight === 'number' && m.weight > 0 && m.weight <= 5) media.weight = m.weight;
  return Object.keys(media).length > 0 ? media : undefined;
}

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
    neighborhood: str(data.neighborhood),
    lat: coord(data.lat, 90),
    lng: coord(data.lng, 180),
    category,
    cuisines: Array.isArray(data.cuisines) ? data.cuisines.filter((c): c is string => typeof c === 'string') : [],
    media: mediaOf(data.media),
    priceLevel:
      typeof data.priceLevel === 'number' && Number.isInteger(data.priceLevel) && data.priceLevel >= 0 && data.priceLevel <= 4
        ? data.priceLevel
        : undefined,
    priceRange: parsePriceRange(data.priceRange),
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

/** The value most of `values` agree on (first seen wins ties), ignoring blanks. */
function mostCommon<T>(values: Array<T | undefined>): T | undefined {
  const counts = new Map<T, number>();
  let best: T | undefined;
  for (const v of values) {
    if (v === undefined) continue;
    const n = (counts.get(v) || 0) + 1;
    counts.set(v, n);
    if (best === undefined || n > counts.get(best)!) best = v;
  }
  return best;
}

/**
 * How to show a spot in "For you", from the user's bookmark and everyone's entries for it. Only
 * place facts (name, area, location, tags), never anyone's notes; no undefined values (Firestore
 * rejects them).
 */
export function predictionPlace(sources: SpotDoc[], cuisines: string[]): PredictionPlace {
  const name = mostCommon(sources.map((s) => s.name))!.slice(0, MAX_NAME_LENGTH);
  const city = mostCommon(sources.map((s) => s.city));
  const located = sources.find((s) => s.lat !== undefined && s.lng !== undefined);
  const neighborhood = mostCommon(sources.map((s) => s.neighborhood));
  const place: PredictionPlace = { name };
  if (city) place.city = city.slice(0, MAX_NAME_LENGTH);
  if (neighborhood) place.neighborhood = neighborhood.slice(0, MAX_NAME_LENGTH);
  if (located) {
    // ~1 m is plenty for a pin, and keeps the doc small
    place.lat = Math.round(located.lat! * 1e5) / 1e5;
    place.lng = Math.round(located.lng! * 1e5) / 1e5;
  }
  const tags = cuisines.slice(0, MAX_PLACE_CUISINES).map((c) => c.slice(0, MAX_NAME_LENGTH));
  if (tags.length > 0) place.cuisines = tags;
  const media = sources.find((s) => s.media)?.media;
  if (media) place.media = media;
  // The most common tier, and a range only from an entry with that same tier (see mergePrice)
  const priceLevel = mostCommon(sources.map((s) => s.priceLevel));
  if (priceLevel !== undefined) {
    place.priceLevel = priceLevel;
    const priceRange = sources.find((s) => s.priceLevel === priceLevel && s.priceRange)?.priceRange;
    if (priceRange) place.priceRange = priceRange;
  }
  return place;
}

/**
 * Predictions for `uid` keyed by `placeId__category`: spots others ranked that the user hasn't
 * (only when someone's score went into it), plus the user's bookmarks.
 */
export function computeUserPredictions(corpus: Corpus, uid: string): Record<string, StoredPrediction> {
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

  const results: Array<{ key: string; bookmarked: boolean; prediction: TastePrediction; place: PredictionPlace }> = [];
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
    const cuisines = mergedCuisines(sources);
    const prediction = predictTaste(
      { placeId: first.placeId, name: first.name, city: first.city, category: first.category, cuisines },
      mine,
      raters,
      groupOf
    );
    if (!prediction || (prediction.raters === 0 && !bookmark)) continue;
    results.push({ key, bookmarked: Boolean(bookmark), prediction, place: predictionPlace(sources, cuisines) });
  }

  // Bookmarks first, then the best-supported predictions
  results.sort((a, b) => {
    if (a.bookmarked !== b.bookmarked) return a.bookmarked ? -1 : 1;
    if (isStrongerPrediction(a.prediction, b.prediction)) return -1;
    if (isStrongerPrediction(b.prediction, a.prediction)) return 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return Object.fromEntries(
    results.slice(0, MAX_PREDICTIONS).map((r) => [r.key, { ...r.prediction, place: r.place }])
  );
}

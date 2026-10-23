import {
  ALL_CATEGORIES,
  BookmarkEntry,
  DEFAULT_CATEGORY,
  isSpotCategory,
  RestaurantEntry,
  SpotCategory,
} from '../types';
import { recomputeMagicScores } from './rankingEngine';

/**
 * Each category is a completely separate ranked list. All entries live in one flat array,
 * but `rankIndex` / `magicScore` are computed independently per category.
 */

export function buildEntryId(placeIdOrBase: string, category: SpotCategory): string {
  return `${placeIdOrBase}__${category}`;
}

/** Entries of a single category list, ordered by rank (#1 first). */
export function getCategoryList<T extends { category: SpotCategory; rankIndex: number }>(
  all: T[],
  category: SpotCategory
): T[] {
  return all.filter((r) => r.category === category).sort((a, b) => a.rankIndex - b.rankIndex);
}

/**
 * Recomputes rank indices + magic scores independently for every category list.
 * Within a category, the ARRAY order of `all` is treated as the rank order (callers pass a
 * freshly reordered list; stale `rankIndex` values are ignored).
 * Returns a flat array grouped by category (in `ALL_CATEGORIES` order), each group rank-ordered.
 */
export function recomputeAllCategoryScores(all: RestaurantEntry[]): RestaurantEntry[] {
  const result: RestaurantEntry[] = [];
  for (const category of ALL_CATEGORIES) {
    const list = all.filter((r) => r.category === category);
    if (list.length > 0) result.push(...recomputeMagicScores(list));
  }
  return result;
}

/**
 * Replaces one category's list with a new ordered list (recomputing its scores),
 * leaving every other category untouched.
 */
export function replaceCategoryList(
  all: RestaurantEntry[],
  category: SpotCategory,
  orderedCategoryList: RestaurantEntry[]
): RestaurantEntry[] {
  const others = all.filter((r) => r.category !== category);
  return [...others, ...recomputeMagicScores(orderedCategoryList)];
}

// ---------------------------------------------------------------------------
// One-time migration from the legacy Google-style meal occasions
// (Breakfast / Lunch / Dinner / Coffee / Dessert / Drinks).
// ---------------------------------------------------------------------------

const BAKERY_HINT = /\b(bak(ery|eries|ehouse)|bagels?|donuts?|doughnuts?|pastry|pastries|patisserie|pâtisserie|boulangerie|croissants?)\b/i;

function looksLikeBakery(raw: any): boolean {
  const cuisines: string[] = Array.isArray(raw?.cuisines) ? raw.cuisines : [];
  if (cuisines.some((c) => typeof c === 'string' && /^(bakery|bagels)$/i.test(c.trim()))) {
    return true;
  }
  return BAKERY_HINT.test(`${raw?.name || ''} ${raw?.primaryTypeDisplay || ''}`);
}

export function legacyMealToCategory(meal: unknown, raw: any): SpotCategory {
  const lower = typeof meal === 'string' ? meal.toLowerCase() : '';
  if (lower.includes('breakfast') || lower.includes('brunch')) {
    return looksLikeBakery(raw) ? 'bakeries' : 'brunch';
  }
  if (lower.includes('coffee') || lower.includes('cafe') || lower.includes('tea')) return 'coffee_tea';
  if (lower.includes('dessert')) return 'dessert';
  if (lower.includes('drink') || lower.includes('bar') || lower.includes('wine')) return 'bars';
  // Dinner, Lunch & anything unknown
  return DEFAULT_CATEGORY;
}

function resolveCategory(raw: any): SpotCategory {
  if (isSpotCategory(raw?.category)) return raw.category;
  return legacyMealToCategory(raw?.meal ?? raw?.meals?.[0], raw);
}

function resolveCategories(raw: any, category: SpotCategory): SpotCategory[] {
  const list: SpotCategory[] = [category];
  if (Array.isArray(raw?.categories)) {
    for (const c of raw.categories) if (isSpotCategory(c) && !list.includes(c)) list.push(c);
  } else if (Array.isArray(raw?.meals)) {
    for (const m of raw.meals) {
      const c = legacyMealToCategory(m, raw);
      if (!list.includes(c)) list.push(c);
    }
  }
  return list;
}

/**
 * True if a stored doc has a category this version doesn't know (written by a newer version of
 * jelly). Such docs are left untouched: never migrated, re-keyed or rewritten.
 */
export function isFromNewerVersion(raw: any): boolean {
  return (
    typeof raw?.category === 'string' &&
    raw.category.length > 0 &&
    !isSpotCategory(raw.category) &&
    !('meal' in raw) &&
    !('meals' in raw)
  );
}

/** True if a stored doc still uses the legacy meal fields. */
export function isLegacyDoc(raw: any): boolean {
  if (isFromNewerVersion(raw)) return false;
  return !isSpotCategory(raw?.category) || 'meal' in (raw || {}) || 'meals' in (raw || {});
}

function stripLegacyFields<T extends Record<string, any>>(obj: T): T {
  const { meal: _meal, meals: _meals, ...rest } = obj as any;
  return rest as T;
}

function sanitizeLoadedRestaurant(raw: any): RestaurantEntry {
  const category = resolveCategory(raw);
  const initialRating = typeof raw.initialRating === 'number' ? raw.initialRating : 8;
  const legacy = isLegacyDoc(raw);
  // Elo no longer exists; older docs still carry it until they're next saved
  const { elo: _elo, ...base } = legacy ? stripLegacyFields(raw) : raw;
  const idBase =
    base.placeId || (typeof base.id === 'string' ? base.id.split('__')[0] : '') || `spot_${Date.now()}`;

  return {
    ...base,
    // Legacy IDs were keyed by meal; re-key them by category
    id: legacy ? buildEntryId(idBase, category) : base.id,
    category,
    categories: resolveCategories(raw, category),
    cuisines: Array.isArray(raw.cuisines) ? raw.cuisines : [],
    initialRating,
    rankIndex: typeof raw.rankIndex === 'number' ? raw.rankIndex : Number.MAX_SAFE_INTEGER,
    comparisons: Array.isArray(raw.comparisons)
      ? raw.comparisons.filter(
          (c: any) => c && typeof c.opponentId === 'string' && [0, 0.5, 1].includes(c.result) && typeof c.at === 'number'
        )
      : undefined,
  };
}

/** A copy safe to publish in a shared list: answer history stays private (and keeps the doc small) */
export function toSharedEntry(entry: RestaurantEntry): RestaurantEntry {
  const { comparisons: _private, ...shared } = entry;
  return shared;
}

export function sanitizeLoadedBookmark(raw: any): BookmarkEntry {
  const category = resolveCategory(raw);
  const base = isLegacyDoc(raw) ? stripLegacyFields(raw) : raw;
  return {
    ...base,
    category,
    categories: resolveCategories(raw, category),
    cuisines: Array.isArray(raw.cuisines) ? raw.cuisines : [],
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

/**
 * Sanitizes raw restaurant docs (legacy or current) into per-category ranked lists.
 * Legacy entries keep their relative order within each new category list (they were
 * ranked globally before). If two legacy entries collapse into the same place + category
 * (e.g. the same spot ranked for both Lunch and Dinner), the higher-ranked one wins.
 */
export function loadRestaurants(raws: any[]): RestaurantEntry[] {
  const sanitized = raws
    .filter((raw) => !isFromNewerVersion(raw))
    .map(sanitizeLoadedRestaurant).sort((a, b) => a.rankIndex - b.rankIndex);
  const seen = new Set<string>();
  const deduped: RestaurantEntry[] = [];
  for (const entry of sanitized) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    deduped.push(entry);
  }
  return recomputeAllCategoryScores(deduped);
}

/** Sanitizes raw bookmark docs, skipping any written by a newer version of jelly. */
export function loadBookmarks(raws: any[]): BookmarkEntry[] {
  return raws.filter((raw) => !isFromNewerVersion(raw)).map(sanitizeLoadedBookmark);
}

/** Fields `recomputeAllCategoryScores` derives from the order and gut ratings. */
export type DerivedScoreFields = Pick<RestaurantEntry, 'magicScore' | 'rankIndex'>;

/**
 * Loaded entries whose recomputed scores differ from the stored doc (e.g. after the scoring
 * model changed), with just the fields to write back. Keyed by doc ID.
 */
export function staleDerivedScores(
  storedById: Map<string, any>,
  loaded: RestaurantEntry[]
): Array<{ id: string; fields: DerivedScoreFields }> {
  const stale: Array<{ id: string; fields: DerivedScoreFields }> = [];
  for (const entry of loaded) {
    const stored = storedById.get(entry.id);
    if (!stored) continue;
    if (stored.magicScore !== entry.magicScore || stored.rankIndex !== entry.rankIndex) {
      stale.push({ id: entry.id, fields: { magicScore: entry.magicScore, rankIndex: entry.rankIndex } });
    }
  }
  return stale;
}

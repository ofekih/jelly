import {
  ALL_CATEGORIES,
  BookmarkEntry,
  DEFAULT_CATEGORY,
  isSpotCategory,
  RestaurantEntry,
  SpotCategory,
} from '../types';
import { ratingToBaseElo, recomputeMagicScores } from './rankingEngine';

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

/** True if a stored doc still uses the legacy meal fields. */
export function isLegacyDoc(raw: any): boolean {
  return !isSpotCategory(raw?.category) || 'meal' in (raw || {}) || 'meals' in (raw || {});
}

function stripLegacyFields<T extends Record<string, any>>(obj: T): T {
  const { meal: _meal, meals: _meals, ...rest } = obj as any;
  return rest as T;
}

export function sanitizeLoadedRestaurant(raw: any): RestaurantEntry {
  const category = resolveCategory(raw);
  const initialRating = typeof raw.initialRating === 'number' ? raw.initialRating : 8;
  const elo =
    typeof raw.elo === 'number' && !Number.isNaN(raw.elo) ? raw.elo : ratingToBaseElo(initialRating);
  const legacy = isLegacyDoc(raw);
  const base = legacy ? stripLegacyFields(raw) : raw;
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
    elo,
    rankIndex: typeof raw.rankIndex === 'number' ? raw.rankIndex : Number.MAX_SAFE_INTEGER,
  };
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
  const sanitized = raws.map(sanitizeLoadedRestaurant).sort((a, b) => a.rankIndex - b.rankIndex);
  const seen = new Set<string>();
  const deduped: RestaurantEntry[] = [];
  for (const entry of sanitized) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    deduped.push(entry);
  }
  return recomputeAllCategoryScores(deduped);
}

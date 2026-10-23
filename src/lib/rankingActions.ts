import { PlaceCandidate, RestaurantEntry, SpotCategory, StoredComparison } from '../types';
import { buildEntryId, getCategoryList, replaceCategoryList } from './categoryLists';
import { appendComparisons, dragComparisons, moveSpot } from './comparisonHistory';

/**
 * The list edits behind ranking, re-ranking, dragging and deleting, as pure functions over the
 * whole list (every category). Each returns the next list; App persists it.
 */

/** A spot that has its gut rating and list, waiting for its place in that list. */
export interface PendingPlacement {
  candidate: PlaceCandidate;
  initialRating: number;
  category: SpotCategory; // The candidate is only ever compared within this list
  cuisines: string[];
  existingIdToReplace?: string;
}

export interface PlacementResult {
  /** How the side-by-side ended: index in the category list without the candidate */
  insertIndex: number;
  comparisonsDone: number;
  answers: Array<{ opponentId: string; result: 0 | 0.5 | 1 }>;
}

export interface PlacedSpot {
  restaurants: RestaurantEntry[];
  entry: RestaurantEntry;
  /** 1-based rank in its list */
  position: number;
  /** The entry this one replaces under another ID (re-ranked into a different list), to delete */
  removedId?: string;
}

/** The entry a placement replaces, if it is actually ranked (a bookmark being ranked is not). */
export function existingEntryFor(
  restaurants: RestaurantEntry[],
  placement: Pick<PendingPlacement, 'existingIdToReplace'>
): RestaurantEntry | undefined {
  return placement.existingIdToReplace
    ? restaurants.find((r) => r.id === placement.existingIdToReplace)
    : undefined;
}

/** The other spots in the list a placement is compared against. */
export function placementPool(restaurants: RestaurantEntry[], placement: PendingPlacement): RestaurantEntry[] {
  const entryId = buildEntryId(placement.candidate.placeId, placement.category);
  return getCategoryList(restaurants, placement.category).filter(
    (r) => r.id !== placement.existingIdToReplace && r.id !== entryId
  );
}

/**
 * Puts a rated spot into its list at the position side-by-side found (or at #1 when the list has
 * nothing to compare against). A re-rank keeps the spot's notes, tags, price and history and
 * starts its answers fresh. Scores are recomputed for the whole list.
 */
export function placeSpot(
  restaurants: RestaurantEntry[],
  placement: PendingPlacement,
  result: PlacementResult,
  now: number
): PlacedSpot {
  const existing = existingEntryFor(restaurants, placement);
  const { candidate, category, initialRating } = placement;
  const entryId = buildEntryId(candidate.placeId, category);
  const prevHistory = existing?.rankedHistory?.length
    ? existing.rankedHistory
    : existing
    ? [{ timestamp: existing.createdAt, initialRating: existing.initialRating }]
    : [];

  const pool = placementPool(restaurants, placement);

  const entry: RestaurantEntry = {
    id: entryId,
    placeId: candidate.placeId,
    name: candidate.name,
    formattedAddress: candidate.formattedAddress,
    neighborhood: candidate.neighborhood,
    city: candidate.city,
    lat: candidate.lat,
    lng: candidate.lng,
    googleMapsUri: candidate.googleMapsUri,
    priceLevel: existing?.priceLevel ?? candidate.priceLevel,
    category,
    categories: Array.from(new Set([category, ...(candidate.categories || [])])),
    cuisines: existing?.cuisines?.length ? existing.cuisines : placement.cuisines,
    primaryTypeDisplay: candidate.primaryTypeDisplay,
    media: candidate.media ?? existing?.media,
    initialRating,
    rankIndex: result.insertIndex,
    magicScore: initialRating,
    comparisonsCount: (existing?.comparisonsCount || 0) + result.comparisonsDone,
    notes: existing?.notes,
    favoriteDishes: existing?.favoriteDishes,
    rankedHistory: [...prevHistory, { timestamp: now, initialRating }],
    // A (re-)rank starts its answer history fresh: older answers about it no longer count
    comparisons: result.answers.map((a): StoredComparison => ({ ...a, at: now })),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const index = Math.max(0, Math.min(pool.length, result.insertIndex));
  const list = [...pool];
  list.splice(index, 0, entry);
  // The old entry may have lived in another list (re-ranked into a new category)
  const withoutOld = restaurants.filter((r) => r.id !== placement.existingIdToReplace);
  const next = replaceCategoryList(withoutOld, category, list);
  return {
    restaurants: next,
    entry: next.find((r) => r.id === entryId) ?? entry,
    position: index + 1,
    removedId: existing && existing.id !== entryId ? existing.id : undefined,
  };
}

/** The result for a list with nothing to compare against: straight to #1. */
export const FIRST_IN_LIST: PlacementResult = { insertIndex: 0, comparisonsDone: 0, answers: [] };

/**
 * Drags `activeId` to where `overId` is, within its own list only. The moved spot remembers the
 * drag as answers, so earlier answers it overrides never get flagged as conflicts. Null when
 * nothing moves.
 */
export function reorderSpot(
  restaurants: RestaurantEntry[],
  activeId: string,
  overId: string,
  now: number
): { restaurants: RestaurantEntry[]; entry: RestaurantEntry; from: number; to: number } | null {
  const active = restaurants.find((r) => r.id === activeId);
  if (!active) return null;
  const list = getCategoryList(restaurants, active.category);
  const from = list.findIndex((r) => r.id === activeId);
  const to = list.findIndex((r) => r.id === overId);
  if (from === -1 || to === -1 || from === to) return null;

  const moved = moveSpot(list, from, to);
  moved[to] = appendComparisons(moved[to], dragComparisons(list, from, to, now));
  return { restaurants: replaceCategoryList(restaurants, active.category, moved), entry: moved[to], from, to };
}

/** Undoes a delete: puts `entry` back at its old rank in the current list (keeping later edits). */
export function restoreSpot(restaurants: RestaurantEntry[], entry: RestaurantEntry): RestaurantEntry[] {
  const others = restaurants.filter((r) => r.id !== entry.id);
  const list = getCategoryList(others, entry.category);
  list.splice(Math.min(entry.rankIndex, list.length), 0, entry);
  return replaceCategoryList(others, entry.category, list);
}

import { PlaceCandidate, RestaurantEntry, SpotCategory, StoredComparison } from '../types';
import { buildEntryId, getCategoryList, replaceCategoryList } from './categoryLists';
import { appendComparisons, dragComparisons, moveSpot } from './comparisonHistory';
import { mergePrice } from './price';

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
    ...mergePrice(existing, candidate),
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

/** What a drag changed, enough to take it back (see `undoReorder`). */
export interface ReorderUndo {
  /** The dragged spot as it was before the drag, and right after it */
  before: RestaurantEntry;
  after: RestaurantEntry;
  /** Its neighbours before the drag (IDs), to find its old place even if the list changed since */
  aboveId?: string;
  belowId?: string;
  /** Its old index in the list */
  from: number;
}

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
): { restaurants: RestaurantEntry[]; entry: RestaurantEntry; from: number; to: number; undo: ReorderUndo } | null {
  const active = restaurants.find((r) => r.id === activeId);
  if (!active) return null;
  const list = getCategoryList(restaurants, active.category);
  const from = list.findIndex((r) => r.id === activeId);
  const to = list.findIndex((r) => r.id === overId);
  if (from === -1 || to === -1 || from === to) return null;

  const moved = moveSpot(list, from, to);
  moved[to] = appendComparisons(moved[to], dragComparisons(list, from, to, now));
  const undo: ReorderUndo = {
    before: list[from],
    after: moved[to],
    aboveId: list[from - 1]?.id,
    belowId: list[from + 1]?.id,
    from,
  };
  return { restaurants: replaceCategoryList(restaurants, active.category, moved), entry: moved[to], from, to, undo };
}

const comparisonKey = (c: StoredComparison) => `${c.opponentId}|${c.result}|${c.at}`;
const sameComparisons = (a?: StoredComparison[], b?: StoredComparison[]) =>
  (a ?? []).map(comparisonKey).join() === (b ?? []).map(comparisonKey).join();

/** The dragged spot's answers without what the drag added (and with any it pushed out back). */
function comparisonsBeforeDrag(current: RestaurantEntry, undo: ReorderUndo): StoredComparison[] | undefined {
  const { before, after } = undo;
  // Untouched since the drag: exactly what it had
  if (sameComparisons(current.comparisons, after.comparisons)) return before.comparisons;
  const hadBefore = new Set((before.comparisons ?? []).map(comparisonKey));
  const added = new Set((after.comparisons ?? []).map(comparisonKey).filter((k) => !hadBefore.has(k)));
  const hasAfter = new Set((after.comparisons ?? []).map(comparisonKey));
  const kept = (current.comparisons ?? []).filter((c) => !added.has(comparisonKey(c)));
  const replaced = (before.comparisons ?? []).filter(
    (b) => !hasAfter.has(comparisonKey(b)) && !kept.some((c) => c.opponentId === b.opponentId)
  );
  return [...kept, ...replaced].sort((x, y) => x.at - y.at);
}

/**
 * Undoes a drag: puts the spot back between its old neighbours and drops the answers the drag
 * recorded. Right after the drag this restores the list exactly (ranks and scores are refitted
 * from the same order); if the list changed in between, everything else stays as it is now and
 * the spot goes back next to whichever old neighbour is still there. Null when the spot is no
 * longer in that list (deleted or moved to another list), so there is nothing to undo.
 */
export function undoReorder(restaurants: RestaurantEntry[], undo: ReorderUndo): RestaurantEntry[] | null {
  const { category, id } = undo.before;
  const list = getCategoryList(restaurants, category);
  const current = list.find((r) => r.id === id);
  if (!current) return null;

  const others = list.filter((r) => r.id !== id);
  const aboveIndex = undo.aboveId ? others.findIndex((r) => r.id === undo.aboveId) : -1;
  const belowIndex = undo.belowId ? others.findIndex((r) => r.id === undo.belowId) : -1;
  const index =
    aboveIndex !== -1
      ? aboveIndex + 1
      : belowIndex !== -1
      ? belowIndex
      : undo.aboveId
      ? Math.min(undo.from, others.length)
      : 0; // It was #1

  const restored: RestaurantEntry = { ...current, comparisons: comparisonsBeforeDrag(current, undo) };
  if (restored.comparisons === undefined) delete restored.comparisons;
  others.splice(index, 0, restored);
  return replaceCategoryList(restaurants, category, others);
}

/** Undoes a delete: puts `entry` back at its old rank in the current list (keeping later edits). */
export function restoreSpot(restaurants: RestaurantEntry[], entry: RestaurantEntry): RestaurantEntry[] {
  const others = restaurants.filter((r) => r.id !== entry.id);
  const list = getCategoryList(others, entry.category);
  list.splice(Math.min(entry.rankIndex, list.length), 0, entry);
  return replaceCategoryList(others, entry.category, list);
}

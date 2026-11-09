import type { BookmarkEntry, PlaceCandidate, RestaurantEntry, SpotCategory, StoredComparison } from '../../types';
import { buildEntryId, getCategoryList, recomputeAllCategoryScores, replaceCategoryList } from '../categoryLists';
import { createManualPlaceCandidate } from '../placesService';
import { estimateScores } from './scores';
import type {
  BeliBookmarkRow,
  BeliExport,
  BeliRankedRow,
  ImportPlan,
  ImportSummary,
  MatchDecision,
  MatchResult,
  ScoredList,
} from './types';

/**
 * Turns a parsed, matched and scored export into the next lists, as pure functions in the style
 * of `rankingActions.ts`: App (or `sync/importWrite`) only persists the result.
 */

export function createImportBatchId(now = Date.now(), random = Math.random): string {
  return `beli-${now.toString(36)}-${Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0')}`;
}

/** A custom spot's ID for a Beli place: stable for the same export; `manual_` keeps it out of community stats */
function manualPlaceId(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return `manual_beli_${(h >>> 0).toString(36)}`;
}

/** The Google place (or custom spot) a Beli place resolves to, or null when it is left out. */
export function resolvePlace(
  row: Pick<BeliRankedRow, 'key' | 'name' | 'city'>,
  match: MatchResult | undefined,
  decision: MatchDecision | undefined
): PlaceCandidate | null {
  if (decision?.kind === 'skip') return null;
  if (decision?.kind === 'place') return decision.candidate;
  if (decision?.kind === 'manual') return { ...createManualPlaceCandidate(row.name, row.city, 'eat'), placeId: manualPlaceId(row.key) };
  return match?.status === 'matched' && match.best ? match.best : null;
}

/**
 * Spots of a Beli list that are already in that jelly list (same Google place): row key → entry
 * ID. Pass to `startJellyMerge`, which then treats each as one spot known to both lists.
 */
export function sharedSpots(
  rows: BeliRankedRow[],
  category: SpotCategory,
  restaurants: RestaurantEntry[],
  matches: Record<string, MatchResult>,
  decisions: Record<string, MatchDecision> = {}
): Record<string, string> {
  const ids = new Set(getCategoryList(restaurants, category).map((r) => r.id));
  const out: Record<string, string> = {};
  for (const row of rows) {
    const place = resolvePlace(row, matches[row.key], decisions[row.key]);
    const id = place ? buildEntryId(place.placeId, category) : undefined;
    if (id && ids.has(id)) out[row.key] = id;
  }
  return out;
}

/** Estimated scores for the jelly merge: Beli rows from their gut ratings and order, jelly spots their scores. */
export function jellyMergeEstimates(
  beliOrder: string[],
  guts: Record<string, number | undefined>,
  jellyList: RestaurantEntry[]
): Record<string, number> {
  return { ...estimateScores(beliOrder, guts), ...Object.fromEntries(jellyList.map((r) => [r.id, r.magicScore])) };
}

/** The merge answers about one imported spot, against spots that made it into the list (by entry ID) */
function comparisonsFor(key: string, list: ScoredList, idOf: Map<string, string>): StoredComparison[] {
  const out: StoredComparison[] = [];
  for (const a of list.answers) {
    if (a.candidate === key && idOf.has(a.other)) out.push({ opponentId: idOf.get(a.other)!, result: a.result, at: a.at });
    else if (a.other === key && idOf.has(a.candidate)) out.push({ opponentId: idOf.get(a.candidate)!, result: (1 - a.result) as 0 | 0.5 | 1, at: a.at });
  }
  return out;
}

function entryFor(
  row: BeliRankedRow,
  place: PlaceCandidate,
  gut: number | undefined,
  estimate: number,
  comparisons: StoredComparison[],
  batch: string,
  now: number
): RestaurantEntry {
  const createdAt = row.createdAt ?? now;
  return {
    id: buildEntryId(place.placeId, row.category),
    placeId: place.placeId,
    name: place.name,
    formattedAddress: place.formattedAddress,
    neighborhood: place.neighborhood,
    city: place.city,
    lat: place.lat,
    lng: place.lng,
    googleMapsUri: place.googleMapsUri,
    // No price: the import skips Enterprise fields; usePriceBackfill fills it when the sheet opens
    category: row.category,
    categories: Array.from(new Set([row.category, ...(place.categories || [])])),
    cuisines: place.cuisines || [],
    primaryTypeDisplay: place.primaryTypeDisplay,
    initialRating: gut, // Absent when the user didn't rate it: the fit never guesses one
    rankIndex: 0,
    magicScore: estimate, // Replaced by the fit
    comparisonsCount: comparisons.length,
    notes: row.notes,
    favoriteDishes: row.favoriteDishes,
    privateNotes: row.privateNotes,
    rankedHistory: [gut === undefined ? { timestamp: createdAt } : { timestamp: createdAt, initialRating: gut }],
    comparisons: comparisons.length ? comparisons : undefined,
    imported: { source: 'beli', batch, key: row.key },
    createdAt,
    updatedAt: now,
  };
}

function bookmarkFor(row: BeliBookmarkRow, place: PlaceCandidate, batch: string, now: number): BookmarkEntry {
  const notes = [row.notes, row.favoriteDishes ? `Favorite dishes: ${row.favoriteDishes}` : undefined].filter(Boolean).join('\n\n');
  return {
    id: place.placeId,
    placeId: place.placeId,
    name: place.name,
    formattedAddress: place.formattedAddress,
    neighborhood: place.neighborhood,
    city: place.city,
    lat: place.lat,
    lng: place.lng,
    googleMapsUri: place.googleMapsUri,
    category: row.category,
    categories: Array.from(new Set([row.category, ...(place.categories || [])])),
    cuisines: place.cuisines || [],
    primaryTypeDisplay: place.primaryTypeDisplay,
    notes: notes ? notes.slice(0, 5000) : undefined,
    privateNotes: row.privateNotes,
    imported: { source: 'beli', batch, key: row.key },
    createdAt: row.createdAt ?? now,
    updatedAt: now,
  };
}

/**
 * Weaves imported spots (best first) into an existing list (best first) by score, as a merge of
 * two sorted sequences, so both orders survive. Ties keep the existing spot first. Only a fallback
 * for when the user skipped the jelly merge's questions.
 */
export function weaveByScore(existing: RestaurantEntry[], imported: RestaurantEntry[]): RestaurantEntry[] {
  const out: RestaurantEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < existing.length || j < imported.length) {
    if (j >= imported.length || (i < existing.length && existing[i].magicScore >= imported[j].magicScore)) out.push(existing[i++]);
    else out.push(imported[j++]);
  }
  return out;
}

/** Indices of a longest strictly increasing subsequence of `values` (patience sorting). */
export function longestIncreasing(values: number[]): number[] {
  const tails: number[] = []; // index of the smallest tail of each length
  const prev = new Array<number>(values.length).fill(-1);
  values.forEach((v, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]] < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  });
  const out: number[] = [];
  for (let i = tails.length ? tails[tails.length - 1] : -1; i !== -1; i = prev[i]) out.push(i);
  return out.reverse();
}

/** One Beli row in list order: a spot already in the jelly list (by entry ID) or a new entry */
export type BeliSlot = { existingId: string } | { entry: RestaurantEntry };

/**
 * Puts the new spots into the existing list. Spots in both lists pin the two orders together:
 * the longest run of them that both orders agree on become fixed points (a shared spot the two
 * orders disagree about stays where jelly has it and pins nothing), and each new spot can only
 * land between the fixed points around it in Beli's order. Between two fixed points, new and
 * existing spots are woven by score. Without shared spots this is `weaveByScore`. A fallback: normally the
 * jelly merge's questions settle the order exactly.
 */
export function mergeIntoList(existing: RestaurantEntry[], slots: BeliSlot[]): { list: RestaurantEntry[]; fixed: string[]; conflicting: string[] } {
  const jellyPos = new Map(existing.map((r, i) => [r.id, i]));
  const shared = slots.flatMap((s, beliPos) => ('existingId' in s && jellyPos.has(s.existingId) ? [{ id: s.existingId, beliPos }] : []));
  const keep = new Set(longestIncreasing(shared.map((s) => jellyPos.get(s.id)!)).map((i) => shared[i].id));
  const fixed = shared.filter((s) => keep.has(s.id));

  const segmentsNew: RestaurantEntry[][] = Array.from({ length: fixed.length + 1 }, () => []);
  let seg = 0;
  slots.forEach((s, beliPos) => {
    if ('entry' in s) segmentsNew[seg].push(s.entry);
    else if (seg < fixed.length && fixed[seg].beliPos === beliPos) seg++;
  });
  const list: RestaurantEntry[] = [];
  let from = 0;
  fixed.forEach((f, k) => {
    const at = jellyPos.get(f.id)!;
    list.push(...weaveByScore(existing.slice(from, at), segmentsNew[k]), existing[at]);
    from = at + 1;
  });
  list.push(...weaveByScore(existing.slice(from), segmentsNew[fixed.length]));
  return { list, fixed: fixed.map((f) => f.id), conflicting: shared.filter((s) => !keep.has(s.id)).map((s) => s.id) };
}

export interface BuildImportInput {
  exp: BeliExport;
  /** One per Beli list to import (lists left out are not imported) */
  lists: ScoredList[];
  matches: Record<string, MatchResult>;
  /** The user's choices for places that were not auto-matched (and any overrides) */
  decisions?: Record<string, MatchDecision>;
  restaurants: RestaurantEntry[];
  bookmarks: BookmarkEntry[];
  includeBookmarks?: boolean; // Default true
  batch: string;
  now?: number;
}

/**
 * The lists after the import. Each list takes the order from the merges (`ScoredList.order`): a
 * place already in that jelly list keeps its jelly entry (reported as a duplicate); existing spots
 * the order leaves out (jelly merge skipped) are woven in by `mergeIntoList`. Rated spots get their
 * gut rating; unrated ones none. Bookmarks already saved, or ranked in that list, are skipped.
 * Scores are recomputed for every list touched.
 */
export function buildImportPlan(input: BuildImportInput): ImportPlan {
  const { exp, matches, batch, includeBookmarks = true } = input;
  const decisions = input.decisions ?? {};
  const now = input.now ?? Date.now();
  const summary: ImportSummary = { added: {}, addedBookmarks: 0, duplicates: [], orderConflicts: [], unrated: 0, skippedBookmarks: 0, skipped: 0, manual: 0 };
  let restaurants = input.restaurants;

  for (const list of input.lists) {
    const { category } = list;
    const rows = new Map((exp.lists[category] ?? []).map((r) => [r.key, r]));
    const current = getCategoryList(restaurants, category);
    const currentById = new Map(current.map((r) => [r.id, r]));
    // Resolve every row first, so comparisons can point at any spot that made it in
    const idOf = new Map<string, string>(current.map((r) => [r.id, r.id]));
    const added = new Map<string, RestaurantEntry>();
    const resolved: Array<{ row: BeliRankedRow; place: PlaceCandidate }> = [];
    for (const [key, row] of rows) {
      const place = resolvePlace(row, matches[key], decisions[key]);
      if (!place) {
        summary.skipped++;
        continue;
      }
      const id = buildEntryId(place.placeId, category);
      if (currentById.has(id) || [...idOf.values()].includes(id)) {
        summary.duplicates.push({ key, category, entryId: id });
        if (currentById.has(id)) idOf.set(key, id);
        continue;
      }
      idOf.set(key, id);
      resolved.push({ row, place });
    }
    // The Beli spots in their merged order (a shared spot may appear under its jelly ID), for estimates
    const rowOfId = new Map([...idOf.entries()].filter(([k]) => rows.has(k)).map(([k, id]) => [id, k]));
    const beliOrder = list.order.map((k) => (rows.has(k) ? k : rowOfId.get(k))).filter((k): k is string => Boolean(k));
    const estimates = estimateScores(beliOrder, list.guts);
    for (const { row, place } of resolved) {
      const gut = list.guts[row.key];
      if (gut === undefined) summary.unrated++;
      if (decisions[row.key]?.kind === 'manual') summary.manual++;
      added.set(row.key, entryFor(row, place, gut, estimates[row.key] ?? 5, comparisonsFor(row.key, list, idOf), batch, now));
    }
    if (added.size === 0) continue;
    summary.added[category] = added.size;

    // The merged order: imported entries and existing ones (directly, or through a shared row)
    const used = new Set<string>();
    const ordered: RestaurantEntry[] = [];
    const slots: BeliSlot[] = [];
    for (const key of list.order) {
      const existing = currentById.get(key) ?? (rows.has(key) && idOf.has(key) ? currentById.get(idOf.get(key)!) : undefined);
      const entry = existing ?? added.get(key);
      if (!entry || used.has(entry.id)) continue;
      used.add(entry.id);
      ordered.push(entry);
      if (rows.has(key)) slots.push(existing ? { existingId: existing.id } : { entry });
    }
    let next = ordered;
    if (current.some((r) => !used.has(r.id))) {
      // The jelly merge wasn't done: weave the Beli order into the existing list
      const merged = mergeIntoList(current, slots);
      summary.orderConflicts.push(...merged.conflicting.map((entryId) => ({ category, entryId })));
      next = merged.list;
    }
    restaurants = replaceCategoryList(restaurants, category, next);
  }

  let bookmarks = input.bookmarks;
  if (includeBookmarks) {
    const newBookmarks: BookmarkEntry[] = [];
    const savedIds = new Set(bookmarks.flatMap((b) => [b.id, b.placeId].filter(Boolean) as string[]));
    for (const row of exp.bookmarks) {
      const place = resolvePlace(row, matches[row.key], decisions[row.key]);
      if (!place) {
        summary.skipped++;
        continue;
      }
      const ranked = restaurants.some((r) => r.id === buildEntryId(place.placeId, row.category));
      if (savedIds.has(place.placeId) || ranked) {
        summary.skippedBookmarks++;
        continue;
      }
      savedIds.add(place.placeId);
      if (decisions[row.key]?.kind === 'manual') summary.manual++;
      newBookmarks.push(bookmarkFor(row, place, batch, now));
    }
    summary.addedBookmarks = newBookmarks.length;
    bookmarks = [...newBookmarks, ...bookmarks].sort((a, b) => b.createdAt - a.createdAt);
  }

  return { batch, restaurants, bookmarks, summary };
}

/** When a batch was imported, from its ID (`createImportBatchId`) */
export function batchTime(batch: string): number | undefined {
  const t = parseInt(batch.split('-')[1] ?? '', 36);
  return Number.isFinite(t) ? t : undefined;
}

/** Import batches still present in the lists, newest first (for "Undo import"). */
export function importBatches(
  restaurants: RestaurantEntry[],
  bookmarks: BookmarkEntry[]
): Array<{ batch: string; source: 'beli'; spots: number; bookmarks: number; importedAt: number }> {
  const byBatch = new Map<string, { batch: string; source: 'beli'; spots: number; bookmarks: number; importedAt: number }>();
  const add = (item: RestaurantEntry | BookmarkEntry, kind: 'spots' | 'bookmarks') => {
    if (!item.imported) return;
    const b = byBatch.get(item.imported.batch) ?? { batch: item.imported.batch, source: item.imported.source, spots: 0, bookmarks: 0, importedAt: 0 };
    b[kind]++;
    b.importedAt = batchTime(b.batch) ?? Math.max(b.importedAt, item.updatedAt || 0);
    byBatch.set(b.batch, b);
  };
  restaurants.forEach((r) => add(r, 'spots'));
  bookmarks.forEach((b) => add(b, 'bookmarks'));
  return [...byBatch.values()].sort((a, b) => b.importedAt - a.importedAt);
}

/**
 * Takes one import back out: every spot and bookmark of the batch still there (edited since or
 * not; the confirm should say so), with the remaining spots re-scored without them.
 */
export function undoImport(
  restaurants: RestaurantEntry[],
  bookmarks: BookmarkEntry[],
  batch: string
): { restaurants: RestaurantEntry[]; bookmarks: BookmarkEntry[]; removedSpotIds: string[]; removedBookmarkIds: string[] } {
  const inBatch = (item: { imported?: { batch: string } }) => item.imported?.batch === batch;
  const removedSpotIds = restaurants.filter(inBatch).map((r) => r.id);
  const removedBookmarkIds = bookmarks.filter(inBatch).map((b) => b.id);
  const kept = restaurants
    .filter((r) => !inBatch(r))
    .sort((a, b) => a.rankIndex - b.rankIndex); // recomputeAllCategoryScores reads array order as rank order
  return {
    restaurants: removedSpotIds.length ? recomputeAllCategoryScores(kept) : restaurants,
    bookmarks: bookmarks.filter((b) => !inBatch(b)),
    removedSpotIds,
    removedBookmarkIds,
  };
}

/** Undo removes re-ranked spots too: how many of the batch were ranked again after the import (for the confirm) */
export function editedSinceImport(restaurants: RestaurantEntry[], batch: string): number {
  return restaurants.filter((r) => r.imported?.batch === batch && (r.rankedHistory?.length ?? 0) > 1).length;
}

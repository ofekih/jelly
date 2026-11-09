import type { BookmarkEntry, PlaceCandidate, RestaurantEntry, SpotCategory, StoredComparison } from '../../types';
import { buildEntryId, getCategoryList, recomputeAllCategoryScores, replaceCategoryList } from '../categoryLists';
import { createManualPlaceCandidate } from '../placesService';
import { interpolateGuts } from './scores';
import type {
  Anchor,
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

/** A custom spot's ID for a Beli place: stable, so a re-import recognises it; `manual_` keeps it out of community stats */
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
 * `imported.key` on an entry: the Beli list it came from plus the place key, so a spot moved to
 * another jelly list since is still recognised (and the same place in two Beli lists stays two).
 */
export function importKey(category: SpotCategory, key: string): string {
  return `${category}:${key}`;
}

/** Whether an entry or bookmark came from this Beli row (any earlier batch, wherever it is now) */
const fromBeliRow = (item: { imported?: { source: string; key: string } }, row: { category: SpotCategory; key: string }) =>
  item.imported?.source === 'beli' && item.imported.key === importKey(row.category, row.key);

/**
 * For `buildMatchQueries`: rows an earlier import already brought in (by Beli key, in that list
 * or in Want to try) need no lookup this time.
 */
export function alreadyImported(restaurants: RestaurantEntry[], bookmarks: BookmarkEntry[]): (key: string, category: SpotCategory) => boolean {
  const keys = new Set([...restaurants, ...bookmarks].filter((r) => r.imported?.source === 'beli').map((r) => r.imported!.key));
  return (key, category) => keys.has(importKey(category, key));
}

/**
 * Spots of a Beli list that are already in that jelly list: their jelly scores are free anchors
 * at their Beli position (so a merge or re-import needs few or no questions).
 */
export function existingAnchors(
  rows: BeliRankedRow[],
  category: SpotCategory,
  restaurants: RestaurantEntry[],
  matches: Record<string, MatchResult>,
  decisions: Record<string, MatchDecision> = {}
): Anchor[] {
  const byId = new Map(getCategoryList(restaurants, category).map((r) => [r.id, r]));
  const anchors: Anchor[] = [];
  for (const row of rows) {
    const earlier = restaurants.find((r) => r.category === category && fromBeliRow(r, row));
    const place = earlier ? null : resolvePlace(row, matches[row.key], decisions[row.key]);
    const entry = earlier ?? (place ? byId.get(buildEntryId(place.placeId, category)) : undefined);
    if (entry) anchors.push({ key: row.key, rating: entry.magicScore, source: 'existing' });
  }
  return anchors;
}

/** Comparisons for the spot `key` from the boundary answers (as the lower spot), against spots that made it into the list */
function comparisonsFor(key: string, list: ScoredList, idOf: Map<string, string>): StoredComparison[] {
  return list.answers
    .filter((a) => a.lower === key && idOf.has(a.upper))
    .map((a) => ({ opponentId: idOf.get(a.upper)!, result: a.result, at: a.at }));
}

function entryFor(
  row: BeliRankedRow,
  place: PlaceCandidate,
  gut: number,
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
    initialRating: gut,
    rankIndex: 0,
    magicScore: gut,
    comparisonsCount: comparisons.length,
    notes: row.notes,
    favoriteDishes: row.favoriteDishes,
    privateNotes: row.privateNotes,
    rankedHistory: [{ timestamp: createdAt, initialRating: gut }],
    comparisons: comparisons.length ? comparisons : undefined,
    imported: { source: 'beli', batch, key: importKey(row.category, row.key) },
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
    imported: { source: 'beli', batch, key: importKey(row.category, row.key) },
    createdAt: row.createdAt ?? now,
    updatedAt: now,
  };
}

/**
 * Weaves imported spots (best first, by gut) into an existing list (best first, by score) as a
 * merge of two sorted sequences, so both orders survive. Ties keep the existing spot first.
 */
export function weaveByScore(existing: RestaurantEntry[], imported: RestaurantEntry[]): RestaurantEntry[] {
  const out: RestaurantEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < existing.length || j < imported.length) {
    if (j >= imported.length || (i < existing.length && existing[i].magicScore >= imported[j].initialRating)) out.push(existing[i++]);
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
 * existing spots are woven by score. Without shared spots this is `weaveByScore`.
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
  linear?: boolean; // The user's rating scale (`linearRatingScale`)
  batch: string;
  now?: number;
}

/**
 * The lists after the import. A place already in that jelly list keeps its jelly entry (reported
 * as a duplicate, used as an anchor); rows an earlier import brought in are skipped; the rest get
 * gut ratings from the anchors and are woven in by score. Bookmarks already saved, or ranked in
 * that list, are skipped. Scores are recomputed for every list touched.
 */
export function buildImportPlan(input: BuildImportInput): ImportPlan {
  const { exp, matches, batch, includeBookmarks = true, linear = false } = input;
  const decisions = input.decisions ?? {};
  const now = input.now ?? Date.now();
  const summary: ImportSummary = { added: {}, addedBookmarks: 0, duplicates: [], orderConflicts: [], alreadyImported: 0, skippedBookmarks: 0, skipped: 0, manual: 0 };
  let restaurants = input.restaurants;

  for (const list of input.lists) {
    const { category } = list;
    const rows = new Map((exp.lists[category] ?? []).map((r) => [r.key, r]));
    const ordered = list.order.map((k) => rows.get(k)).filter((r): r is BeliRankedRow => Boolean(r));
    const current = getCategoryList(restaurants, category);
    const currentIds = new Set(current.map((r) => r.id));
    const guts = interpolateGuts(
      list.order,
      [...list.anchors.filter((a) => a.source === 'user'), ...existingAnchors(ordered, category, restaurants, matches, decisions)],
      { linear, buckets: list.buckets }
    );

    // Resolve every row first, so comparisons can point at any spot that made it in
    const resolved: Array<{ row: BeliRankedRow; place: PlaceCandidate }> = [];
    const slots: Array<{ existingId: string } | { row: BeliRankedRow }> = [];
    const idOf = new Map<string, string>();
    const seenIds = new Set<string>();
    for (const row of ordered) {
      const earlier = restaurants.find((r) => fromBeliRow(r, row));
      if (earlier) {
        summary.alreadyImported++;
        // Still in this list: it pins the order; moved to another list since: left alone
        if (earlier.category === category) {
          idOf.set(row.key, earlier.id);
          slots.push({ existingId: earlier.id });
        }
        continue;
      }
      const place = resolvePlace(row, matches[row.key], decisions[row.key]);
      if (!place) {
        summary.skipped++;
        continue;
      }
      const id = buildEntryId(place.placeId, category);
      idOf.set(row.key, id);
      if (currentIds.has(id) || seenIds.has(id)) {
        summary.duplicates.push({ key: row.key, category, entryId: id });
        if (currentIds.has(id)) slots.push({ existingId: id });
        continue;
      }
      seenIds.add(id);
      slots.push({ row });
      if (decisions[row.key]?.kind === 'manual') summary.manual++;
      resolved.push({ row, place });
    }

    const added = new Map(
      resolved.map(({ row, place }) => [row.key, entryFor(row, place, guts[row.key], comparisonsFor(row.key, list, idOf), batch, now)])
    );
    if (added.size === 0) continue;
    summary.added[category] = added.size;
    const merged = mergeIntoList(
      current,
      slots.map((s) => ('row' in s ? { entry: added.get(s.row.key)! } : s))
    );
    summary.orderConflicts.push(...merged.conflicting.map((entryId) => ({ category, entryId })));
    restaurants = replaceCategoryList(restaurants, category, merged.list);
  }

  let bookmarks = input.bookmarks;
  if (includeBookmarks) {
    const added: BookmarkEntry[] = [];
    const savedIds = new Set(bookmarks.flatMap((b) => [b.id, b.placeId].filter(Boolean) as string[]));
    for (const row of exp.bookmarks) {
      if ([...bookmarks, ...restaurants].some((b) => fromBeliRow(b, row))) {
        summary.alreadyImported++;
        continue;
      }
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
      added.push(bookmarkFor(row, place, batch, now));
    }
    summary.addedBookmarks = added.length;
    bookmarks = [...added, ...bookmarks].sort((a, b) => b.createdAt - a.createdAt);
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

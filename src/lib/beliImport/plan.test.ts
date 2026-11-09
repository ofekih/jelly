import { describe, expect, it } from 'vitest';
import type { BookmarkEntry, PlaceCandidate, RestaurantEntry, SpotCategory } from '../../types';
import { buildEntryId, getCategoryList, recomputeAllCategoryScores } from '../categoryLists';
import { buildPublicLists } from '../publicList';
import { placeSpot } from '../rankingActions';
import { answerBoundaryQuestion, bucketOf, mergedOrder, startBoundaryMerge } from './boundaryMerge';
import { syntheticBeliTexts } from './fixtures';
import { buildMatchQueries } from './match';
import { parseBeliExport } from './parse';
import {
  alreadyImported,
  batchTime,
  buildImportPlan,
  createImportBatchId,
  editedSinceImport,
  importBatches,
  undoImport,
  longestIncreasing,
  mergeIntoList,
  weaveByScore,
} from './plan';
import type { BeliExport, MatchResult, ScoredList } from './types';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const BATCH = createImportBatchId(NOW, () => 0.5);

function candidate(key: string, name = key.split('|')[0]): PlaceCandidate {
  return { placeId: `g_${key.replace(/[^a-z0-9]/g, '')}`, name, formattedAddress: 'Somewhere', categories: ['restaurants'], cuisines: ['Italian'], source: 'google_places', lat: 33, lng: -117 };
}

function matchAll(exp: BeliExport, overrides: Record<string, PlaceCandidate> = {}): Record<string, MatchResult> {
  return Object.fromEntries(
    buildMatchQueries(exp).map((q) => [
      q.key,
      { key: q.key, status: 'matched', best: overrides[q.key] ?? candidate(q.key, q.name), candidates: [], reasons: [], query: q.name, fromCache: false } as MatchResult,
    ])
  );
}

function scoredLists(exp: BeliExport, ratings: Record<string, number> = {}): ScoredList[] {
  return (Object.keys(exp.lists) as SpotCategory[]).map((category) => {
    const order = exp.lists[category]!.map((r) => r.key);
    return { category, order, anchors: Object.entries(ratings).filter(([k]) => order.includes(k)).map(([key, rating]) => ({ key, rating, source: 'user' as const })), answers: [] };
  });
}

function jellyEntry(id: string, magicScore: number, rankIndex: number, extra: Partial<RestaurantEntry> = {}): RestaurantEntry {
  return { id, placeId: id.split('__')[0], name: id, formattedAddress: '', category: 'restaurants', categories: ['restaurants'], cuisines: [], initialRating: magicScore, rankIndex, magicScore, comparisonsCount: 3, createdAt: 1, updatedAt: 1, ...extra };
}

const exp = parseBeliExport(syntheticBeliTexts({ restaurants: 12 }) as any);
const resKeys = exp.lists.restaurants!.map((r) => r.key);

describe('buildImportPlan into empty lists', () => {
  const plan = buildImportPlan({ exp, lists: scoredLists(exp, { [resKeys[0]]: 9.5, [resKeys[11]]: 5 }), matches: matchAll(exp), restaurants: [], bookmarks: [], batch: BATCH, now: NOW });
  const res = getCategoryList(plan.restaurants, 'restaurants');

  it('imports every list in Beli order with non-increasing scores', () => {
    expect(res.map((r) => r.imported!.key)).toEqual(resKeys.map((k) => `restaurants:${k}`));
    res.slice(1).forEach((r, i) => expect(r.magicScore).toBeLessThanOrEqual(res[i].magicScore));
    expect(res[0].initialRating).toBe(9.5);
    expect(res[11].initialRating).toBe(5);
    expect(plan.summary.added).toEqual({ restaurants: 12, bakeries: 4, coffee_tea: 2, dessert: 1 });
  });

  it('maps the fields: notes, dishes, private notes, dates, history, import details', () => {
    const cafe = res[0];
    expect(cafe.notes).toContain('Second visit');
    expect(cafe.favoriteDishes).toBe('Shakshuka, labneh');
    expect(cafe.createdAt).toBe(Date.parse('2025-06-01T18:30:00.123Z'));
    expect(cafe.rankedHistory).toEqual([{ timestamp: cafe.createdAt, initialRating: 9.5 }]);
    expect(cafe.comparisonsCount).toBe(0);
    expect(cafe.imported).toEqual({ source: 'beli', batch: BATCH, key: `restaurants:${resKeys[0]}` });
    expect(cafe.cuisines).toEqual(['Italian']);
    expect(cafe.priceLevel).toBeUndefined();
    expect(res[1].privateNotes).toBe('Ask for the back table');
  });

  it('never publishes private notes or import details', () => {
    const pub = buildPublicLists(plan.restaurants, plan.bookmarks);
    const json = JSON.stringify(pub);
    expect(json).not.toContain('Ask for the back table');
    expect(json).not.toContain('"imported"');
    expect(json).toContain('Second visit');
  });

  it('imports bookmarks with their notes, skipping duplicates', () => {
    expect(plan.bookmarks.map((b) => b.name).sort()).toEqual(['Crust Club', 'Matcha Lab', 'Saffron Road']);
    expect(plan.bookmarks.find((b) => b.name === 'Saffron Road')!.notes).toBe('Friend says the biryani is the move');
    expect(plan.bookmarks.every((b) => b.imported?.batch === BATCH && b.id === b.placeId)).toBe(true);
  });
});

describe('merging into existing lists', () => {
  // The user already ranked two of the Beli spots in jelly, plus two others
  const dupTop = candidate(resKeys[2]);
  const dupLow = candidate(resKeys[8]);
  const existing = recomputeAllCategoryScores([
    jellyEntry('other_a__restaurants', 9.6, 0),
    jellyEntry(buildEntryId(dupTop.placeId, 'restaurants'), 8.8, 1, { notes: 'mine' }),
    jellyEntry('other_b__restaurants', 7.5, 2),
    jellyEntry(buildEntryId(dupLow.placeId, 'restaurants'), 6.0, 3),
  ]);
  const plan = buildImportPlan({ exp, lists: scoredLists(exp), matches: matchAll(exp), restaurants: existing, bookmarks: [], batch: BATCH, now: NOW });
  const res = getCategoryList(plan.restaurants, 'restaurants');

  it('keeps the jelly entry for a place already in the list and reports it', () => {
    expect(plan.summary.duplicates.map((d) => d.key)).toEqual([resKeys[2], resKeys[8]]);
    expect(res.find((r) => r.placeId === dupTop.placeId)).toMatchObject({ notes: 'mine', comparisonsCount: 3 });
    expect(res).toHaveLength(4 + 10);
  });

  it('keeps both orders: the existing spots and the imported ones', () => {
    const existingOrder = res.filter((r) => !r.imported).map((r) => r.id);
    expect(existingOrder).toEqual(existing.map((r) => r.id));
    const importedOrder = res.filter((r) => r.imported).map((r) => r.imported!.key.replace('restaurants:', ''));
    expect(importedOrder).toEqual(resKeys.filter((k) => k !== resKeys[2] && k !== resKeys[8]));
  });

  it('uses the duplicates as anchors: Beli spots around a duplicate land around it', () => {
    const pos = (key: string) => res.findIndex((r) => r.imported?.key === `restaurants:${key}`);
    const dupPos = res.findIndex((r) => r.placeId === dupLow.placeId);
    expect(pos(resKeys[9])).toBeGreaterThan(dupPos);
    expect(pos(resKeys[1])).toBeLessThan(dupPos);
  });

  it('shared spots pin the orders together: a new spot stays between its Beli neighbours', () => {
    const existing = [jellyEntry('A', 9, 0), jellyEntry('D1', 8, 1), jellyEntry('B', 7, 2)];
    const hi = jellyEntry('hi', 4, 0, { initialRating: 4 }); // Its gut says low, but Beli ranks it above D1
    const lo = jellyEntry('lo', 9.5, 0, { initialRating: 9.5 });
    const out = mergeIntoList(existing, [{ entry: hi }, { existingId: 'D1' }, { entry: lo }]);
    expect(out.list.map((r) => r.id)).toEqual(['A', 'hi', 'D1', 'lo', 'B']);
    expect(out.fixed).toEqual(['D1']);
  });

  it('shared spots the two orders disagree about pin nothing and are reported', () => {
    const existing = [jellyEntry('D1', 9, 0), jellyEntry('D2', 8, 1), jellyEntry('D3', 7, 2)];
    const n = jellyEntry('n', 8.5, 0, { initialRating: 8.5 });
    // Beli: D3 > D1 > n > D2 (D3 disagrees with jelly)
    const out = mergeIntoList(existing, [{ existingId: 'D3' }, { existingId: 'D1' }, { entry: n }, { existingId: 'D2' }]);
    expect(out.fixed).toEqual(['D1', 'D2']);
    expect(out.conflicting).toEqual(['D3']);
    expect(out.list.map((r) => r.id)).toEqual(['D1', 'n', 'D2', 'D3']);
  });

  it('longestIncreasing finds a longest increasing run', () => {
    expect(longestIncreasing([3, 1, 2, 5, 4, 6])).toEqual([1, 2, 4, 5]);
    expect(longestIncreasing([])).toEqual([]);
  });

  it('weaveByScore is a merge of two sorted runs', () => {
    const a = [jellyEntry('a', 9, 0), jellyEntry('b', 7, 1), jellyEntry('c', 5, 2)];
    const b = [jellyEntry('x', 8, 0), jellyEntry('y', 7, 1), jellyEntry('z', 2, 2)];
    expect(weaveByScore(a, b).map((r) => r.id)).toEqual(['a', 'x', 'b', 'y', 'c', 'z']);
  });
});

describe('re-importing a newer export', () => {
  const first = buildImportPlan({ exp, lists: scoredLists(exp), matches: matchAll(exp), restaurants: [], bookmarks: [], batch: BATCH, now: NOW });
  const newer = parseBeliExport(syntheticBeliTexts({ restaurants: 15 }) as any);
  const skip = alreadyImported(first.restaurants, first.bookmarks);

  it('needs lookups only for the new places', () => {
    const queries = buildMatchQueries(newer, skip);
    expect(queries.map((q) => q.name)).toEqual(newer.lists.restaurants!.slice(12).map((r) => r.name));
  });

  it('does not re-add a spot moved to another jelly list since', () => {
    const nonna = first.restaurants.find((r) => r.name.startsWith('Nonna'))!;
    const moved = first.restaurants.map((r) => (r.id === nonna.id ? { ...r, category: 'brunch' as const, id: buildEntryId(r.placeId!, 'brunch') } : r));
    const plan = buildImportPlan({ exp: newer, lists: scoredLists(newer), matches: matchAll(newer), restaurants: moved, bookmarks: first.bookmarks, batch: 'beli-x-0', now: NOW });
    expect(getCategoryList(plan.restaurants, 'restaurants').some((r) => r.name.startsWith('Nonna'))).toBe(false);
    expect(alreadyImported(moved, [])(nonna.imported!.key.replace('restaurants:', ''), 'restaurants')).toBe(true);
  });

  it('adds only the new spots', () => {
    const batch2 = createImportBatchId(NOW + 1000, () => 0.1);
    const plan = buildImportPlan({ exp: newer, lists: scoredLists(newer), matches: matchAll(newer), restaurants: first.restaurants, bookmarks: first.bookmarks, batch: batch2, now: NOW + 1000 });
    expect(plan.summary.added).toEqual({ restaurants: 3 });
    expect(plan.summary.addedBookmarks).toBe(0);
    expect(plan.summary.alreadyImported).toBe(12 + 4 + 2 + 1 + 3);
    expect(importBatches(plan.restaurants, plan.bookmarks).map((b) => [b.batch, b.spots, b.bookmarks])).toEqual([
      [batch2, 3, 0],
      [BATCH, 19, 3],
    ]);
  });
});

describe('decisions and bookmarks', () => {
  it('skips, adds custom spots, and leaves out unmatched places', () => {
    const matches = matchAll(exp);
    matches[resKeys[3]] = { ...matches[resKeys[3]], status: 'review' };
    matches[resKeys[4]] = { ...matches[resKeys[4]], status: 'not_found', best: undefined };
    const plan = buildImportPlan({
      exp,
      lists: scoredLists(exp),
      matches,
      decisions: { [resKeys[4]]: { kind: 'manual' }, [resKeys[5]]: { kind: 'skip' } },
      restaurants: [],
      bookmarks: [],
      batch: BATCH,
      now: NOW,
    });
    const res = getCategoryList(plan.restaurants, 'restaurants');
    expect(res).toHaveLength(10);
    const manual = res.find((r) => r.imported?.key === `restaurants:${resKeys[4]}`)!;
    expect(manual.placeId).toMatch(/^manual_beli_/);
    expect(plan.summary).toMatchObject({ skipped: 2, manual: 1 });
  });

  it('skips bookmarks already saved or already ranked in that list', () => {
    const bm = exp.bookmarks;
    const saffron = candidate(bm[0].key);
    const crust = candidate(bm[1].key);
    const saved: BookmarkEntry = { id: saffron.placeId, placeId: saffron.placeId, name: 'Saffron', formattedAddress: '', category: 'restaurants', categories: [], cuisines: [], createdAt: 1, updatedAt: 1 };
    const ranked = jellyEntry(buildEntryId(crust.placeId, 'bakeries'), 8, 0, { category: 'bakeries' });
    const plan = buildImportPlan({ exp, lists: [], matches: matchAll(exp), restaurants: [ranked], bookmarks: [saved], batch: BATCH, now: NOW });
    expect(plan.summary).toMatchObject({ addedBookmarks: 1, skippedBookmarks: 2 });
    expect(plan.bookmarks.map((b) => b.name)).toContain('Matcha Lab');
  });

  it('can leave bookmarks out entirely', () => {
    const plan = buildImportPlan({ exp, lists: [], matches: matchAll(exp), restaurants: [], bookmarks: [], includeBookmarks: false, batch: BATCH, now: NOW });
    expect(plan.bookmarks).toEqual([]);
  });
});

describe('boundary answers become comparisons', () => {
  it('stores each answer on the lower spot, against the spot it was compared with', () => {
    const keys = exp.lists.restaurants!.map((r) => r.key);
    let merge = startBoundaryMerge(keys, { firstFine: 8 });
    merge = answerBoundaryQuestion(merge, 'lower', 5); // F0 beats L7
    merge = answerBoundaryQuestion(merge, 'upper', 6); // …but not L5: lands between
    const list: ScoredList = { category: 'restaurants', order: mergedOrder(merge), anchors: [], buckets: bucketOf(merge), answers: merge.answers };
    const plan = buildImportPlan({ exp, lists: [list], matches: matchAll(exp), restaurants: [], bookmarks: [], batch: BATCH, now: NOW });
    const res = getCategoryList(plan.restaurants, 'restaurants');
    expect(res.map((r) => r.imported!.key)).toEqual(list.order.map((k) => `restaurants:${k}`));
    const moved = res.find((r) => r.imported!.key === `restaurants:${keys[8]}`)!;
    expect(moved.comparisons).toEqual([
      { opponentId: buildEntryId(candidate(keys[7]).placeId, 'restaurants'), result: 1, at: 5 },
      { opponentId: buildEntryId(candidate(keys[5]).placeId, 'restaurants'), result: 0, at: 6 },
    ]);
    expect(moved.comparisonsCount).toBe(2);
  });
});

describe('undo', () => {
  const existing = recomputeAllCategoryScores([jellyEntry('a__restaurants', 9.6, 0), jellyEntry('b__restaurants', 5.0, 1)]);
  const plan = buildImportPlan({ exp, lists: scoredLists(exp), matches: matchAll(exp), restaurants: existing, bookmarks: [], batch: BATCH, now: NOW });

  it('removes exactly the batch and restores the other scores', () => {
    const undone = undoImport(plan.restaurants, plan.bookmarks, BATCH);
    expect(undone.restaurants).toEqual(existing);
    expect(undone.bookmarks).toEqual([]);
    expect(undone.removedSpotIds).toHaveLength(19);
    expect(undone.removedBookmarkIds).toHaveLength(3);
  });

  it('a re-ranked import keeps its batch (and private notes), and is counted for the confirm', () => {
    const target = plan.restaurants.find((r) => r.imported?.key === `restaurants:${resKeys[1]}`)!;
    const placed = placeSpot(
      plan.restaurants,
      { candidate: candidate(resKeys[1]), initialRating: 7, category: 'restaurants', cuisines: [], existingIdToReplace: target.id },
      { insertIndex: 3, comparisonsDone: 2, answers: [] },
      NOW + 5
    );
    expect(placed.entry.imported).toEqual(target.imported);
    expect(placed.entry.privateNotes).toBe('Ask for the back table');
    expect(editedSinceImport(placed.restaurants, BATCH)).toBe(1);
    expect(batchTime(BATCH)).toBe(NOW);
  });
});

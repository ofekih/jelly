import { describe, expect, it } from 'vitest';
import type { BookmarkEntry, PlaceCandidate, RestaurantEntry, SpotCategory } from '../../types';
import { buildEntryId, getCategoryList, recomputeAllCategoryScores } from '../categoryLists';
import { buildPublicLists } from '../publicList';
import { placeSpot } from '../rankingActions';
import { syntheticBeliTexts } from './fixtures';
import { buildMatchQueries } from './match';
import { answerMergeQuestion, mergeOrder, nextMergeQuestion, startBucketMerge, startJellyMerge } from './merge';
import { parseBeliExport } from './parse';
import {
  batchTime,
  buildImportPlan,
  createImportBatchId,
  editedSinceImport,
  importBatches,
  jellyMergeEstimates,
  longestIncreasing,
  mergeIntoList,
  sharedSpots,
  undoImport,
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

/** Every list in Beli order, with the given gut ratings (by row key) */
function scoredLists(exp: BeliExport, guts: Record<string, number> = {}): ScoredList[] {
  return (Object.keys(exp.lists) as SpotCategory[]).map((category) => ({ category, order: exp.lists[category]!.map((r) => r.key), guts, answers: [] }));
}

function jellyEntry(id: string, magicScore: number, rankIndex: number, extra: Partial<RestaurantEntry> = {}): RestaurantEntry {
  return { id, placeId: id.split('__')[0], name: id, formattedAddress: '', category: 'restaurants', categories: ['restaurants'], cuisines: [], initialRating: magicScore, rankIndex, magicScore, comparisonsCount: 3, createdAt: 1, updatedAt: 1, ...extra };
}

const exp = parseBeliExport(syntheticBeliTexts({ restaurants: 12 }) as any);
const resKeys = exp.lists.restaurants!.map((r) => r.key);
const allRated = Object.fromEntries(resKeys.map((k, i) => [k, Math.round((9.5 - i * 0.4) * 10) / 10]));

describe('buildImportPlan into empty lists', () => {
  const guts = { ...allRated };
  delete guts[resKeys[5]]; // Not rated
  const plan = buildImportPlan({ exp, lists: scoredLists(exp, guts), matches: matchAll(exp), restaurants: [], bookmarks: [], batch: BATCH, now: NOW });
  const res = getCategoryList(plan.restaurants, 'restaurants');

  it('imports every list in its order with non-increasing scores', () => {
    expect(res.map((r) => r.imported!.key)).toEqual(resKeys);
    res.slice(1).forEach((r, i) => expect(r.magicScore).toBeLessThanOrEqual(res[i].magicScore));
    expect(res[0].initialRating).toBe(9.5);
    expect(plan.summary.added).toEqual({ restaurants: 12, bakeries: 4, coffee_tea: 2, dessert: 1 });
  });

  it('leaves a spot the user did not rate without a gut rating', () => {
    expect(res[5].initialRating).toBeUndefined();
    expect(res[5].rankedHistory).toEqual([{ timestamp: res[5].createdAt }]);
    expect(res[5].magicScore).toBeLessThanOrEqual(res[4].magicScore);
    expect(res[5].magicScore).toBeGreaterThanOrEqual(res[6].magicScore);
    // The other lists had no ratings at all
    expect(plan.summary.unrated).toBe(1 + 4 + 2 + 1);
  });

  it('maps the fields: notes, dishes, private notes, dates, history, import details', () => {
    const cafe = res[0];
    expect(cafe.notes).toContain('Second visit');
    expect(cafe.favoriteDishes).toBe('Shakshuka, labneh');
    expect(cafe.createdAt).toBe(Date.parse('2025-06-01T18:30:00.123Z'));
    expect(cafe.rankedHistory).toEqual([{ timestamp: cafe.createdAt, initialRating: 9.5 }]);
    expect(cafe.comparisonsCount).toBe(0);
    expect(cafe.imported).toEqual({ source: 'beli', batch: BATCH, key: resKeys[0] });
    expect(cafe.cuisines).toEqual(['Italian']);
    expect(cafe.priceLevel).toBeUndefined();
    expect(res[1].privateNotes).toBe('Ask for the back table');
  });

  it('never publishes private notes or import details', () => {
    const json = JSON.stringify(buildPublicLists(plan.restaurants, plan.bookmarks));
    expect(json).not.toContain('Ask for the back table');
    expect(json).not.toContain('"imported"');
    expect(json).toContain('Second visit');
  });

  it('imports bookmarks with their notes', () => {
    expect(plan.bookmarks.map((b) => b.name).sort()).toEqual(['Crust Club', 'Matcha Lab', 'Saffron Road']);
    expect(plan.bookmarks.find((b) => b.name === 'Saffron Road')!.notes).toBe('Friend says the biryani is the move');
    expect(plan.bookmarks.every((b) => b.imported?.batch === BATCH && b.id === b.placeId)).toBe(true);
  });
});

describe('merging with a list that already has spots', () => {
  const dupTop = candidate(resKeys[2]);
  const dupLow = candidate(resKeys[8]);
  const existing = recomputeAllCategoryScores([
    jellyEntry('other_a__restaurants', 9.6, 0),
    jellyEntry(buildEntryId(dupTop.placeId, 'restaurants'), 8.8, 1, { notes: 'mine' }),
    jellyEntry('other_b__restaurants', 7.5, 2),
    jellyEntry(buildEntryId(dupLow.placeId, 'restaurants'), 6.0, 3),
  ]);
  const jelly = getCategoryList(existing, 'restaurants');
  const matches = matchAll(exp);

  it('with the jelly merge answered, uses its order exactly and keeps shared spots as the jelly entry', () => {
    const shared = sharedSpots(exp.lists.restaurants!, 'restaurants', existing, matches);
    expect(shared).toEqual({ [resKeys[2]]: jelly[1].id, [resKeys[8]]: jelly[3].id });
    // Hidden truth: Beli spots on their gut scale, jelly spots at their scores
    const truth: Record<string, number> = { ...allRated, ...Object.fromEntries(jelly.map((r) => [r.id, r.magicScore])) };
    let s = startJellyMerge(resKeys, jelly.map((r) => r.id), shared, jellyMergeEstimates(resKeys, allRated, jelly));
    for (let q = nextMergeQuestion(s); q; q = nextMergeQuestion(s)) s = answerMergeQuestion(s, truth[q.candidate] > truth[q.other] ? 'candidate' : 'other', 7);
    const list: ScoredList = { category: 'restaurants', order: mergeOrder(s), guts: allRated, answers: s.answers };
    const plan = buildImportPlan({ exp, lists: [list], matches, restaurants: existing, bookmarks: [], batch: BATCH, now: NOW });
    const res = getCategoryList(plan.restaurants, 'restaurants');
    expect(res.map((r) => r.id)).toEqual(list.order.map((k) => res.find((r) => r.id === k || r.imported?.key === k)!.id));
    expect(res).toHaveLength(4 + 10);
    expect(res.find((r) => r.id === jelly[1].id)).toMatchObject({ notes: 'mine', comparisonsCount: 3 });
    expect(plan.summary.duplicates.map((d) => d.key)).toEqual([resKeys[2], resKeys[8]]);
    // Answers against jelly spots are stored on the imported spot
    const withJellyAnswer = res.find((r) => r.comparisons?.some((c) => jelly.some((j) => j.id === c.opponentId)));
    expect(withJellyAnswer?.imported).toBeDefined();
  });

  it('without the jelly merge, falls back to pinning by shared spots and weaving by score', () => {
    const plan = buildImportPlan({ exp, lists: scoredLists(exp, allRated), matches, restaurants: existing, bookmarks: [], batch: BATCH, now: NOW });
    const res = getCategoryList(plan.restaurants, 'restaurants');
    expect(res.filter((r) => !r.imported).map((r) => r.id)).toEqual(jelly.map((r) => r.id));
    expect(res.filter((r) => r.imported).map((r) => r.imported!.key)).toEqual(resKeys.filter((k) => k !== resKeys[2] && k !== resKeys[8]));
    const pos = (key: string) => res.findIndex((r) => r.imported?.key === key);
    const dupPos = res.findIndex((r) => r.id === jelly[3].id);
    expect(pos(resKeys[9])).toBeGreaterThan(dupPos);
    expect(pos(resKeys[1])).toBeLessThan(dupPos);
  });

  it('mergeIntoList: shared spots pin the orders; ones the orders disagree on pin nothing', () => {
    const ex = [jellyEntry('D1', 9, 0), jellyEntry('D2', 8, 1), jellyEntry('D3', 7, 2)];
    const n = jellyEntry('n', 8.5, 0);
    const out = mergeIntoList(ex, [{ existingId: 'D3' }, { existingId: 'D1' }, { entry: n }, { existingId: 'D2' }]);
    expect(out.fixed).toEqual(['D1', 'D2']);
    expect(out.conflicting).toEqual(['D3']);
    expect(out.list.map((r) => r.id)).toEqual(['D1', 'n', 'D2', 'D3']);
    expect(longestIncreasing([3, 1, 2, 5, 4, 6])).toEqual([1, 2, 4, 5]);
    expect(weaveByScore([jellyEntry('a', 9, 0), jellyEntry('b', 5, 1)], [jellyEntry('x', 7, 0)]).map((r) => r.id)).toEqual(['a', 'x', 'b']);
  });
});

describe('decisions and bookmarks', () => {
  it('skips, adds custom spots, and leaves out unmatched places', () => {
    const matches = matchAll(exp);
    matches[resKeys[3]] = { ...matches[resKeys[3]], status: 'review' };
    matches[resKeys[4]] = { ...matches[resKeys[4]], status: 'not_found', best: undefined };
    const plan = buildImportPlan({
      exp,
      lists: scoredLists(exp, allRated),
      matches,
      decisions: { [resKeys[4]]: { kind: 'manual' }, [resKeys[5]]: { kind: 'skip' } },
      restaurants: [],
      bookmarks: [],
      batch: BATCH,
      now: NOW,
    });
    const res = getCategoryList(plan.restaurants, 'restaurants');
    expect(res).toHaveLength(10);
    expect(res.find((r) => r.imported?.key === resKeys[4])!.placeId).toMatch(/^manual_beli_/);
    expect(plan.summary).toMatchObject({ skipped: 2, manual: 1 });
  });

  it('skips bookmarks already saved or already ranked in that list', () => {
    const saffron = candidate(exp.bookmarks[0].key);
    const crust = candidate(exp.bookmarks[1].key);
    const saved: BookmarkEntry = { id: saffron.placeId, placeId: saffron.placeId, name: 'Saffron', formattedAddress: '', category: 'restaurants', categories: [], cuisines: [], createdAt: 1, updatedAt: 1 };
    const ranked = jellyEntry(buildEntryId(crust.placeId, 'bakeries'), 8, 0, { category: 'bakeries' });
    const plan = buildImportPlan({ exp, lists: [], matches: matchAll(exp), restaurants: [ranked], bookmarks: [saved], batch: BATCH, now: NOW });
    expect(plan.summary).toMatchObject({ addedBookmarks: 1, skippedBookmarks: 2 });
    expect(buildImportPlan({ exp, lists: [], matches: matchAll(exp), restaurants: [], bookmarks: [], includeBookmarks: false, batch: BATCH }).bookmarks).toEqual([]);
  });
});

describe('merge answers become comparisons', () => {
  it('stores each answer on the imported spots, either side of the question', () => {
    // The best "fine" spot (#9) beats the worst "liked" one
    const truth = Object.fromEntries(resKeys.map((k, i) => [k, i === 8 ? 7.45 : 9.5 - i * 0.3]));
    let s = startBucketMerge(resKeys, { firstFine: 8 }, truth);
    for (let q = nextMergeQuestion(s); q; q = nextMergeQuestion(s)) s = answerMergeQuestion(s, truth[q.candidate] > truth[q.other] ? 'candidate' : 'other', 5);
    const list: ScoredList = { category: 'restaurants', order: mergeOrder(s), guts: {}, answers: s.answers };
    expect(list.order.indexOf(resKeys[8])).toBe(7);
    const plan = buildImportPlan({ exp, lists: [list], matches: matchAll(exp), restaurants: [], bookmarks: [], batch: BATCH, now: NOW });
    const res = getCategoryList(plan.restaurants, 'restaurants');
    expect(res.map((r) => r.imported!.key)).toEqual(list.order);
    const moved = res.find((r) => r.imported!.key === resKeys[8])!;
    expect(moved.comparisons!.length).toBe(s.answers.filter((a) => a.candidate === resKeys[8]).length);
    const other = res.find((r) => r.id === moved.comparisons![0].opponentId)!;
    expect(other.comparisons).toContainEqual({ opponentId: moved.id, result: 1 - moved.comparisons![0].result, at: 5 });
  });
});

describe('undo', () => {
  const existing = recomputeAllCategoryScores([jellyEntry('a__restaurants', 9.6, 0), jellyEntry('b__restaurants', 5.0, 1)]);
  const plan = buildImportPlan({ exp, lists: scoredLists(exp, allRated), matches: matchAll(exp), restaurants: existing, bookmarks: [], batch: BATCH, now: NOW });

  it('removes exactly the batch and restores the other scores', () => {
    const undone = undoImport(plan.restaurants, plan.bookmarks, BATCH);
    expect(undone.restaurants).toEqual(existing);
    expect(undone.bookmarks).toEqual([]);
    expect(undone.removedSpotIds).toHaveLength(19);
    expect(undone.removedBookmarkIds).toHaveLength(3);
    expect(importBatches(plan.restaurants, plan.bookmarks)).toEqual([{ batch: BATCH, source: 'beli', spots: 19, bookmarks: 3, importedAt: NOW }]);
  });

  it('a re-ranked import keeps its batch and private notes, and is counted for the confirm', () => {
    const target = plan.restaurants.find((r) => r.imported?.key === resKeys[1])!;
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

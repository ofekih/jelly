import { describe, expect, it } from 'vitest';
import {
  FIRST_IN_LIST,
  PendingPlacement,
  placementPool,
  placeSpot,
  reorderSpot,
  restoreSpot,
  undoReorder,
} from './rankingActions';
import { getCategoryList, recomputeAllCategoryScores } from './categoryLists';
import { PlaceCandidate, RestaurantEntry, SpotCategory } from '../types';

function spot(
  placeId: string,
  score: number,
  rankIndex: number,
  category: SpotCategory = 'restaurants',
  extra: Partial<RestaurantEntry> = {}
): RestaurantEntry {
  return {
    id: `${placeId}__${category}`,
    placeId,
    name: placeId,
    formattedAddress: '',
    category,
    categories: [category],
    cuisines: [],
    initialRating: score,
    rankIndex,
    magicScore: score,
    comparisonsCount: 0,
    rankedHistory: [{ timestamp: 100, initialRating: score }],
    createdAt: 100,
    updatedAt: 100,
    ...extra,
  };
}

function candidate(placeId: string, extra: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return {
    placeId,
    name: placeId,
    formattedAddress: '',
    source: 'google_places',
    categories: ['restaurants'],
    cuisines: ['Thai'],
    priceLevel: 2,
    ...extra,
  };
}

const ids = (list: RestaurantEntry[], category: SpotCategory = 'restaurants') =>
  getCategoryList(list, category).map((r) => r.placeId);

describe('placeSpot', () => {
  const list = [spot('a', 9, 0), spot('b', 7, 1), spot('c', 5, 2), spot('bar', 8, 0, 'bars')];

  it('inserts a new spot where side-by-side put it and rescores the list', () => {
    const placement: PendingPlacement = {
      candidate: candidate('new'),
      initialRating: 8,
      category: 'restaurants',
      cuisines: ['Thai'],
    };
    const placed = placeSpot(
      list,
      placement,
      {
        insertIndex: 1,
        comparisonsDone: 2,
        answers: [{ opponentId: 'a__restaurants', result: 0 }],
      },
      500
    );
    expect(ids(placed.restaurants)).toEqual(['a', 'new', 'b', 'c']);
    expect(ids(placed.restaurants, 'bars')).toEqual(['bar']);
    expect(placed.position).toBe(2);
    expect(placed.removedId).toBeUndefined();
    expect(placed.entry.comparisons).toEqual([{ opponentId: 'a__restaurants', result: 0, at: 500 }]);
    expect(placed.entry.comparisonsCount).toBe(2);
    const scores = getCategoryList(placed.restaurants, 'restaurants').map((r) => r.magicScore);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores);
  });

  it('keeps notes, tags, price and history when re-ranking, and starts answers fresh', () => {
    const old = spot('b', 7, 1, 'restaurants', {
      notes: 'Get the noodles',
      favoriteDishes: 'Khao soi',
      cuisines: ['Burmese'],
      priceLevel: 1,
      comparisonsCount: 3,
      comparisons: [{ opponentId: 'a__restaurants', result: 0, at: 50 }],
    });
    const placed = placeSpot(
      [spot('a', 9, 0), old, spot('c', 5, 2)],
      {
        candidate: candidate('b'),
        initialRating: 6,
        category: 'restaurants',
        cuisines: ['Thai'],
        existingIdToReplace: old.id,
      },
      { insertIndex: 1, comparisonsDone: 1, answers: [] },
      500
    );
    expect(ids(placed.restaurants)).toEqual(['a', 'b', 'c']);
    expect(placed.entry).toMatchObject({
      notes: 'Get the noodles',
      favoriteDishes: 'Khao soi',
      cuisines: ['Burmese'],
      priceLevel: 1,
      comparisonsCount: 4,
      comparisons: [],
      createdAt: 100,
    });
    expect(placed.entry.rankedHistory?.map((h) => h.initialRating)).toEqual([7, 6]);
  });

  it('takes a fresh price range only when it matches the kept tier', () => {
    const range = { currency: 'USD', start: 20, end: 30 };
    const place = (stored: Partial<RestaurantEntry>, fresh: Partial<PlaceCandidate>) =>
      placeSpot(
        [spot('a', 9, 0), spot('b', 7, 1, 'restaurants', stored)],
        {
          candidate: candidate('b', fresh),
          initialRating: 6,
          category: 'restaurants',
          cuisines: ['Thai'],
          existingIdToReplace: 'b__restaurants',
        },
        { insertIndex: 1, comparisonsDone: 0, answers: [] },
        500
      ).entry;
    expect(place({ priceLevel: 2 }, { priceLevel: 2, priceRange: range })).toMatchObject({ priceLevel: 2, priceRange: range });
    // A hand-picked $$$ keeps its tier and gets no $$ range
    const manual = place({ priceLevel: 3 }, { priceLevel: 2, priceRange: range });
    expect(manual.priceLevel).toBe(3);
    expect(manual.priceRange).toBeUndefined();
    // A new spot takes everything from search
    expect(
      placeSpot(
        [],
        { candidate: candidate('new', { priceRange: range }), initialRating: 8, category: 'restaurants', cuisines: [] },
        { insertIndex: 0, comparisonsDone: 0, answers: [] },
        500
      ).entry
    ).toMatchObject({ priceLevel: 2, priceRange: range });
  });

  it('keeps notes when re-ranking the only spot in a list (no comparisons to make)', () => {
    const only = spot('solo', 7, 0, 'bakeries', { notes: 'Morning buns', priceLevel: 1 });
    const placement: PendingPlacement = {
      candidate: candidate('solo', { categories: ['bakeries'] }),
      initialRating: 9,
      category: 'bakeries',
      cuisines: [],
      existingIdToReplace: only.id,
    };
    expect(placementPool([only], placement)).toEqual([]);
    const placed = placeSpot([only], placement, FIRST_IN_LIST, 500);
    expect(placed.restaurants).toHaveLength(1);
    expect(placed.entry).toMatchObject({ notes: 'Morning buns', priceLevel: 1, initialRating: 9, rankIndex: 0 });
  });

  it('moves a spot re-ranked into another list and reports the old entry for deletion', () => {
    const placed = placeSpot(
      list,
      {
        candidate: candidate('b', { categories: ['bars'] }),
        initialRating: 8,
        category: 'bars',
        cuisines: [],
        existingIdToReplace: 'b__restaurants',
      },
      { insertIndex: 0, comparisonsDone: 1, answers: [] },
      500
    );
    expect(ids(placed.restaurants)).toEqual(['a', 'c']);
    expect(ids(placed.restaurants, 'bars')).toEqual(['b', 'bar']);
    expect(placed.removedId).toBe('b__restaurants');
  });

  it('never compares a spot against its own existing entry', () => {
    const placement: PendingPlacement = {
      candidate: candidate('b'),
      initialRating: 7,
      category: 'restaurants',
      cuisines: [],
    };
    expect(placementPool(list, placement).map((r) => r.placeId)).toEqual(['a', 'c']);
  });
});

describe('reorderSpot', () => {
  const list = [spot('a', 9, 0), spot('b', 7, 1), spot('c', 5, 2), spot('bar', 8, 0, 'bars')];

  it('moves a spot within its list and records the drag', () => {
    const moved = reorderSpot(list, 'c__restaurants', 'a__restaurants', 500)!;
    expect(ids(moved.restaurants)).toEqual(['c', 'a', 'b']);
    expect(moved).toMatchObject({ from: 2, to: 0 });
    expect(moved.entry.comparisons).toEqual([{ opponentId: 'a__restaurants', result: 1, at: 500 }]);
    expect(ids(moved.restaurants, 'bars')).toEqual(['bar']);
  });

  it('does nothing for a drop on itself, an unknown spot or another list', () => {
    expect(reorderSpot(list, 'a__restaurants', 'a__restaurants', 500)).toBeNull();
    expect(reorderSpot(list, 'nope', 'a__restaurants', 500)).toBeNull();
    expect(reorderSpot(list, 'a__restaurants', 'bar__bars', 500)).toBeNull();
  });
});

describe('undoReorder', () => {
  // Scored the way persisting scores them, so "exactly as before" includes ranks and scores
  const list = recomputeAllCategoryScores([
    spot('a', 9, 0, 'restaurants', { comparisons: [{ opponentId: 'b__restaurants', result: 1, at: 50 }] }),
    spot('b', 7, 1),
    spot('c', 6, 2, 'restaurants', { comparisons: [{ opponentId: 'a__restaurants', result: 0, at: 60 }] }),
    spot('d', 5, 3),
    spot('bar', 8, 0, 'bars'),
  ]);

  it('restores the list exactly, ranks, scores and answers included', () => {
    for (const [activeId, overId] of [
      ['c__restaurants', 'a__restaurants'],
      ['a__restaurants', 'd__restaurants'],
      ['b__restaurants', 'c__restaurants'],
      ['d__restaurants', 'b__restaurants'],
    ]) {
      const moved = reorderSpot(list, activeId, overId, 500)!;
      const undone = undoReorder(recomputeAllCategoryScores(moved.restaurants), moved.undo)!;
      expect(recomputeAllCategoryScores(undone)).toEqual(list);
    }
  });

  it('puts back an older answer the drag replaced', () => {
    // c had answered "below a"; dragging it above a overwrites that answer
    const moved = reorderSpot(list, 'c__restaurants', 'a__restaurants', 500)!;
    expect(moved.entry.comparisons?.find((c) => c.opponentId === 'a__restaurants')?.at).toBe(500);
    const undone = undoReorder(moved.restaurants, moved.undo)!;
    expect(undone.find((r) => r.placeId === 'c')?.comparisons).toEqual([
      { opponentId: 'a__restaurants', result: 0, at: 60 },
    ]);
  });

  it('keeps edits made since and never loses spots', () => {
    const moved = reorderSpot(list, 'c__restaurants', 'a__restaurants', 500)!;
    // Since then: b (c's old neighbour above) was deleted, e was added at the top, and c got a
    // note and a newer answer
    const later = moved.restaurants
      .filter((r) => r.placeId !== 'b')
      .map((r) =>
        r.placeId === 'c'
          ? {
              ...r,
              notes: 'new',
              comparisons: [...(r.comparisons ?? []), { opponentId: 'd__restaurants', result: 1 as const, at: 700 }],
            }
          : r
      );
    const withE = inOrder(later, ['e', 'c', 'a', 'd']);
    const undone = undoReorder(withE, moved.undo)!;
    // Back above its old neighbour below, d
    expect(ids(undone)).toEqual(['e', 'a', 'c', 'd']);
    expect(undone).toHaveLength(withE.length);
    const c = undone.find((r) => r.placeId === 'c')!;
    expect(c.notes).toBe('new');
    expect(c.comparisons).toEqual([
      { opponentId: 'a__restaurants', result: 0, at: 60 },
      { opponentId: 'd__restaurants', result: 1, at: 700 },
    ]);
  });

  it('puts a spot that was #1 back at the top', () => {
    const moved = reorderSpot(list, 'a__restaurants', 'c__restaurants', 500)!;
    const undone = undoReorder(moved.restaurants.filter((r) => r.placeId !== 'b'), moved.undo)!;
    expect(ids(undone)).toEqual(['a', 'c', 'd']);
  });

  it('does nothing once the spot is gone from that list', () => {
    const moved = reorderSpot(list, 'c__restaurants', 'a__restaurants', 500)!;
    expect(undoReorder(moved.restaurants.filter((r) => r.placeId !== 'c'), moved.undo)).toBeNull();
  });
});

/** Puts the restaurants list in this order, adding plain spots for unknown place IDs */
function inOrder(all: RestaurantEntry[], order: string[]): RestaurantEntry[] {
  const list = order.map((p, i) => ({ ...(all.find((r) => r.placeId === p) ?? spot(p, 9.5, 0)), rankIndex: i }));
  return recomputeAllCategoryScores([...all.filter((r) => r.category !== 'restaurants'), ...list]);
}

describe('restoreSpot', () => {
  it('puts a deleted spot back at its rank without undoing later edits', () => {
    const deleted = spot('b', 7, 1);
    const afterDelete = [spot('a', 9, 0), spot('c', 5, 1)];
    // Something else changed before Undo
    const edited = [afterDelete[0], { ...afterDelete[1], notes: 'edited' }];
    const restored = restoreSpot(edited, deleted);
    expect(ids(restored)).toEqual(['a', 'b', 'c']);
    expect(restored.find((r) => r.placeId === 'c')?.notes).toBe('edited');
  });

  it('appends when the list got shorter than its old rank', () => {
    expect(ids(restoreSpot([spot('a', 9, 0)], spot('z', 3, 5)))).toEqual(['a', 'z']);
  });
});

import { describe, expect, it } from 'vitest';
import { fitScoresToOrder, recomputeMagicScores } from '../rankingEngine';
import type { RestaurantEntry } from '../../types';
import {
  answerMergeQuestion,
  bucketsFor,
  finishMerge,
  mergeDone,
  mergeOrder,
  nextMergeQuestion,
  startBucketMerge,
  startJellyMerge,
  startMerge,
} from './merge';
import { estimateScores, listAccuracy, nextToRate, ratingOrder } from './scores';
import type { MergeState } from './types';

const keys = (n: number, p = 'k') => Array.from({ length: n }, (_, i) => `${p}${i}`);

/** Answers every question from hidden true scores; returns the final state and the count */
function answerAll(state: MergeState, truth: Record<string, number>) {
  let s = state;
  let asked = 0;
  for (let q = nextMergeQuestion(s); q; q = nextMergeQuestion(s)) {
    s = answerMergeQuestion(s, truth[q.candidate] > truth[q.other] ? 'candidate' : 'other', asked);
    asked++;
    if (asked > 10_000) throw new Error('runaway');
  }
  return { s, asked };
}

let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

describe('bucketsFor', () => {
  it('splits by the bounds, missing bounds meaning "no such bucket"', () => {
    expect(bucketsFor(5, { firstFine: 2, firstDisliked: 4 })).toEqual(['liked', 'liked', 'fine', 'fine', 'disliked']);
    expect(bucketsFor(3, {})).toEqual(['liked', 'liked', 'liked']);
    expect(bucketsFor(3, { firstFine: 2, firstDisliked: 1 })).toEqual(['liked', 'disliked', 'disliked']);
  });
});

describe('merging sorted runs', () => {
  it('recovers the true order exactly from realistic overlapping buckets', () => {
    for (let trial = 0; trial < 20; trial++) {
      const truth: Record<string, number> = {};
      const all = keys(120).map((k) => ((truth[k] = 1 + 9 * rnd()), k));
      // Bucket from a noisy reading, each bucket sorted: Beli's export order
      const bucket = (k: string) => (truth[k] + (rnd() - 0.5) * 2 > 6.5 ? 0 : truth[k] + (rnd() - 0.5) * 2 > 3.5 ? 1 : 2);
      const runs: string[][] = [[], [], []];
      all.forEach((k) => runs[bucket(k)].push(k));
      runs.forEach((r) => r.sort((a, b) => truth[b] - truth[a]));
      const exportOrder = runs.flat();
      const guts = Object.fromEntries(exportOrder.map((k) => [k, truth[k] + (rnd() - 0.5)]));
      const { s } = answerAll(
        startBucketMerge(exportOrder, { firstFine: runs[0].length, firstDisliked: runs[0].length + runs[1].length }, estimateScores(exportOrder, guts)),
        truth
      );
      expect(mergeDone(s)).toBe(true);
      expect(mergeOrder(s)).toEqual([...all].sort((a, b) => truth[b] - truth[a]));
    }
  });

  it('takes ~2 questions per spot when the estimates are right, far fewer than ranking from scratch', () => {
    const base = keys(100, 'a');
    const run = keys(50, 'b');
    const truth: Record<string, number> = {};
    base.forEach((k, i) => (truth[k] = 10 - i * 0.09));
    run.forEach((k, i) => (truth[k] = 9.95 - i * 0.18));
    const { s, asked } = answerAll(startMerge(base, [{ stage: 'fine', keys: run }], truth), truth);
    expect(mergeOrder(s)).toEqual([...base, ...run].sort((a, b) => truth[b] - truth[a]));
    expect(asked).toBeLessThanOrEqual(2 * 50);
    // Without estimates (all equal) it still gets there, by galloping
    const blind = answerAll(startMerge(base, [{ stage: 'fine', keys: run }], {}), truth);
    expect(mergeOrder(blind.s)).toEqual(mergeOrder(s));
  });

  it('asks one question when a whole run belongs below', () => {
    const truth = { a: 9, b: 8, c: 3, d: 2 };
    const { asked, s } = answerAll(startMerge(['a', 'b'], [{ stage: 'fine', keys: ['c', 'd'] }], truth), truth);
    expect(mergeOrder(s)).toEqual(['a', 'b', 'c', 'd']);
    expect(asked).toBe(1); // c loses to b, so it and every worse spot of its run (d) go below
  });

  it('a tie puts the candidate just below; finishMerge places the rest by estimate', () => {
    let s = startMerge(['a', 'b', 'c'], [{ stage: 'fine', keys: ['x', 'y'] }], { a: 9, b: 7, c: 5, x: 8, y: 4 });
    expect(nextMergeQuestion(s)).toMatchObject({ candidate: 'x', other: 'b', remaining: 2 });
    s = answerMergeQuestion(s, 'tie', 1);
    expect(s.merged).toEqual(['a', 'b', 'x', 'c']);
    expect(mergeOrder(s)).toEqual(['a', 'b', 'x', 'c', 'y']);
    expect(finishMerge(s).pending).toEqual([]);
    expect(s.answers).toEqual([{ candidate: 'x', other: 'b', result: 0.5, at: 1 }]);
  });

  it('jelly merge: shared spots need no question and bound their neighbours', () => {
    // Jelly: J1 > S > J2; Beli: b1 > S(shared, row key "s") > b2. Truth puts b1 above J1.
    const truth: Record<string, number> = { J1: 8, S: 7, J2: 5, b1: 9, b2: 6 };
    const state = startJellyMerge(['b1', 's', 'b2'], ['J1', 'S', 'J2'], { s: 'S' }, { J1: 8, S: 7, J2: 5, b1: 9, b2: 6 });
    const { s, asked } = answerAll(state, truth);
    expect(mergeOrder(s)).toEqual(['b1', 'J1', 'S', 'b2', 'J2']);
    expect(s.answers.some((a) => a.candidate === 'S' || a.other === 'S' && a.candidate === 's')).toBe(false);
    expect(asked).toBeLessThanOrEqual(4);
  });

  it('inserts the shorter list into the longer one', () => {
    const state = startJellyMerge(keys(10, 'b'), ['J1', 'J2'], {}, {});
    expect(state.merged).toHaveLength(10);
    expect(state.pending[0].keys).toEqual(['J1', 'J2']);
  });
});

describe('rating order and accuracy', () => {
  it('asks #1, last, middle, then the middle of each gap, covering every spot once', () => {
    expect(ratingOrder(9)).toEqual([0, 8, 4, 2, 6, 1, 3, 5, 7]);
    for (const n of [0, 1, 2, 3, 50, 301]) expect([...ratingOrder(n)].sort((a, b) => a - b)).toEqual([...Array(n).keys()]);
    expect(nextToRate(['a', 'b', 'c'], { a: 9 })).toEqual(['c', 'b']);
  });

  it('the typical error shrinks as ratings come in', () => {
    const order = keys(60);
    const truth = order.map((_, i) => 9.5 - i * 0.08);
    const errors = [3, 10, 30, 60].map((count) => {
      const rated = new Set(ratingOrder(60).slice(0, count));
      const guts = Object.fromEntries(order.flatMap((k, i) => (rated.has(i) ? [[k, truth[i]]] : [])));
      return listAccuracy(order, guts).typicalError;
    });
    errors.slice(1).forEach((e, i) => expect(e).toBeLessThan(errors[i]));
    expect(listAccuracy(order, {})).toMatchObject({ rated: 0, total: 60, typicalError: Infinity });
  });

  it('is not overconfident with a few ratings on a long list (simulated truth: ~0.75 after 4)', () => {
    const order = keys(300);
    const guts = Object.fromEntries(ratingOrder(300).slice(0, 4).map((i) => [order[i], 9 - i * 0.015]));
    expect(listAccuracy(order, guts).typicalError).toBeGreaterThan(0.6);
  });
});

describe('spots without a gut rating', () => {
  it('get their score from the order and their rated neighbours, never a guess', () => {
    const fit = fitScoresToOrder([9, null, null, 6, null, 3]);
    fit.slice(1).forEach((v, i) => expect(v).toBeLessThanOrEqual(fit[i] + 1e-9));
    expect(fit[1]).toBeLessThan(fit[0]);
    expect(fit[1]).toBeGreaterThan(fit[3]);
    expect(fit[4]).toBeGreaterThan(fit[5]);
  });

  it('recomputeMagicScores treats a missing initialRating as unknown', () => {
    const e = (id: string, initialRating?: number) =>
      ({ id, name: id, formattedAddress: '', category: 'restaurants', categories: [], cuisines: [], initialRating, rankIndex: 0, magicScore: 0, comparisonsCount: 0, createdAt: 0, updatedAt: 0 }) as RestaurantEntry;
    const list = recomputeMagicScores([e('a', 9), e('b'), e('c', 5)]);
    expect(list[1].initialRating).toBeUndefined();
    expect(list[1].magicScore).toBeLessThan(list[0].magicScore);
    expect(list[1].magicScore).toBeGreaterThan(list[2].magicScore);
  });

  it('a list with no ratings at all still scores (flat around the default center)', () => {
    const fit = fitScoresToOrder([null, null, null]);
    expect(fit.every((v) => v > 5 && v < 9)).toBe(true);
  });
});

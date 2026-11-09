import { describe, expect, it } from 'vitest';
import type { RestaurantEntry } from '../../types';
import { recomputeMagicScores, spectrumRatingToPct } from '../rankingEngine';
import {
  answerBoundaryQuestion,
  boundaryMergeDone,
  bucketsFor,
  continueBoundary,
  mergedOrder,
  nextBoundaryQuestion,
  startBoundaryMerge,
} from './boundaryMerge';
import { interpolateGuts, presetAnchors, suggestAnchors } from './scores';
import type { Anchor, BoundaryAnswer, BoundaryMergeState } from './types';

const keys = (n: number, p = 'k') => Array.from({ length: n }, (_, i) => `${p}${i}`);

/** Answers every question from a hidden true order (lower index = better) */
function runWithTruth(state: BoundaryMergeState, truth: string[], maxQuestions = 1000) {
  const rank = new Map(truth.map((k, i) => [k, i]));
  let s = state;
  let asked = 0;
  for (let q = nextBoundaryQuestion(s); q || s.paused; q = nextBoundaryQuestion(s)) {
    if (!q) {
      s = continueBoundary(s);
      continue;
    }
    if (++asked > maxQuestions) break;
    const answer: BoundaryAnswer = rank.get(q.lower)! < rank.get(q.upper)! ? 'lower' : 'upper';
    s = answerBoundaryQuestion(s, answer, 1);
  }
  return { state: s, asked };
}

describe('bucketsFor', () => {
  it('splits by the bounds, with missing bounds meaning "no such bucket"', () => {
    expect(bucketsFor(5, { firstFine: 2, firstDisliked: 4 })).toEqual(['liked', 'liked', 'fine', 'fine', 'disliked']);
    expect(bucketsFor(3, {})).toEqual(['liked', 'liked', 'liked']);
    expect(bucketsFor(3, { firstDisliked: 1 })).toEqual(['liked', 'disliked', 'disliked']);
    expect(bucketsFor(3, { firstFine: 2, firstDisliked: 1 })).toEqual(['liked', 'disliked', 'disliked']);
    expect(bucketsFor(2, { firstFine: 0 })).toEqual(['fine', 'fine']);
  });
});

describe('boundary merge', () => {
  it('asks one question when Beli got the boundary right', () => {
    const order = [...keys(10, 'L'), ...keys(5, 'F')];
    const s = startBoundaryMerge(order, { firstFine: 10 });
    expect(nextBoundaryQuestion(s)).toMatchObject({ lower: 'F0', upper: 'L9', boundary: 1, asked: 0 });
    const done = answerBoundaryQuestion(s, 'upper', 1);
    expect(boundaryMergeDone(done)).toBe(true);
    expect(mergedOrder(done)).toEqual(order);
    expect(done.answers).toEqual([{ lower: 'F0', upper: 'L9', result: 0, at: 1 }]);
  });

  it('recovers the true order when fine spots beat the bottom of liked', () => {
    const liked = keys(20, 'L');
    const fine = keys(10, 'F');
    // True order: F0 and F1 sit among the bottom liked spots, F2 just below L19
    const truth = [...liked.slice(0, 15), 'F0', ...liked.slice(15, 18), 'F1', ...liked.slice(18), ...fine.slice(2)];
    const { state, asked } = runWithTruth(startBoundaryMerge([...liked, ...fine], { firstFine: 20 }), truth);
    expect(mergedOrder(state)).toEqual(truth);
    expect(asked).toBeLessThanOrEqual(12);
  });

  it('merges all three buckets, including a disliked spot above some fine ones', () => {
    const order = [...keys(6, 'L'), ...keys(6, 'F'), ...keys(4, 'D')];
    const truth = ['L0', 'L1', 'L2', 'L3', 'F0', 'L4', 'L5', 'F1', 'F2', 'F3', 'D0', 'F4', 'F5', 'D1', 'D2', 'D3'];
    const { state } = runWithTruth(startBoundaryMerge(order, { firstFine: 6, firstDisliked: 12 }), truth);
    expect(mergedOrder(state)).toEqual(truth);
  });

  it('finds the top of the list for a fine spot better than everything (galloping)', () => {
    const liked = keys(64, 'L');
    const truth = ['F0', ...liked];
    const { state, asked } = runWithTruth(startBoundaryMerge([...liked, 'F0'], { firstFine: 64 }), truth);
    expect(mergedOrder(state)).toEqual(truth);
    expect(asked).toBeLessThanOrEqual(14);
  });

  it('pauses at the cap, keeps Beli order for what is unanswered, and resumes', () => {
    const liked = keys(64, 'L');
    let s = startBoundaryMerge([...liked, 'F0'], { firstFine: 64 }, { cap: 3 });
    for (let i = 0; i < 3; i++) s = answerBoundaryQuestion(s, 'lower');
    expect(s.paused).toBe(true);
    expect(nextBoundaryQuestion(s)).toBeNull();
    // Galloping, F0 beat L63, L61 and L57: it goes just above L57 for now
    expect(mergedOrder(s).indexOf('F0')).toBe(57);
    s = continueBoundary(s);
    expect(nextBoundaryQuestion(s)).toMatchObject({ asked: 3, cap: 6 });
  });

  it('skip stops this boundary but still asks the next one; tie places just below', () => {
    const order = ['L0', 'L1', 'F0', 'F1', 'D0'];
    let s = startBoundaryMerge(order, { firstFine: 2, firstDisliked: 4 });
    s = answerBoundaryQuestion(s, 'skip');
    expect(nextBoundaryQuestion(s)).toMatchObject({ lower: 'D0', upper: 'F1', boundary: 2 });
    s = answerBoundaryQuestion(s, 'tie');
    expect(boundaryMergeDone(s)).toBe(true);
    expect(mergedOrder(s)).toEqual(['L0', 'L1', 'F0', 'F1', 'D0']);
    expect(s.answers[0].result).toBe(0.5);
  });

  it('handles lists with no liked spots or a single bucket', () => {
    expect(mergedOrder(startBoundaryMerge(['a', 'b'], { firstFine: 0 }))).toEqual(['a', 'b']);
    expect(nextBoundaryQuestion(startBoundaryMerge(['a', 'b', 'c'], {}))).toBeNull();
    const noLiked = startBoundaryMerge(['F0', 'D0'], { firstFine: 0, firstDisliked: 1 });
    expect(nextBoundaryQuestion(noLiked)).toMatchObject({ lower: 'D0', upper: 'F0', boundary: 2 });
  });
});

describe('suggestAnchors', () => {
  it('asks about every spot of tiny lists and #1, middle, last otherwise', () => {
    expect(suggestAnchors(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(suggestAnchors(keys(9))).toEqual(['k0', 'k4', 'k8']);
    expect(suggestAnchors(keys(9), 'more')).toEqual(['k0', 'k2', 'k4', 'k6', 'k8']);
  });

  it('uses the last liked spot instead of the median when buckets are known', () => {
    const order = keys(10);
    const buckets = Object.fromEntries(order.map((k, i) => [k, i < 7 ? 'liked' : 'fine'] as const));
    expect(suggestAnchors(order, 'quick', buckets)).toEqual(['k0', 'k6', 'k9']);
    expect(suggestAnchors(order, 'more', buckets)).toEqual(['k0', 'k2', 'k4', 'k6', 'k7', 'k9']);
  });
});

function scored(order: string[], guts: Record<string, number>): RestaurantEntry[] {
  return recomputeMagicScores(
    order.map((id) => ({ id, name: id, formattedAddress: '', category: 'restaurants', categories: [], cuisines: [], initialRating: guts[id], rankIndex: 0, magicScore: 0, comparisonsCount: 0, createdAt: 0, updatedAt: 0 }))
  );
}

const user = (key: string, rating: number): Anchor => ({ key, rating, source: 'user' });

describe('interpolateGuts', () => {
  for (const linear of [false, true]) {
    describe(linear ? 'linear scale' : 'non-linear scale', () => {
      const order = keys(41);
      const anchors = [user('k0', 9.4), user('k20', 7.2), user('k40', 3.5)];
      const guts = interpolateGuts(order, anchors, { linear });

      it('keeps anchors as rated and the rest non-increasing', () => {
        expect(guts.k0).toBe(9.4);
        expect(guts.k20).toBe(7.2);
        expect(guts.k40).toBe(3.5);
        const values = order.map((k) => guts[k]);
        values.slice(1).forEach((v, i) => expect(v).toBeLessThanOrEqual(values[i]));
      });

      it('interpolates evenly in spectrum-% space', () => {
        const mid = (spectrumRatingToPct(9.4, linear) + spectrumRatingToPct(7.2, linear)) / 2;
        expect(spectrumRatingToPct(guts.k10, linear)).toBeCloseTo(mid, 0);
      });

      it('preserves the order and stays near the anchors after recomputeMagicScores', () => {
        const list = scored(order, guts);
        expect(list.map((r) => r.id)).toEqual(order);
        list.slice(1).forEach((r, i) => expect(r.magicScore).toBeLessThanOrEqual(list[i].magicScore));
        expect(Math.abs(list[0].magicScore - 9.4)).toBeLessThan(0.6);
        expect(Math.abs(list[20].magicScore - 7.2)).toBeLessThan(0.4);
        expect(Math.abs(list[40].magicScore - 3.5)).toBeLessThan(0.6);
      });
    });
  }

  it('the two scales differ between anchors (the bar is not linear in rating)', () => {
    const order = keys(3);
    const anchors = [user('k0', 10), user('k2', 1)];
    expect(interpolateGuts(order, anchors, { linear: true }).k1).toBe(5.5);
    expect(interpolateGuts(order, anchors, { linear: false }).k1).not.toBe(5.5);
  });

  it('flattens contradicting anchors instead of bending back up', () => {
    const guts = interpolateGuts(keys(5), [user('k0', 6), user('k2', 9), user('k4', 3)]);
    // The ratings given are kept; the spots between follow the flattened curve (6 and 9 pooled to ~7.5)
    expect([guts.k0, guts.k2, guts.k4]).toEqual([6, 9, 3]);
    expect(guts.k1).toBeGreaterThan(6);
    expect(guts.k1).toBeLessThan(9);
    expect(guts.k3).toBeLessThan(guts.k1);
  });

  it('uses the preset past the user anchors and when there are none', () => {
    const order = keys(11);
    const onlyTop = interpolateGuts(order, [user('k0', 9.6)]);
    expect(onlyTop.k0).toBe(9.6);
    expect(onlyTop.k10).toBe(4.5);
    const none = interpolateGuts(order, []);
    expect([none.k0, none.k5, none.k10]).toEqual([9, 7, 4.5]);
  });

  it('existing jelly spots work as anchors, but user anchors win at the same spot', () => {
    const guts = interpolateGuts(keys(5), [
      { key: 'k0', rating: 9, source: 'existing' },
      { key: 'k4', rating: 5, source: 'existing' },
      { key: 'k4', rating: 4, source: 'user' },
    ]);
    expect(guts.k4).toBe(4);
    expect(guts.k2).toBeLessThan(9);
    expect(guts.k2).toBeGreaterThan(4);
  });

  it('bucket presets descend through each bucket', () => {
    const order = keys(6);
    const buckets = Object.fromEntries(order.map((k, i) => [k, i < 3 ? 'liked' : i < 5 ? 'fine' : 'disliked'] as const));
    expect(presetAnchors(order, buckets).map((a) => [a.key, a.rating])).toEqual([
      ['k0', 9.2],
      ['k2', 6.0],
      ['k3', 5.9],
      ['k4', 4.0],
      ['k5', 3.9],
    ]);
    const guts = interpolateGuts(order, [], { buckets });
    expect(guts.k1).toBeGreaterThan(6);
    expect(guts.k1).toBeLessThan(9.2);
  });

  it('handles empty and one-spot lists', () => {
    expect(interpolateGuts([], [])).toEqual({});
    expect(interpolateGuts(['a'], [])).toEqual({ a: 8 });
  });
});

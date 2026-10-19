import { describe, expect, it } from 'vitest';
import {
  appendComparisons,
  applyCheckAnswer,
  collectJudgments,
  dragComparisons,
  findOrderConflicts,
  pickCheck,
} from './comparisonHistory';
import { toSharedEntry } from './categoryLists';
import {
  getBestInsertionIndex,
  getPlacementElo,
  initSxSSearch,
  pickNextOpponent,
  ratingToBaseElo,
  recomputeMagicScores,
  recordSxSComparison,
} from './rankingEngine';
import { RestaurantEntry, StoredComparison } from '../types';

function spot(id: string, score: number, rankIndex: number, comparisons?: StoredComparison[]): RestaurantEntry {
  return {
    id,
    name: id,
    formattedAddress: '',
    category: 'restaurants',
    categories: ['restaurants'],
    cuisines: [],
    initialRating: score,
    elo: ratingToBaseElo(score),
    rankIndex,
    magicScore: score,
    comparisonsCount: 0,
    rankedHistory: [{ timestamp: 100, initialRating: score }],
    comparisons,
    createdAt: 100,
    updatedAt: 100,
  };
}

/** A..E at 8.0, 7.9, 7.8, 7.7, 7.6 */
const ladder = (eComparisons?: StoredComparison[]) =>
  ['A', 'B', 'C', 'D', 'E'].map((id, i) => spot(id, 8 - i * 0.1, i, id === 'E' ? eComparisons : undefined));

const beat = (opponentId: string, at = 200): StoredComparison => ({ opponentId, result: 1, at });
const lost = (opponentId: string, at = 200): StoredComparison => ({ opponentId, result: 0, at });

describe('comparison history', () => {
  it('keeps only the latest answer per opponent', () => {
    const e = appendComparisons(spot('E', 7, 0, [beat('A', 200)]), [lost('A', 300), beat('B', 300)]);
    expect(e.comparisons).toEqual([lost('A', 300), beat('B', 300)]);
  });

  it('ignores answers older than either spot’s last re-rank, and spots that are gone', () => {
    const list = ladder([beat('A', 50), beat('B', 200), beat('Z', 200)]);
    expect(collectJudgments(list).map((j) => j.b)).toEqual(['B']);
  });

  it('flags a spot the answers say is ranked too low', () => {
    const conflicts = findOrderConflicts(ladder([beat('A'), beat('B'), beat('C')]));
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].below.id).toBe('E');
  });

  it('flags a spot that beat several places far above it, rather than calling them all slips', () => {
    const list = Array.from({ length: 12 }, (_, i) => spot(`s${i}`, 9.5 - i * 0.3, i));
    list[11] = { ...list[11], comparisons: [beat('s3'), beat('s4'), beat('s5')] };
    expect(findOrderConflicts(list).some((c) => c.below.id === 's11')).toBe(true);
  });

  it('flags nothing when the answers agree with the order', () => {
    expect(findOrderConflicts(ladder([lost('A'), lost('B'), lost('C')]))).toEqual([]);
  });

  it('never re-flags a pair you answered directly in favour of the current order', () => {
    const list = ladder([beat('A'), beat('B'), beat('C')]).map((e) =>
      e.id === 'A' ? { ...e, comparisons: [beat('E', 300)] } : e
    );
    expect(findOrderConflicts(list).some((c) => c.above.id === 'A' && c.below.id === 'E')).toBe(false);
  });

  it('moves the lower spot up when you confirm a conflict, and leaves the order when you don’t', () => {
    const list = ladder([beat('A'), beat('B'), beat('C')]);
    const [conflict] = findOrderConflicts(list);
    const confirmed = applyCheckAnswer(list, conflict, 'below_wins', 300);
    expect(confirmed.findIndex((e) => e.id === conflict.below.id)).toBeLessThan(
      confirmed.findIndex((e) => e.id === conflict.above.id)
    );
    const rejected = applyCheckAnswer(list, conflict, 'above_wins', 300);
    expect(rejected.map((e) => e.id)).toEqual(list.map((e) => e.id));
    expect(rejected.find((e) => e.id === conflict.below.id)!.comparisons).toContainEqual({
      opponentId: conflict.above.id,
      result: 0,
      at: 300,
    });
  });

  it('treats a drag as overriding earlier answers, so it is never flagged', () => {
    // E had lost to A–C; dragging E to the top says otherwise
    const list = ladder([lost('A'), lost('B'), lost('C')]);
    const moved = appendComparisons(list[4], dragComparisons(list, 4, 0, 300));
    const dragged = recomputeMagicScores([moved, ...list.slice(0, 4)]);
    expect(findOrderConflicts(dragged)).toEqual([]);
  });

  it('keeps the answer history out of shared lists', () => {
    expect('comparisons' in toSharedEntry(spot('A', 8, 0, [beat('B')]))).toBe(false);
  });
});

/**
 * Builds lists the way the app does (one placement at a time, noisy simulated answers stored),
 * then answers the order checks with the same noisy user.
 */
describe('order checks with simulated noisy users', () => {
  function mulberry32(seed: number) {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('flags real misorders and fixes most clearly wrong pairs', () => {
    let flagged = 0;
    let real = 0;
    let before = 0;
    let after = 0;
    for (let trial = 0; trial < 6; trial++) {
      const rand = mulberry32(300 + trial);
      const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
      const quality = new Map<string, number>();
      const prefers = (a: string, b: string): 0 | 0.5 | 1 =>
        rand() < 0.02 ? (rand() < 0.5 ? 1 : 0) : quality.get(a)! - quality.get(b)! + 0.3 * gauss() > 0 ? 1 : 0;
      const clearlyWrong = (l: RestaurantEntry[]) =>
        l.reduce(
          (n, e, i) => n + l.slice(i + 1).filter((f) => quality.get(f.id)! - quality.get(e.id)! > 0.5).length,
          0
        );

      let list: RestaurantEntry[] = [];
      for (let t = 0; t < 40; t++) {
        const id = `s${t}`;
        quality.set(id, Math.max(1, Math.min(10, 7 + 1.4 * gauss())));
        const gut = Math.round(Math.max(1, Math.min(10, quality.get(id)! + 0.8 * gauss())) * 10) / 10;
        let state = initSxSSearch(list, gut);
        for (let m = pickNextOpponent(state, list); m; m = pickNextOpponent(state, list)) {
          state = recordSxSComparison(state, m.opponentIndex, m.opponent, prefers(id, m.opponent.id) ? 'new_wins' : 'opponent_wins');
        }
        const idx = list.length ? getBestInsertionIndex(state).insertIndex : 0;
        const entry = spot(id, gut, idx, state.history.map((h) => ({
          opponentId: h.opponentId,
          result: h.outcome === 'new_wins' ? 1 : 0,
          at: 1000 + t,
        })));
        entry.elo = list.length ? getPlacementElo(state, list, idx) : entry.elo;
        entry.rankedHistory = [{ timestamp: 1000 + t, initialRating: gut }];
        list.splice(idx, 0, entry);
        list = recomputeMagicScores(list);
      }

      for (const c of findOrderConflicts(list)) {
        flagged++;
        if (quality.get(c.below.id)! > quality.get(c.above.id)!) real++;
      }
      before += clearlyWrong(list);
      for (let s = 0; s < 10; s++) {
        const c = pickCheck(findOrderConflicts(list));
        if (!c) break;
        const r = prefers(c.below.id, c.above.id);
        list = recomputeMagicScores(applyCheckAnswer(list, c, r ? 'below_wins' : 'above_wins', 5000 + s));
      }
      after += clearlyWrong(list);
    }
    expect(flagged).toBeGreaterThan(0);
    expect(real / flagged).toBeGreaterThan(0.85);
    expect(after).toBeLessThan(0.75 * before);
  });
});

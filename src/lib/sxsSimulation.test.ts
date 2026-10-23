import { describe, expect, it } from 'vitest';
import {
  getBestInsertionIndex,
  initSxSSearch,
  pickNextOpponent,
  recordSxSComparison,
} from './rankingEngine';
import { RestaurantEntry } from '../types';

/**
 * Simulated users placing a new spot: every spot has a hidden true quality, gut feelings are off
 * by ~0.8 points, preferences are blurry (0.3 points) and 2% of answers are slips. Guards the
 * search's accuracy and question count against regressions.
 */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulate(n: number, trials: number, seed: number) {
  const rand = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const clamp = (x: number) => Math.max(1, Math.min(10, x));
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const quality = () => clamp(7 + 1.4 * gauss());

  let noticeable = 0;
  let questions = 0;
  for (let t = 0; t < trials; t++) {
    const q = Array.from({ length: n }, quality).sort((a, b) => b - a);
    const scores = q.map((x) => r1(clamp(x + 0.2 * gauss()))).sort((a, b) => b - a);
    const list: RestaurantEntry[] = q.map((_, i) => ({
      id: `s${i}`,
      name: `s${i}`,
      formattedAddress: '',
      category: 'restaurants',
      categories: ['restaurants'],
      cuisines: [],
      initialRating: scores[i],
      rankIndex: i,
      magicScore: scores[i],
      comparisonsCount: 0,
      createdAt: 0,
      updatedAt: 0,
    }));
    const qc = quality();
    let state = initSxSSearch(list, r1(clamp(qc + 0.8 * gauss())));
    for (let m = pickNextOpponent(state, list); m; m = pickNextOpponent(state, list)) {
      const diff = qc - q[m.opponentIndex] + 0.3 * gauss();
      const slip = rand() < 0.02;
      const newWins = slip ? rand() < 0.5 : diff > 0;
      state = recordSxSComparison(state, m.opponentIndex, m.opponent, newWins ? 'new_wins' : 'opponent_wins');
    }
    const placed = getBestInsertionIndex(state).insertIndex;
    const trueGap = q.filter((x) => x > qc).length;
    for (let i = Math.min(placed, trueGap); i < Math.max(placed, trueGap); i++) {
      if (Math.abs(q[i] - qc) > 0.5) noticeable++; // a misorder you'd actually notice
    }
    questions += state.completedComparisons;
  }
  return { noticeable: noticeable / trials, questions: questions / trials };
}

describe('side-by-side search with simulated noisy users', () => {
  it('rarely misorders clearly different places on a 40-spot list', () => {
    const { noticeable, questions } = simulate(40, 150, 7);
    expect(noticeable).toBeLessThan(0.06); // the old 5-question search: ~0.23
    expect(questions).toBeLessThan(9);
  });

  it('stays accurate on a 150-spot list within the question cap', () => {
    const { noticeable, questions } = simulate(150, 60, 11);
    expect(noticeable).toBeLessThan(0.06);
    expect(questions).toBeLessThanOrEqual(12);
  });
});

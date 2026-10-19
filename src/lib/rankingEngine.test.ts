import { describe, expect, it } from 'vitest';
import {
  getBestInsertionIndex,
  getPlacementElo,
  initSxSSearch,
  pctToSpectrumRating,
  pickNextOpponent,
  ratingToBaseElo,
  recomputeMagicScores,
  recordSxSComparison,
  spectrumRatingToPct,
} from './rankingEngine';
import { RestaurantEntry, SpotCategory } from '../types';

function makeDummySpot(
  id: string,
  name: string,
  initialRating: number,
  rankIndex: number,
  category: SpotCategory = 'restaurants',
  cuisines: string[] = ['Italian']
): RestaurantEntry {
  return {
    id,
    name,
    formattedAddress: '123 Main St',
    category,
    categories: [category],
    cuisines,
    initialRating,
    elo: ratingToBaseElo(initialRating),
    rankIndex,
    magicScore: initialRating,
    comparisonsCount: 3,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

describe('rankingEngine (ELO-based)', () => {
  it('enforces monotonic ELO and 1-10 magic scores even when gut ratings have inversions', () => {
    const list: RestaurantEntry[] = [
      makeDummySpot('1', 'Spot One (Preferred in SxS)', 8, 0),
      makeDummySpot('2', 'Spot Two (Higher gut rating, lost SxS)', 9, 1),
      makeDummySpot('3', 'Spot Three', 7, 2),
      makeDummySpot('4', 'Spot Four', 6, 3),
    ];

    const scored = recomputeMagicScores(list);
    expect(scored.length).toBe(4);
    expect(scored[0].elo).toBeGreaterThan(scored[1].elo);
    expect(scored[1].elo).toBeGreaterThan(scored[2].elo);
    expect(scored[2].elo).toBeGreaterThan(scored[3].elo);

    expect(scored[0].magicScore).toBeGreaterThanOrEqual(scored[1].magicScore);
    expect(scored[1].magicScore).toBeGreaterThanOrEqual(scored[2].magicScore);
    expect(scored[2].magicScore).toBeGreaterThanOrEqual(scored[3].magicScore);
  });

  it('updates ELO and converges to #1 slot when winning SxS comparisons', () => {
    const existing = recomputeMagicScores([
      makeDummySpot('1', 'Best Place', 9, 0),
      makeDummySpot('2', 'Great Place', 8, 1),
      makeDummySpot('3', 'Good Place', 7, 2),
      makeDummySpot('4', 'Okay Place', 6, 3),
      makeDummySpot('5', 'Meh Place', 5, 4),
    ]);

    let state = initSxSSearch(existing, 9, ['Italian']);
    const initialElo = state.candidateElo;

    const firstPick = pickNextOpponent(state, existing);
    expect(firstPick).not.toBeNull();
    expect(firstPick!.opponentIndex).toBeLessThanOrEqual(2);

    while (true) {
      const next = pickNextOpponent(state, existing);
      if (!next) break;
      state = recordSxSComparison(state, next.opponentIndex, next.opponent, 'new_wins');
    }

    const { insertIndex } = getBestInsertionIndex(state);
    expect(insertIndex).toBe(0);
    expect(state.candidateElo).toBeGreaterThan(initialElo);
  });

  it('prioritizes same-cuisine tags (e.g. Japanese) during SxS comparisons', () => {
    const existing = recomputeMagicScores([
      makeDummySpot('1', 'Top Sushi', 9.5, 0, 'restaurants', ['Japanese', 'Sushi']),
      makeDummySpot('2', 'French Bistro', 9.0, 1, 'restaurants', ['French']),
      makeDummySpot('3', 'Steakhouse', 8.6, 2, 'restaurants', ['Steakhouse']),
      makeDummySpot('4', 'Ramen Bar', 8.2, 3, 'restaurants', ['Japanese', 'Ramen']),
      makeDummySpot('5', 'Trattoria', 7.8, 4, 'restaurants', ['Italian']),
    ]);

    let state = initSxSSearch(existing, 8.6, ['Japanese']);
    const firstPick = pickNextOpponent(state, existing);
    expect(firstPick).not.toBeNull();
    // Even though index 2 (Steakhouse) is the exact midpoint, index 3 (Ramen Bar) or index 0 (Top Sushi) is Japanese and should be picked first!
    expect(firstPick!.opponent.cuisines).toContain('Japanese');
  });

  it('recovers from a slip instead of locking the wrong half of the list out', () => {
    const existing = recomputeMagicScores(
      Array.from({ length: 20 }, (_, i) => makeDummySpot(`${i}`, `Spot ${i}`, 9.5 - i * 0.25, i, 'restaurants', []))
    );
    // The new spot truly belongs right below #3 (index 2); the first answer is a slip
    const trueGap = 3;
    let state = initSxSSearch(existing, 7.5);
    let slipped = false;
    for (let next = pickNextOpponent(state, existing); next; next = pickNextOpponent(state, existing)) {
      let outcome: 'new_wins' | 'opponent_wins' = trueGap <= next.opponentIndex ? 'new_wins' : 'opponent_wins';
      if (!slipped) {
        outcome = outcome === 'new_wins' ? 'opponent_wins' : 'new_wins';
        slipped = true;
      }
      state = recordSxSComparison(state, next.opponentIndex, next.opponent, outcome);
    }
    expect(Math.abs(getBestInsertionIndex(state).insertIndex - trueGap)).toBeLessThanOrEqual(1);
  });

  it('keeps asking past five questions on a long list when answers are still informative', () => {
    const existing = recomputeMagicScores(
      Array.from({ length: 200 }, (_, i) => makeDummySpot(`${i}`, `Spot ${i}`, 9.9 - i * 0.04, i, 'restaurants', []))
    );
    let state = initSxSSearch(existing, 6);
    const trueGap = 57;
    for (let next = pickNextOpponent(state, existing); next; next = pickNextOpponent(state, existing)) {
      state = recordSxSComparison(
        state,
        next.opponentIndex,
        next.opponent,
        trueGap <= next.opponentIndex ? 'new_wins' : 'opponent_wins'
      );
    }
    expect(state.completedComparisons).toBeGreaterThan(5);
    expect(state.completedComparisons).toBeLessThanOrEqual(12);
    expect(Math.abs(getBestInsertionIndex(state).insertIndex - trueGap)).toBeLessThanOrEqual(3);
  });

  it('squeezes the Elo of an overruled answer between its new neighbours', () => {
    const existing = recomputeMagicScores([
      makeDummySpot('1', 'Best', 9, 0),
      makeDummySpot('2', 'Good', 7, 1),
      makeDummySpot('3', 'Meh', 5, 2),
    ]);
    const state = { ...initSxSSearch(existing, 7), candidateElo: 5000 };
    const elo = getPlacementElo(state, existing, 2);
    expect(elo).toBeLessThan(existing[1].elo);
    expect(elo).toBeGreaterThan(existing[2].elo);
  });

  it('maps tier boundaries to their bar shares with 5.0 in the middle of Mid, and supports linear fallback', () => {
    // Skip 0–16%, Mid 16–37%, Good 37–61%, Great 61–88%, Incredible 88–100%
    expect(pctToSpectrumRating(0.0, false)).toBe(1.0);
    expect(pctToSpectrumRating(0.16, false)).toBe(4.0);
    expect(pctToSpectrumRating(0.265, false)).toBe(5.0);
    expect(pctToSpectrumRating(0.37, false)).toBe(6.0);
    expect(pctToSpectrumRating(0.61, false)).toBe(7.5);
    expect(pctToSpectrumRating(0.88, false)).toBe(8.8);
    expect(pctToSpectrumRating(1.0, false)).toBe(10.0);

    expect(spectrumRatingToPct(5.0, false)).toBeCloseTo(26.5, 1);
    expect(spectrumRatingToPct(7.5, false)).toBeCloseTo(61, 1);

    // Linear mode
    expect(pctToSpectrumRating(0.5, true)).toBe(5.5);
    expect(spectrumRatingToPct(5.5, true)).toBeCloseTo(50, 1);
  });
});

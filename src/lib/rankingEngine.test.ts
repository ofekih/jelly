import { describe, expect, it } from 'vitest';
import {
  getBestInsertionIndex,
  initSxSSearch,
  pctToSpectrumRating,
  pickNextOpponent,
  ratingToBaseElo,
  recomputeMagicScores,
  recordSxSComparison,
  spectrumRatingToPct,
} from './rankingEngine';
import { MealCategory, RestaurantEntry } from '../types';

function makeDummySpot(
  id: string,
  name: string,
  initialRating: number,
  rankIndex: number,
  meal: MealCategory = 'Dinner',
  cuisines: string[] = ['Italian']
): RestaurantEntry {
  return {
    id,
    name,
    formattedAddress: '123 Main St',
    meal,
    meals: [meal],
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

    let state = initSxSSearch(existing, 9, 'Dinner', ['Italian']);
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

  it('always compares against at least one same-meal spot above and one same-meal spot below when they exist', () => {
    // Mixed-meal list where Dinner spots are separated by Breakfast, Coffee, and Lunch spots
    const existing = recomputeMagicScores([
      makeDummySpot('1', 'Top Dinner', 9.6, 0, 'Dinner'),
      makeDummySpot('2', 'Top Breakfast', 9.2, 1, 'Breakfast'),
      makeDummySpot('3', 'Great Coffee', 8.8, 2, 'Coffee'),
      makeDummySpot('4', 'Good Lunch', 8.4, 3, 'Lunch'),
      makeDummySpot('5', 'Mid Dinner', 8.0, 4, 'Dinner'),
      makeDummySpot('6', 'Lower Dinner', 7.2, 5, 'Dinner'),
    ]);

    // Candidate is a Dinner spot with gut rating 8.6 (sits between Top Dinner at 0 and Mid Dinner at 4)
    let state = initSxSSearch(existing, 8.6, 'Dinner', ['Italian']);

    while (true) {
      const next = pickNextOpponent(state, existing);
      if (!next) break;
      // Candidate loses to spots ranked 0..2 and beats spots ranked 3..5
      const outcome = next.opponentIndex <= 2 ? 'opponent_wins' : 'new_wins';
      state = recordSxSComparison(state, next.opponentIndex, next.opponent, outcome);
    }

    const { insertIndex } = getBestInsertionIndex(state);
    expect(insertIndex).toBe(3);

    const comparedSet = new Set(state.comparedIndices);
    // Must have compared against the Dinner spot above insertIndex (index 0: Top Dinner)
    expect(comparedSet.has(0)).toBe(true);
    // Must have compared against the Dinner spot below insertIndex (index 4: Mid Dinner)
    expect(comparedSet.has(4)).toBe(true);
  });

  it('prioritizes same-cuisine tags (e.g. Japanese) during SxS comparisons', () => {
    const existing = recomputeMagicScores([
      makeDummySpot('1', 'Top Sushi', 9.5, 0, 'Dinner', ['Japanese', 'Sushi']),
      makeDummySpot('2', 'French Bistro', 9.0, 1, 'Dinner', ['French']),
      makeDummySpot('3', 'Steakhouse', 8.6, 2, 'Dinner', ['Steakhouse']),
      makeDummySpot('4', 'Ramen Bar', 8.2, 3, 'Dinner', ['Japanese', 'Ramen']),
      makeDummySpot('5', 'Trattoria', 7.8, 4, 'Dinner', ['Italian']),
    ]);

    let state = initSxSSearch(existing, 8.6, 'Dinner', ['Japanese']);
    const firstPick = pickNextOpponent(state, existing);
    expect(firstPick).not.toBeNull();
    // Even though index 2 (Steakhouse) is the exact midpoint, index 3 (Ramen Bar) or index 0 (Top Sushi) is Japanese and should be picked first!
    expect(firstPick!.opponent.cuisines).toContain('Japanese');
  });

  it('maps 5 equal visual divisions with 5.0 at the center of Mid (30%), and supports linear fallback', () => {
    // 5 equal 20% divisions: Skip (0-20%), Mid (20-40%), Good (40-60%), Great (60-80%), Incredible (80-100%)
    expect(pctToSpectrumRating(0.0, false)).toBe(1.0);
    expect(pctToSpectrumRating(0.2, false)).toBe(4.0);
    expect(pctToSpectrumRating(0.3, false)).toBe(5.0); // Center of Mid!
    expect(pctToSpectrumRating(0.4, false)).toBe(6.0);
    expect(pctToSpectrumRating(0.6, false)).toBe(7.5);
    expect(pctToSpectrumRating(0.8, false)).toBe(8.8);
    expect(pctToSpectrumRating(1.0, false)).toBe(10.0);

    expect(spectrumRatingToPct(5.0, false)).toBeCloseTo(30, 1);
    expect(spectrumRatingToPct(7.5, false)).toBeCloseTo(60, 1);

    // Linear mode
    expect(pctToSpectrumRating(0.5, true)).toBe(5.5);
    expect(spectrumRatingToPct(5.5, true)).toBeCloseTo(50, 1);
  });
});

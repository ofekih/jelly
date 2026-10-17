import { describe, expect, it } from 'vitest';
import {
  getBestInsertionIndex,
  initSxSSearch,
  pickNextOpponent,
  ratingToBaseElo,
  recomputeMagicScores,
  recordSxSComparison,
} from './rankingEngine';
import { RestaurantEntry } from '../types';

function makeDummySpot(
  id: string,
  name: string,
  initialRating: number,
  rankIndex: number
): RestaurantEntry {
  return {
    id,
    name,
    formattedAddress: '123 Main St',
    meal: 'Dinner',
    meals: ['Dinner'],
    cuisines: ['Italian'],
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
});

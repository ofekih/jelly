import { describe, expect, it } from 'vitest';
import { isFilterActive, matchesSpotFilters, sortByDistance, SpotFilters } from './spotFilters';

const NONE: SpotFilters = {
  category: 'restaurants',
  city: 'ALL',
  cuisine: 'ALL',
  players: 'ALL',
  maxMinutes: 'ALL',
  query: '',
};

const spot = (over: Partial<Parameters<typeof matchesSpotFilters>[0]> = {}) => ({
  name: 'Kin Khao',
  formattedAddress: '55 Cyril Magnin St',
  city: 'San Francisco',
  category: 'restaurants' as const,
  cuisines: ['Thai'],
  ...over,
});

describe('matchesSpotFilters', () => {
  it('keeps only the open list', () => {
    expect(matchesSpotFilters(spot(), NONE)).toBe(true);
    expect(matchesSpotFilters(spot({ category: 'bars' }), NONE)).toBe(false);
  });

  it('filters by city and tag', () => {
    expect(matchesSpotFilters(spot(), { ...NONE, city: 'Oakland' })).toBe(false);
    expect(matchesSpotFilters(spot(), { ...NONE, cuisine: 'Thai' })).toBe(true);
    expect(matchesSpotFilters(spot(), { ...NONE, cuisine: 'Pizza' })).toBe(false);
  });

  it('searches name, address, city and tags case-insensitively', () => {
    for (const query of ['kin', 'CYRIL', 'francisco', 'thai ']) {
      expect(matchesSpotFilters(spot(), { ...NONE, query })).toBe(true);
    }
    expect(matchesSpotFilters(spot(), { ...NONE, query: 'sushi' })).toBe(false);
  });

  it('applies player and time limits to board games only', () => {
    const game = spot({ category: 'board_games', media: { players: [2, 4], time: [60, 90] } });
    const games: SpotFilters = { ...NONE, category: 'board_games' };
    expect(matchesSpotFilters(game, { ...games, players: 3, maxMinutes: 60 })).toBe(true);
    expect(matchesSpotFilters(game, { ...games, players: 5 })).toBe(false);
    expect(matchesSpotFilters(game, { ...games, maxMinutes: 30 })).toBe(false);
    expect(matchesSpotFilters(spot(), { ...NONE, players: 5 })).toBe(true);
  });
});

describe('isFilterActive', () => {
  it('ignores game-night limits outside board games', () => {
    expect(isFilterActive(NONE)).toBe(false);
    expect(isFilterActive({ ...NONE, players: 3 })).toBe(false);
    expect(isFilterActive({ ...NONE, category: 'board_games', players: 3 })).toBe(true);
    expect(isFilterActive({ ...NONE, query: '  ' })).toBe(false);
    expect(isFilterActive({ ...NONE, city: 'Oakland' })).toBe(true);
  });
});

describe('sortByDistance', () => {
  const here = { lat: 37.7749, lng: -122.4194 };
  it('puts nearest first and spots without coordinates last, in tiebreak order', () => {
    type P = { id: string; rank: number; lat?: number; lng?: number };
    const spots: P[] = [
      { id: 'a', rank: 2 },
      { id: 'far', rank: 0, lat: 40.71, lng: -74.0 },
      { id: 'b', rank: 1 },
      { id: 'near', rank: 0, lat: 37.78, lng: -122.42 },
    ];
    const sorted = sortByDistance(spots, here, (x, y) => x.rank - y.rank);
    expect(sorted.map((s) => s.id)).toEqual(['near', 'far', 'b', 'a']);
  });
});

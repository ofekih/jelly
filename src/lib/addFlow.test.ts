import { describe, expect, it } from 'vitest';
import type { PlaceCandidate, RestaurantEntry, SpotCategory } from '../types';
import { categoryOptions, entryToCandidate, findRankedInGroup, moveTargetsFor, searchCategoryFor } from './addFlow';

const place = (over: Partial<PlaceCandidate> = {}): PlaceCandidate => ({
  placeId: 'gp1',
  name: 'Casa Verde',
  formattedAddress: '1 Main St',
  categories: ['restaurants', 'bars'],
  cuisines: ['Mexican'],
  source: 'google_places',
  ...over,
});

const entry = (category: SpotCategory, rankIndex: number, magicScore: number, over: Partial<RestaurantEntry> = {}) =>
  ({
    id: `gp1__${category}`,
    placeId: 'gp1',
    name: 'Casa Verde',
    formattedAddress: '1 Main St',
    category,
    cuisines: [],
    initialRating: magicScore,
    rankIndex,
    magicScore,
    comparisonsCount: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as RestaurantEntry;

describe('addFlow', () => {
  it('starts a search in the viewed list, or the group’s first list elsewhere', () => {
    expect(searchCategoryFor('eat', 'bars')).toBe('bars');
    expect(searchCategoryFor('watch', 'bars')).toBe('movies');
  });

  it('offers detected lists plus the searched one; title sources only their own', () => {
    expect(categoryOptions(place(), 'coffee_tea')).toEqual(['restaurants', 'bars', 'coffee_tea']);
    const movie = place({ placeId: 'tmdb:movie:1', categories: ['movies'], source: 'tmdb' });
    expect(categoryOptions(movie, 'tv_shows')).toEqual(['movies']);
  });

  it('finds your entry in the group, preferring the best-guess list', () => {
    const list = [entry('bars', 0, 9.1), entry('restaurants', 3, 7.2), entry('museums', 0, 8, { id: 'x' })];
    expect(findRankedInGroup(place(), 'restaurants', list)?.category).toBe('restaurants');
    expect(findRankedInGroup(place({ categories: ['coffee_tea'] }), 'coffee_tea', list)?.category).toBe('bars');
    expect(findRankedInGroup(place({ placeId: 'other', name: 'Else' }), 'restaurants', list)).toBeUndefined();
  });

  it('turns an entry into a candidate with its own list first', () => {
    const c = entryToCandidate({ ...entry('bars', 0, 9), categories: ['restaurants', 'bars'] });
    expect(c.categories).toEqual(['bars', 'restaurants']);
    expect(c.source).toBe('google_places');
  });

  it('offers the other lists of the group that do not hold the spot yet', () => {
    const targets = moveTargetsFor(entry('bakeries', 0, 8), [entry('bakeries', 0, 8), entry('brunch', 0, 7)]);
    expect(targets).toContain('coffee_tea');
    expect(targets).not.toContain('bakeries');
    expect(targets).not.toContain('brunch');
    expect(targets).not.toContain('museums');
  });

  it('only lets books move between lists, not movies, shows or games', () => {
    const book = entry('fiction', 0, 8, { id: 'book:x:y__fiction', placeId: 'book:x:y' });
    expect(moveTargetsFor(book, [book])).toEqual(['nonfiction']);
    const movie = entry('movies', 0, 8, { id: 'tmdb:movie:1__movies', placeId: 'tmdb:movie:1' });
    expect(moveTargetsFor(movie, [movie])).toEqual([]);
  });
});

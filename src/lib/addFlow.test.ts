import { describe, expect, it } from 'vitest';
import type { PlaceCandidate, RestaurantEntry, SpotCategory } from '../types';
import {
  addsRankingNote,
  categoryOptions,
  entryToCandidate,
  findRankedInGroup,
  listsToAddTo,
  moveTargetsFor,
  rankingsInGroup,
  searchCategoryFor,
} from './addFlow';

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

  it('lists your rankings of a spot in list order, only within its group', () => {
    const list = [entry('coffee_tea', 2, 7), entry('bakeries', 0, 8), entry('museums', 0, 9, { id: 'm' })];
    expect(rankingsInGroup(place(), 'eat', list).map((r) => r.category)).toEqual(['bakeries', 'coffee_tea']);
    expect(rankingsInGroup(place({ placeId: 'other', name: 'Else' }), 'eat', list)).toEqual([]);
  });

  it('offers the lists of the group that hold no ranking of the spot', () => {
    const rankings = [entry('bakeries', 0, 8), entry('coffee_tea', 2, 7)];
    const targets = listsToAddTo('gp1', 'eat', rankings);
    expect(targets).toContain('brunch');
    expect(targets).not.toContain('bakeries');
    expect(targets).not.toContain('coffee_tea');
    expect(listsToAddTo('tmdb:movie:1', 'watch', [])).toEqual([]);
  });

  it('says the existing rankings stay as they are', () => {
    expect(addsRankingNote([entry('bakeries', 0, 8)])).toBe(
      'This adds a separate ranking—your Bakeries ranking stays as it is.'
    );
    expect(addsRankingNote([entry('bakeries', 0, 8), entry('coffee_tea', 2, 7)])).toBe(
      'This adds a separate ranking—your Bakeries and Coffee & Tea rankings stay as they are.'
    );
  });
});

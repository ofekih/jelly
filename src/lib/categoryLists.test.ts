import { describe, expect, it } from 'vitest';
import {
  getCategoryList,
  isFromNewerVersion,
  isLegacyDoc,
  legacyMealToCategory,
  loadBookmarks,
  loadRestaurants,
  staleDerivedScores,
} from './categoryLists';
import { autoCategorizePlace } from './categorizer';
import { fitCandidatesToGroup } from './placesService';
import { PlaceCandidate, SpotCategory } from '../types';

function legacySpot(id: string, name: string, meal: string, rankIndex: number, extra: any = {}) {
  return {
    id: `${id}__${meal}`,
    placeId: id,
    name,
    formattedAddress: '1 Main St',
    meal,
    meals: [meal],
    cuisines: [],
    initialRating: 8,
    rankIndex,
    magicScore: 8,
    comparisonsCount: 0,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

describe('legacy meal migration', () => {
  it('maps legacy meals to the new category lists', () => {
    expect(legacyMealToCategory('Dinner', {})).toBe('restaurants');
    expect(legacyMealToCategory('Lunch', {})).toBe('restaurants');
    expect(legacyMealToCategory('Breakfast', { name: 'Pancake House' })).toBe('brunch');
    expect(legacyMealToCategory('Breakfast', { name: 'Tartine Bakery' })).toBe('bakeries');
    expect(legacyMealToCategory('Coffee', {})).toBe('coffee_tea');
    expect(legacyMealToCategory('Dessert', {})).toBe('dessert');
    expect(legacyMealToCategory('Drinks', {})).toBe('bars');
  });

  it('splits a global ranking into separate lists, keeping relative order and the higher-ranked duplicate', () => {
    const loaded = loadRestaurants([
      legacySpot('a', 'A', 'Dinner', 0),
      legacySpot('b', 'B', 'Coffee', 1),
      legacySpot('c', 'C', 'Lunch', 2),
      legacySpot('a', 'A', 'Lunch', 3, { initialRating: 5 }), // same place, also -> restaurants
      legacySpot('d', 'D', 'Dinner', 4),
    ]);

    const restaurants = getCategoryList(loaded, 'restaurants');
    expect(restaurants.map((r) => r.name)).toEqual(['A', 'C', 'D']);
    expect(restaurants.map((r) => r.rankIndex)).toEqual([0, 1, 2]);
    expect(restaurants[0].initialRating).toBe(8); // higher-ranked duplicate kept
    expect(restaurants[0].id).toBe('a__restaurants');

    const coffee = getCategoryList(loaded, 'coffee_tea');
    expect(coffee.map((r) => [r.name, r.rankIndex])).toEqual([['B', 0]]);

    for (const r of loaded) {
      expect(isLegacyDoc(r)).toBe(false);
      expect('meal' in r).toBe(false);
    }
  });
});

describe('autoCategorizePlace', () => {
  it('detects the new categories from Google types', () => {
    expect(autoCategorizePlace({ name: 'Blue Bottle', primaryType: 'coffee_shop' }).categories[0]).toBe(
      'coffee_tea'
    );
    expect(autoCategorizePlace({ name: 'Boba Guys', types: ['store'] }).categories[0]).toBe('coffee_tea');
    expect(autoCategorizePlace({ name: 'Tartine', primaryType: 'bakery' }).categories[0]).toBe('bakeries');
    expect(autoCategorizePlace({ name: 'The Bar', primaryType: 'cocktail_bar' }).categories[0]).toBe('bars');
    expect(
      autoCategorizePlace({ name: 'Italian Place', primaryType: 'italian_restaurant', servesDinner: true })
        .categories[0]
    ).toBe('restaurants');
    expect(
      autoCategorizePlace({
        name: 'Morning Spot',
        primaryType: 'american_restaurant',
        servesBreakfast: true,
        servesLunch: true,
      }).categories[0]
    ).toBe('brunch');
  });
});

describe('docs from a newer version of jelly', () => {
  const futureSpot = {
    id: 'x__space_stations',
    placeId: 'x',
    name: 'ISS',
    formattedAddress: 'Low Earth orbit',
    category: 'space_stations',
    cuisines: [],
    initialRating: 9,
    rankIndex: 0,
    magicScore: 9,
    comparisonsCount: 0,
    createdAt: 0,
    updatedAt: 0,
  };

  it('are never treated as legacy docs (so they are never migrated or deleted)', () => {
    expect(isFromNewerVersion(futureSpot)).toBe(true);
    expect(isLegacyDoc(futureSpot)).toBe(false);
    expect(isFromNewerVersion(legacySpot('a', 'A', 'Dinner', 0))).toBe(false);
    expect(isFromNewerVersion({ ...futureSpot, category: 'museums' })).toBe(false);
  });

  it('are left out of the loaded lists', () => {
    const loaded = loadRestaurants([futureSpot, { ...futureSpot, id: 'y__museums', placeId: 'y', category: 'museums' }]);
    expect(loaded.map((r) => r.id)).toEqual(['y__museums']);
    expect(loadBookmarks([futureSpot])).toEqual([]);
  });
});

describe('autoCategorizePlace for Explore & Travel', () => {
  it('detects sights and tags their subtype', () => {
    const moma = autoCategorizePlace({ name: 'SFMOMA', primaryType: 'art_museum', types: ['museum', 'tourist_attraction'] });
    expect(moma.categories[0]).toBe('museums');
    expect(moma.cuisines).toContain('Art');

    const disney = autoCategorizePlace({ name: 'Disneyland Park', primaryType: 'amusement_park', types: ['park'] });
    expect(disney.categories).toEqual(['theme_parks', 'nature']);
    expect(autoCategorizePlace({ name: 'Monterey Bay Aquarium', types: ['aquarium'] }).cuisines).toEqual(['Aquarium']);
    expect(autoCategorizePlace({ name: 'Yosemite', primaryType: 'national_park' }).categories[0]).toBe('nature');
  });

  it('gives landmarks without a list no default (instead of Restaurants)', () => {
    expect(autoCategorizePlace({ name: 'Alcatraz', types: ['tourist_attraction', 'historical_landmark'] }).categories).toEqual([]);
    expect(autoCategorizePlace({ name: 'Ferry Building', types: ['tourist_attraction', 'food'] }).categories[0]).toBe('restaurants');
  });

  it('splits destinations into countries, cities and getaways, tagged by country & continent', () => {
    const italy = autoCategorizePlace({ name: 'Italy', types: ['country', 'political'], countryCode: 'IT', countryName: 'Italy' });
    expect(italy.categories).toEqual(['countries']);
    expect(italy.cuisines).toEqual(['Europe']);

    const rome = autoCategorizePlace({
      name: 'Rome',
      types: ['locality', 'political'],
      countryCode: 'IT',
      countryName: 'Italy',
      viewportDiagonalKm: 45,
    });
    expect(rome.categories).toEqual(['cities']);
    expect(rome.cuisines).toEqual(['Italy', 'Europe']);

    const positano = autoCategorizePlace({
      name: 'Positano',
      types: ['locality', 'political'],
      countryCode: 'IT',
      countryName: 'Italy',
      viewportDiagonalKm: 3,
    });
    expect(positano.categories).toEqual(['getaways']);

    expect(autoCategorizePlace({ name: 'Santorini', types: ['natural_feature'], countryCode: 'GR' }).categories[0]).toBe(
      'getaways'
    );
  });

  it('puts places to stay in Hotels & Stays, tagged by kind, country & continent', () => {
    const resort = autoCategorizePlace({
      name: 'Four Seasons Resort Maui',
      primaryType: 'resort_hotel',
      types: ['resort_hotel', 'lodging', 'restaurant', 'spa'],
      countryCode: 'US',
      countryName: 'United States',
    });
    expect(resort.categories).toEqual(['stays']);
    expect(resort.cuisines).toEqual(['Resort', 'United States', 'North America']);
    expect(autoCategorizePlace({ name: 'Hostel One', primaryType: 'hostel', types: ['hostel', 'lodging'] }).cuisines).toEqual([
      'Hostel',
    ]);
    expect(autoCategorizePlace({ name: 'Old Inn', types: ['lodging'] }).categories).toEqual(['stays']);
    // A hotel's restaurant is a restaurant
    expect(
      autoCategorizePlace({ name: 'Hotel Bistro', primaryType: 'french_restaurant', types: ['french_restaurant', 'lodging'] })
        .categories[0]
    ).toBe('restaurants');
  });
});

describe('fitCandidatesToGroup', () => {
  const cand = (name: string, categories: SpotCategory[]): PlaceCandidate => ({
    placeId: name,
    name,
    formattedAddress: '',
    categories,
    cuisines: [],
    source: 'google_places',
  });

  it('drops places that only fit other groups and orders in-group lists first', () => {
    const fitted = fitCandidatesToGroup(
      [cand('Nopa', ['restaurants']), cand('Disneyland', ['nature', 'theme_parks']), cand('Alcatraz', []), cand('Rome', ['cities'])],
      'explore'
    );
    expect(fitted.map((c) => c.name)).toEqual(['Disneyland', 'Alcatraz']);
    expect(fitted[0].categories).toEqual(['nature', 'theme_parks']);
  });
});

describe('staleDerivedScores', () => {
  const stored = (id: string, rankIndex: number, initialRating: number, magicScore: number) => ({
    id,
    placeId: id,
    name: id,
    formattedAddress: '',
    category: 'restaurants',
    categories: ['restaurants'],
    cuisines: [],
    initialRating,
    rankIndex,
    magicScore,
    createdAt: 0,
    updatedAt: 0,
  });

  it('flags only docs whose stored scores no longer match the recomputed ones', () => {
    const raws = [stored('a__restaurants', 0, 9, 0), stored('b__restaurants', 1, 6, 0)];
    const loaded = loadRestaurants(raws);
    const byId = new Map<string, any>(raws.map((r) => [r.id, r]));
    const stale = staleDerivedScores(byId, loaded);
    expect(stale.map((s) => s.id)).toEqual(['a__restaurants', 'b__restaurants']);
    expect(stale[0].fields).toEqual({
      magicScore: loaded[0].magicScore,
      rankIndex: 0,
    });

    // Once written back, nothing is stale
    const healed = new Map<string, any>(loaded.map((r) => [r.id, { ...r }]));
    expect(staleDerivedScores(healed, loadRestaurants([...healed.values()]))).toEqual([]);
  });
});

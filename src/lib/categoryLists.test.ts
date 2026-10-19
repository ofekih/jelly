import { describe, expect, it } from 'vitest';
import { getCategoryList, isLegacyDoc, legacyMealToCategory, loadRestaurants } from './categoryLists';
import { autoCategorizePlace } from './categorizer';

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
    elo: 1700 - rankIndex * 20,
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

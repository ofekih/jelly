import { describe, expect, it } from 'vitest';
import { BookmarkEntry, RestaurantEntry } from '../types';
import { buildPublicLists, MAX_PUBLIC_ITEMS } from './publicList';

const spot = (i: number, notes = ''): RestaurantEntry =>
  ({
    id: `p${i}__restaurants`,
    placeId: `p${i}`,
    name: `Spot ${i}`,
    formattedAddress: '',
    category: 'restaurants',
    categories: ['restaurants'],
    cuisines: [],
    initialRating: 8,
    rankIndex: i,
    magicScore: 8,
    notes: notes || undefined,
    comparisons: [{ opponentId: 'x', result: 'win', at: 1 }],
    createdAt: 0,
    updatedAt: 0,
  }) as unknown as RestaurantEntry;

const bookmark = (i: number, notes = ''): BookmarkEntry =>
  ({
    id: `b${i}`,
    name: `Saved ${i}`,
    formattedAddress: '',
    category: 'restaurants',
    notes: notes || undefined,
    createdAt: 0,
  }) as unknown as BookmarkEntry;

describe('buildPublicLists', () => {
  it('publishes everything (minus private answers) when it fits', () => {
    const out = buildPublicLists([spot(0, 'great'), spot(1)], [bookmark(0, 'try the soup')]);
    expect(out.trimmed).toBe('none');
    expect(out.restaurants).toHaveLength(2);
    expect(out.restaurants[0].notes).toBe('great');
    expect(out.restaurants[0].comparisons).toBeUndefined();
    expect(out.bookmarks[0].notes).toBe('try the soup');
  });

  it('drops bookmark notes, then spot notes, before dropping anything else', () => {
    const long = 'x'.repeat(1000);
    const spots = [spot(0, long), spot(1, long)];
    const saved = [bookmark(0, long), bookmark(1, long)];
    const one = buildPublicLists(spots, saved, 3500);
    expect(one.trimmed).toBe('bookmarkNotes');
    expect(one.bookmarks[0].notes).toBeUndefined();
    expect(one.restaurants[0].notes).toBe(long);

    const two = buildPublicLists(spots, saved, 1500);
    expect(two.trimmed).toBe('notes');
    expect(two.restaurants).toHaveLength(2);
    expect(two.restaurants[0].notes).toBeUndefined();
  });

  it('keeps the top-ranked spots when over the count limit', () => {
    const many = Array.from({ length: MAX_PUBLIC_ITEMS + 5 }, (_, i) => spot(MAX_PUBLIC_ITEMS + 4 - i));
    const out = buildPublicLists(many, []);
    expect(out.trimmed).toBe('spots');
    expect(out.restaurants).toHaveLength(MAX_PUBLIC_ITEMS);
    expect(out.restaurants[0].rankIndex).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { BookmarkEntry, RestaurantEntry } from '../types';
import { buildPublicLists } from './publicList';

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

  it('has no count limit: a long list is shared in full while it fits', () => {
    const many = Array.from({ length: 1200 }, (_, i) => spot(i));
    const out = buildPublicLists(many, []);
    expect(out.trimmed).toBe('none');
    expect(out.restaurants).toHaveLength(1200);
  });

  it('keeps the top-ranked spots of every list when too big even without notes', () => {
    const many = Array.from({ length: 40 }, (_, i) => spot(39 - i));
    const out = buildPublicLists(many, [], 2500);
    expect(out.trimmed).toBe('spots');
    expect(out.restaurants.length).toBeLessThan(40);
    expect(out.restaurants.map((r) => r.rankIndex)).toEqual(out.restaurants.map((_, i) => i));
  });
});

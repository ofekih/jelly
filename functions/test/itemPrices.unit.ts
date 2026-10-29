import { describe, expect, it } from 'vitest';
import { isStale, NO_PRICE_TTL_MS, parsePriceId, PRICE_TTL_MS } from '../src/itemPrices';

describe('item prices', () => {
  it('knows which place IDs have a price provider', () => {
    expect(parsePriceId('bgg:174430')).toEqual({ prefix: 'bgg', id: '174430' });
    expect(parsePriceId('igdb:1942')).toEqual({ prefix: 'igdb', id: '1942' });
    for (const id of ['tmdb:movie:5', 'book:x:y', 'ChIJabcdefghij', 'bgg:abc', 'xyz:5', undefined, 5]) {
      expect(parsePriceId(id)).toBeUndefined();
    }
  });

  it('refreshes found prices weekly and "nothing found" monthly', () => {
    const now = 10 ** 13;
    const found = { new: { amount: 1 } };
    expect(isStale(undefined, now)).toBe(true);
    expect(isStale({ ...found, fetchedAt: now - PRICE_TTL_MS + 1000 }, now)).toBe(false);
    expect(isStale({ ...found, fetchedAt: now - PRICE_TTL_MS - 1 }, now)).toBe(true);
    expect(isStale({ fetchedAt: now - PRICE_TTL_MS - 1 }, now)).toBe(false);
    expect(isStale({ fetchedAt: now - NO_PRICE_TTL_MS - 1 }, now)).toBe(true);
  });
});

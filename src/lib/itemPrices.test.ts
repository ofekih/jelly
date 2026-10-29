import { describe, expect, it } from 'vitest';
import { comparablePrice, hasPriceDoc, parseItemPrice, priceLine, priceParts } from './itemPrices';

describe('itemPrices', () => {
  it('knows which place IDs can have a price doc', () => {
    expect(hasPriceDoc('bgg:174430')).toBe(true);
    expect(hasPriceDoc('igdb:12')).toBe(true);
    expect(hasPriceDoc('book:weir:project-hail-mary')).toBe(true);
    for (const id of ['tmdb:movie:5', 'ChIJabc', 'book:a/b', undefined]) expect(hasPriceDoc(id)).toBe(false);
  });

  it('reads stored docs and treats "nothing found" as no price', () => {
    expect(parseItemPrice({ fetchedAt: 5 })).toBeNull();
    expect(parseItemPrice({ source: 'steam', new: { amount: 20, currency: 'USD', was: 40 }, fetchedAt: 5 })).toEqual({
      source: 'steam',
      new: { amount: 20, currency: 'USD', was: 40 },
    });
    expect(parseItemPrice({ new: { amount: 'x', currency: 'USD' } })).toBeNull();
    expect(parseItemPrice(undefined)).toBeNull();
  });

  it('formats new and used prices', () => {
    expect(priceParts({ new: { amount: 40, currency: 'USD' }, used: { low: 15, high: 27, count: 12, currency: 'USD' } })).toEqual([
      { label: 'New', text: '$40' },
      { label: 'Used', text: '$15–27' },
    ]);
    expect(priceParts({ used: { low: 20, high: 20, count: 5, currency: 'USD' } })).toEqual([{ label: 'Used', text: '$20' }]);
    expect(priceParts(null)).toEqual([]);
  });

  it('shows free and sale prices', () => {
    expect(priceParts({ new: { amount: 0, currency: 'USD' } })).toEqual([{ label: 'New', text: 'Free' }]);
    expect(priceParts({ new: { amount: 20, currency: 'USD', was: 40 } })).toEqual([{ label: 'New', text: '$20 (was $40)' }]);
  });

  it('calls a book\'s only price the ebook', () => {
    const book = { source: 'google_books' as const, new: { amount: 9.99, currency: 'USD', was: 14.99 } };
    expect(priceParts(book)).toEqual([{ label: 'Ebook', text: '$10 (was $15)' }]);
    expect(priceLine(book)).toBe('Ebook $10');
  });

  it('gives list rows one short line and filters one number', () => {
    const both = { new: { amount: 20, currency: 'USD', was: 40 }, used: { low: 5, high: 9, count: 4, currency: 'USD' } };
    expect(priceLine(both)).toBe('$20');
    expect(priceLine({ used: { low: 15, high: 27, count: 9, currency: 'USD' } })).toBe('Used $15–27');
    expect(priceLine(null)).toBe('');
    expect(comparablePrice(both)).toBe(20);
    expect(comparablePrice({ used: { low: 10, high: 20, count: 9, currency: 'USD' } })).toBe(15);
    expect(comparablePrice(null)).toBeUndefined();
  });
});

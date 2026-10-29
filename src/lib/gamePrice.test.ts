import { describe, expect, it } from 'vitest';
import { bggIdOf, gamePriceParts } from './gamePrice';

describe('gamePrice', () => {
  it('reads BGG ids only', () => {
    expect(bggIdOf('bgg:174430')).toBe('174430');
    expect(bggIdOf('igdb:12')).toBeUndefined();
    expect(bggIdOf('ChIJabc')).toBeUndefined();
    expect(bggIdOf(undefined)).toBeUndefined();
  });

  it('formats new and used prices', () => {
    expect(
      gamePriceParts({ new: { amount: 40, currency: 'USD' }, used: { low: 15, high: 27, count: 12, currency: 'USD' } })
    ).toEqual([
      { label: 'New', text: '$40' },
      { label: 'Used', text: '$15–27' },
    ]);
    expect(gamePriceParts({ used: { low: 20, high: 20, count: 5, currency: 'USD' } })).toEqual([{ label: 'Used', text: '$20' }]);
    expect(gamePriceParts(null)).toEqual([]);
  });
});

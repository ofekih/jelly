import { describe, expect, it } from 'vitest';
import { gamePriceParts, priceTarget } from './gamePrice';

describe('gamePrice', () => {
  it('finds the endpoint for BGG and IGDB games only', () => {
    expect(priceTarget('bgg:174430')).toEqual({ api: 'bgg', id: '174430' });
    expect(priceTarget('igdb:12')).toEqual({ api: 'igdb', id: '12' });
    expect(priceTarget('tmdb:movie:5')).toBeUndefined();
    expect(priceTarget('ChIJabc')).toBeUndefined();
    expect(priceTarget(undefined)).toBeUndefined();
  });

  it('shows free and sale prices', () => {
    expect(gamePriceParts({ new: { amount: 0, currency: 'USD' } })).toEqual([{ label: 'New', text: 'Free' }]);
    expect(gamePriceParts({ new: { amount: 20, currency: 'USD', was: 40 } })).toEqual([{ label: 'New', text: '$20 (was $40)' }]);
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

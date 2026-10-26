import { describe, expect, it } from 'vitest';
import {
  formatPrice,
  formatPriceRange,
  fromGooglePriceRange,
  isGooglePlaceId,
  mergePrice,
  parsePriceRange,
  priceTierLabel,
} from './price';

describe('priceTierLabel', () => {
  it('draws tiers with $ and 0 as Free', () => {
    expect(priceTierLabel(1)).toBe('$');
    expect(priceTierLabel(4)).toBe('$$$$');
    expect(priceTierLabel(0)).toBe('Free');
  });
  it('is empty for unknown or odd values', () => {
    expect(priceTierLabel(undefined)).toBe('');
    expect(priceTierLabel(5)).toBe('');
    expect(priceTierLabel(2.5)).toBe('');
  });
});

describe('fromGooglePriceRange', () => {
  it('maps Money objects to whole units', () => {
    expect(
      fromGooglePriceRange({
        startPrice: { currencyCode: 'USD', units: '20' },
        endPrice: { currencyCode: 'USD', units: '30' },
      })
    ).toEqual({ currency: 'USD', start: 20, end: 30 });
  });
  it('keeps an open-ended range ("$100+")', () => {
    expect(fromGooglePriceRange({ startPrice: { currencyCode: 'EUR', units: '100' } })).toEqual({
      currency: 'EUR',
      start: 100,
    });
  });
  it('treats a missing units field as 0 (proto default)', () => {
    expect(
      fromGooglePriceRange({ startPrice: { currencyCode: 'USD' }, endPrice: { currencyCode: 'USD', units: '10' } })
    ).toEqual({ currency: 'USD', start: 0, end: 10 });
  });
  it('rejects malformed input', () => {
    expect(fromGooglePriceRange(undefined)).toBeUndefined();
    expect(fromGooglePriceRange({})).toBeUndefined();
    expect(fromGooglePriceRange({ startPrice: { currencyCode: 'usd', units: '5' } })).toBeUndefined();
    expect(
      fromGooglePriceRange({
        startPrice: { currencyCode: 'USD', units: '30' },
        endPrice: { currencyCode: 'USD', units: '20' },
      })
    ).toBeUndefined();
  });
});

describe('parsePriceRange', () => {
  it('accepts valid stored ranges and drops unknown keys', () => {
    expect(parsePriceRange({ currency: 'JPY', start: 3000, end: 5000, extra: 1 })).toEqual({
      currency: 'JPY',
      start: 3000,
      end: 5000,
    });
  });
  it('rejects bad currencies, negatives and empty ranges', () => {
    expect(parsePriceRange({ currency: 'US', start: 1 })).toBeUndefined();
    expect(parsePriceRange({ currency: 'USD', start: -1 })).toBeUndefined();
    expect(parsePriceRange({ currency: 'USD' })).toBeUndefined();
    expect(parsePriceRange({ currency: 'USD', start: 2e9 })).toBeUndefined();
  });
});

describe('formatPriceRange', () => {
  it('uses one symbol and an unspaced en dash', () => {
    expect(formatPriceRange({ currency: 'USD', start: 20, end: 30 }, 'en-US')).toBe('$20–30');
    expect(formatPriceRange({ currency: 'EUR', start: 20, end: 30 }, 'en-US')).toBe('€20–30');
    expect(formatPriceRange({ currency: 'JPY', start: 1000, end: 2000 }, 'en-US')).toBe('¥1,000–2,000');
  });
  it('follows the locale when the symbol trails', () => {
    expect(formatPriceRange({ currency: 'EUR', start: 20, end: 30 }, 'de-DE')).toBe('20–30 €');
  });
  it('disambiguates other dollars for a US reader', () => {
    expect(formatPriceRange({ currency: 'CAD', start: 15, end: 25 }, 'en-US')).toBe('CA$15–25');
  });
  it('shows open and single-sided ranges', () => {
    expect(formatPriceRange({ currency: 'USD', start: 100 }, 'en-US')).toBe('$100+');
    expect(formatPriceRange({ currency: 'USD', end: 10 }, 'en-US')).toBe('Under $10');
    expect(formatPriceRange({ currency: 'USD', start: 10, end: 10 }, 'en-US')).toBe('$10');
  });
  it('is empty without a valid range', () => {
    expect(formatPriceRange(undefined)).toBe('');
    expect(formatPriceRange({ currency: 'XX' } as never)).toBe('');
  });
});

describe('formatPrice', () => {
  const range = { currency: 'USD', start: 20, end: 30 };
  it('shows the range alone when Google knows it', () => {
    expect(formatPrice({ priceLevel: 2, priceRange: range }, { locale: 'en-US' })).toBe('$20–30');
    expect(formatPrice({ priceRange: { currency: 'USD', start: 100 } }, { locale: 'en-US' })).toBe('$100+');
  });
  it('falls back to the tier', () => {
    expect(formatPrice({ priceLevel: 2 })).toBe('$$');
    expect(formatPrice({})).toBe('');
  });
  it('never shows a spend for a free spot', () => {
    expect(formatPrice({ priceLevel: 0, priceRange: range })).toBe('Free');
  });
});

describe('mergePrice', () => {
  const r1 = { currency: 'USD', start: 20, end: 30 };
  const r2 = { currency: 'USD', start: 30, end: 50 };
  it('takes everything fresh for a new spot', () => {
    expect(mergePrice(undefined, { priceLevel: 2, priceRange: r1 })).toEqual({ priceLevel: 2, priceRange: r1 });
  });
  it('keeps a stored tier and takes a fresh range only when it came with that tier', () => {
    expect(mergePrice({ priceLevel: 2 }, { priceLevel: 2, priceRange: r1 })).toEqual({ priceLevel: 2, priceRange: r1 });
    expect(mergePrice({ priceLevel: 3 }, { priceLevel: 2, priceRange: r1 })).toEqual({
      priceLevel: 3,
      priceRange: undefined,
    });
    expect(mergePrice({ priceLevel: 3, priceRange: r2 }, { priceLevel: 2, priceRange: r1 })).toEqual({
      priceLevel: 3,
      priceRange: r2,
    });
  });
  it('fills a missing tier from fresh data', () => {
    expect(mergePrice({}, { priceLevel: 1, priceRange: r1 })).toEqual({ priceLevel: 1, priceRange: r1 });
  });
  it('keeps the stored range when fresh data has none', () => {
    expect(mergePrice({ priceLevel: 2, priceRange: r1 }, { priceLevel: 2 })).toEqual({ priceLevel: 2, priceRange: r1 });
  });
});

describe('isGooglePlaceId', () => {
  it('accepts Google IDs and rejects others', () => {
    expect(isGooglePlaceId('ChIJN1t_tDeuEmsRUsoyG83frY4')).toBe(true);
    expect(isGooglePlaceId('manual_123_abcde')).toBe(false);
    expect(isGooglePlaceId('osm_N12345678901')).toBe(false);
    expect(isGooglePlaceId('tmdb:movie:550')).toBe(false);
    expect(isGooglePlaceId(undefined)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { googlePrice, locationAdjustedScore } from './placesService';

const LA = { lat: 34.05, lng: -118.24 };
const london = {
  name: 'Natural History Museum',
  formattedAddress: 'Cromwell Rd, South Kensington, London SW7 5BD, UK',
  lat: 51.496,
  lng: -0.176,
};
const losAngeles = {
  name: 'Natural History Museum of Los Angeles County',
  formattedAddress: '900 W Exposition Blvd, Los Angeles, CA 90007, USA',
  lat: 34.017,
  lng: -118.289,
};

describe('locationAdjustedScore', () => {
  it('drops a far-away namesake below a nearby match', () => {
    // Name scores for "natural history museum": exact (London) vs. prefix (LA)
    expect(locationAdjustedScore(120, london, 'natural history museum', LA)).toBeLessThan(
      locationAdjustedScore(100, losAngeles, 'natural history museum', LA)
    );
  });

  it('keeps the far place when the query names its area', () => {
    expect(locationAdjustedScore(63, london, 'natural history museum london', LA)).toBeGreaterThan(
      locationAdjustedScore(63, losAngeles, 'natural history museum london', LA)
    );
  });

  it('leaves scores alone without a location', () => {
    expect(locationAdjustedScore(120, london, 'natural history museum', null)).toBe(120);
  });
});

describe('googlePrice', () => {
  it('maps the tier enum (free included) and the per-person range', () => {
    expect(
      googlePrice({
        priceLevel: 'PRICE_LEVEL_MODERATE',
        priceRange: { startPrice: { currencyCode: 'USD', units: '20' }, endPrice: { currencyCode: 'USD', units: '30' } },
      })
    ).toEqual({ priceLevel: 2, priceRange: { currency: 'USD', start: 20, end: 30 } });
    expect(googlePrice({ priceLevel: 'PRICE_LEVEL_FREE' })).toEqual({ priceLevel: 0, priceRange: undefined });
    expect(googlePrice({ priceLevel: 'PRICE_LEVEL_UNSPECIFIED' })).toEqual({ priceLevel: undefined, priceRange: undefined });
    expect(googlePrice({})).toEqual({ priceLevel: undefined, priceRange: undefined });
  });
});

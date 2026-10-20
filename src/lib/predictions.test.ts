import { describe, expect, it } from 'vitest';
import { buildForYouSpots, googleMapsLinkFor, parsePredictionKey, parsePredictionsDoc } from './predictions';

const p = (score: number, extra: Record<string, unknown> = {}) => ({
  score,
  confidence: 'medium',
  basis: 'Based on 3 taste-matched jelly users',
  raters: 3,
  ...extra,
});

describe('parsePredictionsDoc places', () => {
  it('keeps the place payload, and predictions from older docs without one', () => {
    const parsed = parsePredictionsDoc({
      spots: {
        a__bars: p(8, { place: { name: 'Bar A', city: 'SF', lat: 1, lng: 2, cuisines: ['Wine Bar', 3] } }),
        b__bars: p(7),
        c__bars: p(7, { place: { city: 'no name' } }),
        d__bars: p(7, { place: { name: 'Half located', lat: 1 } }),
      },
    });
    expect(parsed.get('a__bars')!.place).toEqual({ name: 'Bar A', city: 'SF', neighborhood: undefined, lat: 1, lng: 2, cuisines: ['Wine Bar'] });
    expect(parsed.get('b__bars')!.place).toBeUndefined();
    expect(parsed.get('c__bars')!.place).toBeUndefined();
    expect(parsed.get('d__bars')!.place).not.toHaveProperty('lat');
  });
});

describe('parsePredictionKey', () => {
  it('splits on the last "__", and rejects unknown lists', () => {
    expect(parsePredictionKey('ChIJ__x_y__coffee_tea')).toEqual({ placeId: 'ChIJ__x_y', category: 'coffee_tea' });
    expect(parsePredictionKey('abc__spaceships')).toBeNull();
    expect(parsePredictionKey('__bars')).toBeNull();
    expect(parsePredictionKey('nokey')).toBeNull();
  });
});

describe('buildForYouSpots', () => {
  const predictions = parsePredictionsDoc({
    spots: {
      low__restaurants: p(7.1, { place: { name: 'Low', city: 'SF' } }),
      top__restaurants: p(9.2, { place: { name: 'Top', city: 'SF', neighborhood: 'Mission', lat: 37.7, lng: -122.4, cuisines: ['Thai'] } }),
      tieHigh__restaurants: p(8.0, { confidence: 'high', place: { name: 'Tie high' } }),
      tieMed__restaurants: p(8.0, { place: { name: 'Tie medium' } }),
      bar__bars: p(9.9, { place: { name: 'Other list' } }),
      ranked__restaurants: p(9.5, { place: { name: 'Already ranked', city: 'SF' } }),
      renamed__restaurants: p(9.4, { place: { name: 'Same Name', city: 'SF' } }),
      ownOnly__restaurants: p(9.6, { raters: 0, basis: 'Based on your 2 ranked Thai spots', place: { name: 'Mine' } }),
      old__restaurants: p(9.7),
    },
  });
  const ranked = [
    { placeId: 'ranked', name: 'Already ranked', category: 'restaurants' as const },
    { placeId: 'manual_1', name: 'Same Name', city: 'SF', category: 'restaurants' as const },
    { placeId: 'low', name: 'Low', city: 'SF', category: 'bars' as const },
  ];

  it('lists unranked spots in this list, best first, then by confidence', () => {
    const spots = buildForYouSpots(predictions, 'restaurants', ranked);
    expect(spots.map((s) => s.id)).toEqual(['top__restaurants', 'tieHigh__restaurants', 'tieMed__restaurants', 'low__restaurants']);
  });

  it('shapes each spot like a bookmark in that list', () => {
    const [top] = buildForYouSpots(predictions, 'restaurants', ranked);
    expect(top).toMatchObject({
      placeId: 'top',
      name: 'Top',
      formattedAddress: 'Mission, SF',
      lat: 37.7,
      lng: -122.4,
      category: 'restaurants',
      categories: ['restaurants'],
      cuisines: ['Thai'],
      googleMapsUri: googleMapsLinkFor('top', 'Top'),
      prediction: { score: 9.2, confidence: 'medium', raters: 3 },
    });
    expect(top.prediction).not.toHaveProperty('place');
  });

  it('treats a same-named spot in another city as a different spot', () => {
    const elsewhere = [{ name: 'The Top', city: 'LA', category: 'restaurants' as const }];
    expect(buildForYouSpots(predictions, 'restaurants', elsewhere).map((s) => s.name)).toContain('Top');
    const sameCity = [{ name: 'Top!', city: 'sf ', category: 'restaurants' as const }];
    expect(buildForYouSpots(predictions, 'restaurants', sameCity).map((s) => s.name)).not.toContain('Top');
  });

  it('only shows a list\'s own spots', () => {
    expect(buildForYouSpots(predictions, 'bars', ranked).map((s) => s.name)).toEqual(['Other list']);
    expect(buildForYouSpots(predictions, 'museums', ranked)).toEqual([]);
  });
});

describe('googleMapsLinkFor', () => {
  it('searches by name, pinned to the place ID', () => {
    expect(googleMapsLinkFor('ChIJ1', 'Café & Bar')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20%26%20Bar&query_place_id=ChIJ1'
    );
  });
});

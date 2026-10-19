import { describe, expect, it } from 'vitest';
import { homeCoords, resolveManualSpotCity } from './geo';

const tustin = { lat: 33.7376, lng: -117.8265, city: 'Tustin' };
const irvine = { lat: 33.6846, lng: -117.8265, city: 'Irvine' };
const sf = { lat: 37.7749, lng: -122.4194, city: 'San Francisco' };

describe('resolveManualSpotCity', () => {
  it('uses the city of the closest nearby spot when the user location is known', () => {
    expect(resolveManualSpotCity([sf, irvine, tustin], { lat: 33.74, lng: -117.83 }, 'Boston')).toBe(
      'Tustin'
    );
  });

  it('falls back to the default city when no known spot is nearby', () => {
    expect(resolveManualSpotCity([sf], { lat: 33.74, lng: -117.83 }, ' Boston ')).toBe('Boston');
  });

  it('falls back to the default city without a user location', () => {
    expect(resolveManualSpotCity([tustin], null, 'Boston')).toBe('Boston');
  });

  it('ignores spots without coordinates or a city', () => {
    const spots = [{ city: 'Nowhere' }, { lat: 33.74, lng: -117.83, city: '  ' }];
    expect(resolveManualSpotCity(spots, { lat: 33.74, lng: -117.83 })).toBe('');
  });
});

describe('homeCoords', () => {
  it('ignores a far-away trip and spots without coordinates', () => {
    const home = homeCoords([
      { lat: 33.7, lng: -117.9 },
      { lat: 33.8, lng: -117.8 },
      { lat: 34.0, lng: -118.2 },
      { lat: 51.5, lng: -0.1 },
      {},
    ]);
    expect(home!.lat).toBeCloseTo(33.9);
    expect(home!.lng).toBeCloseTo(-117.85);
  });

  it('returns null with no coordinates', () => {
    expect(homeCoords([{}])).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { resolveManualSpotCity } from './geo';

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

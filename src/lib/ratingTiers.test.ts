import { describe, expect, it } from 'vitest';
import { RATING_TIERS, getRatingTier, getVibeLabel } from './ratingTiers';
import { pctToSpectrumRating, spectrumRatingToPct } from './rankingEngine';

describe('ratingTiers', () => {
  it('tiers and bands ascend, and each tier starts at its first band', () => {
    let prev = 0;
    for (const tier of RATING_TIERS) {
      expect(tier.bands[0].from).toBe(tier.from);
      for (const band of tier.bands) {
        expect(band.from).toBeGreaterThan(prev);
        prev = band.from;
      }
    }
  });

  it('labels every rating on the 1–10 scale at the documented boundaries', () => {
    expect(getVibeLabel(1.0, 'eat')).toBe('Disaster · Avoid at all costs');
    expect(getVibeLabel(3.9, 'eat')).toBe('Subpar · Probably skip it');
    expect(getVibeLabel(4.0, 'eat')).toBe('Underwhelming · Only if there’s no other option');
    expect(getVibeLabel(8.2, 'eat')).toBe('Loved it · Would rave about it');
    expect(getVibeLabel(9.7, 'eat')).toBe('Near-perfect · Almost nothing to critique');
    expect(getVibeLabel(9.8, 'eat')).toBe('Flawless · Literally nothing could be improved');
    expect(getVibeLabel(10, 'eat')).toBe('Flawless · Literally nothing could be improved');
    expect(getRatingTier(8.7).name).toBe('Great');
    expect(getRatingTier(8.8).name).toBe('Incredible');
  });

  it('only Travel swaps tails', () => {
    expect(getVibeLabel(8.5, 'travel')).toBe('Really loved it · Bucket-list worthy');
    expect(getVibeLabel(8.5, 'explore')).toBe('Really loved it · Still thinking about it');
    expect(getVibeLabel(6.0, 'travel')).toBe('Pleasant · Glad I went');
  });

  it('gives each tier an equal fifth of the non-linear spectrum', () => {
    RATING_TIERS.forEach((tier, i) => {
      expect(spectrumRatingToPct(tier.from)).toBeCloseTo(i * 20);
      expect(pctToSpectrumRating(i / 5)).toBe(tier.from);
    });
  });
});

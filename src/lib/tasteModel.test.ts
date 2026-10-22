import { describe, expect, it } from 'vitest';
import {
  bestScoreFor,
  buildRater,
  computeTasteSimilarity,
  isPositivelyCorrelated,
  isSameSpot,
  isStrongerPrediction,
  MIN_STRANGER_RATERS,
  predictTaste,
  type TasteEntry,
} from './tasteModel';
import { parsePredictionsDoc } from './predictions';
import { getSpotSocialMetrics } from './friendsService';
import { RestaurantEntry, SharedListPayload } from '../types';

const e = (placeId: string, magicScore: number, extra: Partial<TasteEntry> = {}): TasteEntry => ({
  placeId,
  name: placeId,
  category: 'restaurants',
  cuisines: ['Japanese'],
  magicScore,
  ...extra,
});

// My list, and people who agree (same order, harsher scale) or disagree (reversed)
const mine = [e('p1', 9.5), e('p2', 8.8), e('p3', 7.9), e('p4', 7.0), e('p5', 6.1)];
const alike = (offset: number) => mine.map((m) => e(m.placeId!, m.magicScore - offset));
const opposite = mine.map((m, i) => e(m.placeId!, mine[mine.length - 1 - i].magicScore));
const target = { placeId: 'new', name: 'new', category: 'restaurants', cuisines: ['Thai'] };

const stranger = (list: TasteEntry[], score: number, name = 'Secret Stranger') =>
  buildRater(mine, [...list, e('new', score)], score, { name, isFriend: false });

describe('tasteModel', () => {
  it('matches spots by placeId or normalized name + city', () => {
    expect(isSameSpot({ placeId: 'a', name: 'X' }, { placeId: 'a', name: 'Y' })).toBe(true);
    expect(isSameSpot({ name: 'The Bee & Co', city: 'LA' }, { name: 'bee and co', city: 'la ' })).toBe(true);
    expect(isSameSpot({ placeId: 'manual_1', name: 'A' }, { placeId: 'manual_1', name: 'B' })).toBe(false);
    expect(isSameSpot({ name: 'A', city: 'LA' }, { name: 'A', city: 'NY' })).toBe(false);
  });

  it('matches titles only by TMDB ID (remakes share names)', () => {
    const dune2021 = { placeId: 'tmdb:movie:438631', name: 'Dune' };
    expect(isSameSpot(dune2021, { placeId: 'tmdb:movie:438631', name: 'Dune: Part One' })).toBe(true);
    expect(isSameSpot(dune2021, { placeId: 'tmdb:movie:841', name: 'Dune' })).toBe(false);
    expect(isSameSpot(dune2021, { placeId: 'tmdb:tv:438631', name: 'Dune' })).toBe(false);
    expect(isSameSpot({ placeId: 'book:herbert:dune', name: 'Dune' }, { placeId: 'tmdb:movie:841', name: 'Dune' })).toBe(false);
    expect(isSameSpot({ placeId: 'book:herbert:dune', name: 'Dune' }, { placeId: 'book:herbert:dune', name: 'DUNE' })).toBe(true);
    expect(isSameSpot({ placeId: 'bgg:121921', name: 'Dune' }, { placeId: 'igdb:1', name: 'Dune' })).toBe(false);
    const list = [e('tmdb:movie:841', 6, { name: 'Dune', category: 'movies' })];
    expect(bestScoreFor({ ...dune2021, category: 'movies' }, list)).toBeNull();
  });

  it('finds the best score in the requested list only', () => {
    const list = [e('p1', 7), e('p1', 9, { category: 'bars' }), e('p2', 8)];
    expect(bestScoreFor({ placeId: 'p1', name: 'p1', category: 'restaurants' }, list)).toBe(7);
    expect(bestScoreFor({ placeId: 'p1', name: 'p1' }, list)).toBe(9);
    expect(bestScoreFor({ placeId: 'zz', name: 'zz' }, list)).toBeNull();
  });

  it('only counts real overlap as positive correlation', () => {
    expect(isPositivelyCorrelated(computeTasteSimilarity(mine, alike(1.2)))).toBe(true);
    expect(isPositivelyCorrelated(computeTasteSimilarity(mine, opposite))).toBe(false);
    // Two shared spots are not enough evidence
    expect(isPositivelyCorrelated(computeTasteSimilarity(mine, alike(1).slice(0, 2)))).toBe(false);
    // No overlap: only the baseline prior
    expect(isPositivelyCorrelated(computeTasteSimilarity(mine, [e('zz', 8)]))).toBe(false);
  });

  it(`ignores people you don't follow until ${MIN_STRANGER_RATERS} taste-matched ones rated the spot`, () => {
    const two = [stranger(alike(1), 8.5), stranger(alike(0.5), 9)];
    expect(predictTaste(target, mine, two)).toBeNull();
    // Unmatched strangers never count towards the threshold
    expect(predictTaste(target, mine, [...two, stranger(opposite, 9), stranger([e('zz', 7)], 9)])).toBeNull();

    const three = [...two, stranger(alike(1.5), 8)];
    const prediction = predictTaste(target, mine, three)!;
    expect(prediction.raters).toBe(3);
    expect(prediction.score).toBeGreaterThan(8.5);
    expect(prediction.basis).toBe('Based on 3 taste-matched jelly users');
    expect(prediction.basis).not.toContain('Secret');
  });

  it('drops unmatched strangers once the threshold is met', () => {
    const three = [stranger(alike(1), 8.5), stranger(alike(0.5), 9), stranger(alike(1.5), 8)];
    const withNoise = predictTaste(target, mine, [...three, stranger(opposite, 1)])!;
    expect(withNoise).toEqual(predictTaste(target, mine, three));
  });

  it('uses a single friend without the threshold, and names them', () => {
    const friend = buildRater(mine, [...alike(1), e('new', 8.5)], 8.5, { name: 'Maya', isFriend: true });
    const prediction = predictTaste(target, mine, [friend, stranger(alike(1), 3)])!;
    expect(prediction.raters).toBe(1);
    expect(prediction.basis).toMatch(/^Based on Maya \(\d+% taste match\)$/);
  });

  it('falls back to your own cuisine history', () => {
    const thai = [...mine, e('t1', 9.6, { cuisines: ['Thai'] }), e('t2', 9.4, { cuisines: ['Thai'] })];
    const prediction = predictTaste(target, thai, [stranger(alike(1), 2)])!;
    expect(prediction.raters).toBe(0);
    expect(prediction.basis).toBe('Based on your 2 ranked Thai spots');
  });

  it('compares predictions by confidence, then raters', () => {
    expect(isStrongerPrediction({ confidence: 'high', raters: 1 }, { confidence: 'medium', raters: 5 })).toBe(true);
    expect(isStrongerPrediction({ confidence: 'high', raters: 3 }, { confidence: 'high', raters: 3 })).toBe(false);
    expect(isStrongerPrediction({ confidence: 'low', raters: 0 }, null)).toBe(true);
  });
});

describe('parsePredictionsDoc', () => {
  it('keeps valid predictions and skips malformed ones', () => {
    const parsed = parsePredictionsDoc({
      spots: {
        a__bars: { score: 8.2, confidence: 'high', basis: 'Based on 3 taste-matched jelly users', raters: 3 },
        b__bars: { score: 11, confidence: 'high', basis: 'x', raters: 1 },
        c__bars: { score: 7, confidence: 'sure', basis: 'x', raters: 1 },
        d__bars: 'nope',
      },
      updatedAt: 1,
    });
    expect([...parsed.keys()]).toEqual(['a__bars']);
    expect(parsePredictionsDoc(undefined).size).toBe(0);
  });
});

describe('getSpotSocialMetrics with a server prediction', () => {
  const asEntries = (list: TasteEntry[]) =>
    list.map((x, i) => ({ ...x, id: `${x.placeId}-${i}`, formattedAddress: '', categories: [], initialRating: 7, elo: 0, rankIndex: i, comparisonsCount: 0, createdAt: 0, updatedAt: 0 })) as RestaurantEntry[];
  const myRestaurants = asEntries(mine);
  const spot = { placeId: 'new', name: 'new', category: 'restaurants' as const, cuisines: ['Thai'] };
  const server = { score: 9.4, confidence: 'high' as const, basis: 'Based on 4 taste-matched jelly users', raters: 4 };

  it('uses it when no friend has ranked the spot', () => {
    const metrics = getSpotSocialMetrics(spot, { myRestaurants, serverPrediction: server });
    expect(metrics.predictedScore).toBe(9.4);
    expect(metrics.predictionBasis).toBe(server.basis);
    // Without a list of your own there's nothing to personalize
    expect(getSpotSocialMetrics(spot, { myRestaurants: [], serverPrediction: server }).predictedScore).toBeNull();
  });

  it("keeps the friends' prediction when it rests on more evidence", () => {
    const friend = (id: string): SharedListPayload => ({
      id, ownerUid: id, ownerName: id, restaurants: asEntries([...alike(1), e('new', 8)]), createdAt: 0, updatedAt: 0,
    });
    const friendLists = ['f1', 'f2', 'f3', 'f4', 'f5'].map(friend);
    const local = getSpotSocialMetrics(spot, { myRestaurants, friendLists });
    const metrics = getSpotSocialMetrics(spot, { myRestaurants, friendLists, serverPrediction: server });
    expect(metrics.predictedScore).toBe(local.predictedScore);
    expect(metrics.predictionBasis).toMatch(/^Based on f\d/);
  });
});

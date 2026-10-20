import { describe, expect, it } from 'vitest';
import {
  buildCorpus,
  computeUserPredictions,
  MAX_PREDICTIONS,
  predictionPlace,
  type CorpusUser,
  type RankedDoc,
} from '../src/predictions';

const r = (placeId: string, magicScore: number, category = 'restaurants', cuisines = ['Japanese']): RankedDoc => ({
  placeId, name: placeId, category, cuisines, magicScore,
});
const base = [r('p1', 9.5), r('p2', 8.8), r('p3', 7.9), r('p4', 7.0), r('p5', 6.1)];
const alike = (offset: number) => base.map((e) => r(e.placeId!, e.magicScore - offset));

function corpus(users: CorpusUser[]) {
  return buildCorpus(users);
}

describe('computeUserPredictions', () => {
  it('needs 3 taste-matched strangers, never names them, and skips spots you ranked', () => {
    const me: CorpusUser = { uid: 'me', entries: base, bookmarks: [], followingIds: [] };
    const s = (uid: string, offset: number, extra: RankedDoc[]) => ({ uid, entries: [...alike(offset), ...extra], displayName: `Name ${uid}` });
    const result = computeUserPredictions(
      corpus([
        me,
        s('a', 1, [r('three', 8.5), r('two', 8.5)]),
        s('b', 0.5, [r('three', 9), r('two', 9)]),
        s('c', 1.5, [r('three', 8)]),
      ]),
      'me'
    );
    expect(Object.keys(result)).toEqual(['three__restaurants']);
    expect(result['three__restaurants'].raters).toBe(3);
    expect(result['three__restaurants'].basis).toMatch(/^Based on 3 taste-matched jelly users/);
    expect(JSON.stringify(result)).not.toContain('Name');
  });

  it('uses (and names) people you follow, without the threshold', () => {
    const result = computeUserPredictions(
      corpus([
        { uid: 'me', entries: base, bookmarks: [], followingIds: ['maya'] },
        { uid: 'maya', entries: [...alike(1), r('new', 8.4)], displayName: 'Maya' },
      ]),
      'me'
    );
    expect(result['new__restaurants'].basis).toMatch(/^Based on Maya \(\d+% taste match\)/);
  });

  it('predicts bookmarks from your own cuisine history, and keeps them first', () => {
    const entries = [...base, r('t1', 9.6, 'restaurants', ['Thai']), r('t2', 9.4, 'restaurants', ['Thai'])];
    const result = computeUserPredictions(
      corpus([{ uid: 'me', entries, bookmarks: [{ placeId: 'bm', name: 'bm', category: 'restaurants', cuisines: ['Thai'] }] }]),
      'me'
    );
    expect(result['bm__restaurants']).toMatchObject({ raters: 0, basis: 'Based on your 2 ranked Thai spots' });
  });

  it('returns nothing for someone with no ranked spots', () => {
    expect(computeUserPredictions(corpus([{ uid: 'me', entries: [] }, { uid: 'x', entries: base }]), 'me')).toEqual({});
    expect(computeUserPredictions(corpus([]), 'ghost')).toEqual({});
  });

  it(`keeps at most ${MAX_PREDICTIONS} predictions`, () => {
    const extra = Array.from({ length: MAX_PREDICTIONS + 50 }, (_, i) => r(`x${i}`, 8));
    const result = computeUserPredictions(
      corpus([
        { uid: 'me', entries: base, followingIds: ['f'] },
        { uid: 'f', entries: [...alike(1), ...extra] },
      ]),
      'me'
    );
    expect(Object.keys(result)).toHaveLength(MAX_PREDICTIONS);
  });

  it('stores how to show each spot: the name most people use, area, location and top tags', () => {
    const at = (name: string, extra: Partial<RankedDoc> = {}) => ({ ...r('new', 8.4, 'restaurants', ['Thai', 'Noodles']), name, ...extra });
    const result = computeUserPredictions(
      corpus([
        { uid: 'me', entries: base, followingIds: ['f', 'g', 'h'] },
        { uid: 'f', entries: [...alike(1), at('Lers Ros', { city: 'SF', lat: 37.123456789, lng: -122.4 })] },
        { uid: 'g', entries: [...alike(0.5), at('Lers Ros Thai', { city: 'SF', neighborhood: 'Tenderloin' })] },
        { uid: 'h', entries: [...alike(1.5), at('Lers Ros')] },
      ]),
      'me'
    );
    expect(result['new__restaurants'].place).toEqual({
      name: 'Lers Ros',
      city: 'SF',
      neighborhood: 'Tenderloin',
      lat: 37.12346,
      lng: -122.4,
      cuisines: ['Noodles', 'Thai'],
    });
  });

  it('never stores undefined values, and caps names and tags', () => {
    const place = predictionPlace(
      [{ name: 'x'.repeat(500), category: 'restaurants', cuisines: [] }],
      ['A', 'B', 'C', 'D']
    );
    expect(place).toEqual({ name: 'x'.repeat(80), cuisines: ['A', 'B', 'C'] });
    expect(Object.values(place)).not.toContain(undefined);
  });

  it('keeps a full doc of long-named spots well under 1 MiB', () => {
    const long = (i: number): RankedDoc => ({
      ...r(`ChIJ${'x'.repeat(23)}${i}`, 8, 'restaurants', ['Middle Eastern', 'Mediterranean', 'Cocktail Bar', 'Wine Bar']),
      name: `A Rather Long Restaurant Name That Goes On ${i} ${'y'.repeat(40)}`,
      city: 'San Francisco Bay Area Somewhere Long',
      neighborhood: 'Some Quite Long Neighborhood Name Here',
      lat: 37.123456789,
      lng: -122.123456789,
    });
    const extra = Array.from({ length: MAX_PREDICTIONS + 10 }, (_, i) => long(i));
    const result = computeUserPredictions(
      corpus([
        { uid: 'me', entries: base, followingIds: ['f'] },
        { uid: 'f', entries: [...alike(1), ...extra], displayName: 'A Friend With A Long Display Name' },
      ]),
      'me'
    );
    expect(Object.keys(result)).toHaveLength(MAX_PREDICTIONS);
    expect(new TextEncoder().encode(JSON.stringify({ spots: result })).length).toBeLessThan(800 * 1024);
  });
});

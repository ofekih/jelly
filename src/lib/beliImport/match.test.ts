import { describe, expect, it } from 'vitest';
import type { ImportSearchResponse } from '../placesService';
import { buildMatchQueries, matchPlaces, placeIsInCity, scoreLookup, splitBeliCity, type CachedLookup } from './match';
import { syntheticBeliTexts } from './fixtures';
import { parseBeliExport } from './parse';
import { memoryStore } from './store';
import type { MatchQuery } from './types';

function place(id: string, name: string, city: string, extra: Record<string, any> = {}) {
  const [locality, admin1] = city.split(', ');
  return {
    id,
    displayName: { text: name },
    formattedAddress: `1 Main St, ${city}, USA`,
    addressComponents: [
      { longText: locality, shortText: locality, types: ['locality', 'political'] },
      ...(admin1 ? [{ longText: admin1, shortText: admin1, types: ['administrative_area_level_1'] }] : []),
      { longText: 'United States', shortText: 'US', types: ['country'] },
    ],
    types: ['restaurant', 'food'],
    primaryType: 'restaurant',
    location: { latitude: 33.6, longitude: -117.8 },
    ...extra,
  };
}

const q = (name: string, city: string, categories: MatchQuery['categories'] = ['restaurants']): MatchQuery => ({
  key: `${name}|${city}`,
  name,
  city,
  categories,
});
const meta = { fromCache: false, query: 'x' };

describe('city check', () => {
  it('splits "City, ST" and bare cities', () => {
    expect(splitBeliCity('Costa Mesa, CA')).toEqual({ city: 'costa mesa', region: 'ca' });
    expect(splitBeliCity('Tel Aviv-Yafo')).toEqual({ city: 'tel aviv-yafo' });
  });

  it('matches locality, boroughs for New York, and near-spellings', () => {
    expect(placeIsInCity(place('a', 'A', 'Irvine, CA'), 'Irvine, CA')).toBe(true);
    expect(placeIsInCity(place('a', 'A', 'Irvine, CA'), 'Costa Mesa, CA')).toBe(false);
    const brooklyn = {
      addressComponents: [
        { longText: 'Brooklyn', types: ['sublocality_level_1', 'sublocality'] },
        { longText: 'New York', shortText: 'NY', types: ['administrative_area_level_1'] },
        { shortText: 'US', types: ['country'] },
      ],
    };
    expect(placeIsInCity(brooklyn, 'New York, NY')).toBe(true);
    expect(placeIsInCity(brooklyn, 'Brooklyn, NY')).toBe(true);
    const telAviv = { addressComponents: [{ longText: 'Tel Aviv-Yafo', types: ['locality'] }, { shortText: 'IL', types: ['country'] }] };
    expect(placeIsInCity(telAviv, 'Tel Aviv')).toBe(true);
    expect(placeIsInCity(telAviv, 'Tel Aviv-Yafo')).toBe(true);
  });

  it('rejects the same city name in another US state', () => {
    expect(placeIsInCity(place('a', 'A', 'Portland, ME'), 'Portland, OR')).toBe(false);
  });
});

describe('scoreLookup', () => {
  it('auto-accepts a clear name + city match', () => {
    const r = scoreLookup(q('Golden Spoon', 'Irvine, CA'), [place('p1', 'Golden Spoon', 'Irvine, CA')], meta);
    expect(r.status).toBe('matched');
    expect(r.best!.placeId).toBe('p1');
    expect(r.best!.cuisines).toBeDefined();
  });

  it('accepts accents and longer/shorter Google names', () => {
    expect(scoreLookup(q('Cafe Lumiere', 'Irvine, CA'), [place('p', 'Café Lumière', 'Irvine, CA')], meta).status).toBe('matched');
    expect(scoreLookup(q('Tatte', 'Irvine, CA'), [place('p', 'Tatte Bakery & Cafe', 'Irvine, CA')], meta).status).toBe('matched');
    expect(scoreLookup(q('Tatte Bakery & Cafe', 'Irvine, CA'), [place('p', 'Tatte', 'Irvine, CA')], meta).status).toBe('matched');
  });

  it('sends chains with several branches in the city to review, top 3', () => {
    const r = scoreLookup(
      q('Bean Co', 'Irvine, CA', ['coffee_tea']),
      ['1', '2', '3', '4'].map((i) => place(`b${i}`, 'Bean Co', 'Irvine, CA', { types: ['cafe', 'food'], primaryType: 'cafe' })),
      meta
    );
    expect(r.status).toBe('review');
    expect(r.reasons).toContain('chain');
    expect(r.candidates).toHaveLength(3);
  });

  it('reviews a match in the wrong city or with a different name, and the wrong kind of place', () => {
    expect(scoreLookup(q('Golden Spoon', 'Irvine, CA'), [place('p', 'Golden Spoon', 'Tustin, CA')], meta)).toMatchObject({
      status: 'review',
      reasons: ['city'],
    });
    expect(scoreLookup(q('Golden Spoon', 'Irvine, CA'), [place('p', 'Spoon House', 'Irvine, CA')], meta).status).toBe('review');
    const gas = place('g', 'Golden Spoon', 'Irvine, CA', { types: ['gas_station'], primaryType: 'gas_station' });
    expect(scoreLookup(q('Golden Spoon', 'Irvine, CA'), [gas], meta).reasons).toContain('type');
  });

  it('still matches a permanently closed place, flagged', () => {
    const r = scoreLookup(q('Old Fig', 'Irvine, CA'), [place('p', 'Old Fig', 'Irvine, CA', { businessStatus: 'CLOSED_PERMANENTLY' })], meta);
    expect(r).toMatchObject({ status: 'matched', reasons: ['closed'] });
  });

  it('reports nothing found', () => {
    expect(scoreLookup(q('Nowhere', 'Irvine, CA'), [], meta)).toMatchObject({ status: 'not_found', reasons: ['no_results'] });
    expect(scoreLookup(q('Nowhere', 'Irvine, CA'), [place('p', 'Totally Different', 'Paris')], meta).status).toBe('not_found');
  });
});

describe('buildMatchQueries', () => {
  it('shares one lookup per (name, city) and skips already-imported keys', () => {
    const exp = parseBeliExport(syntheticBeliTexts({ restaurants: 10 }) as any);
    const all = buildMatchQueries(exp);
    expect(all.length).toBe(10 + 4 + 2 + 1 + 3);
    const skipped = buildMatchQueries(exp, (key, category) => category === 'restaurants' && key.startsWith('cafe'));
    expect(skipped.length).toBe(all.length - 1);
  });
});

describe('matchPlaces', () => {
  const queries = Array.from({ length: 12 }, (_, i) => q(`Spot ${i}`, 'Irvine, CA'));
  const ok = (text: string): ImportSearchResponse => ({ status: 'ok', places: [place(text, text.split(',')[0], 'Irvine, CA')] });
  const fakeClock = () => {
    let t = 1_000_000;
    return { now: () => t, sleep: async (ms: number) => void (t += ms) };
  };

  it('looks everything up with limited concurrency, then answers from the cache for free', async () => {
    let inFlight = 0;
    let peak = 0;
    const search = async (text: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return ok(text);
    };
    const store = memoryStore<CachedLookup>();
    const first = await matchPlaces(queries, { search, store, concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
    expect(first.progress).toMatchObject({ done: 12, matched: 12, apiCalls: 12, fromCache: 0 });
    const again = await matchPlaces(queries, { search: async () => Promise.reject(new Error('no calls')), store });
    expect(again.progress).toMatchObject({ matched: 12, apiCalls: 0, fromCache: 12 });
  });

  it('backs off together on 429 and retries', async () => {
    const clock = fakeClock();
    let calls = 0;
    const search = async (text: string): Promise<ImportSearchResponse> => (++calls <= 3 ? { status: 'retry', code: 429 } : ok(text));
    const backoffs: boolean[] = [];
    const run = await matchPlaces(queries.slice(0, 4), {
      search,
      store: memoryStore(),
      concurrency: 2,
      ...clock,
      random: () => 0.5,
      onProgress: (p) => backoffs.push(p.backingOff),
    });
    expect(run.progress.matched).toBe(4);
    expect(run.progress.apiCalls).toBe(7);
    expect(backoffs).toContain(true);
  });

  it('gives up on a query after the retries, without failing the rest', async () => {
    const clock = fakeClock();
    const search = async (text: string): Promise<ImportSearchResponse> => (text.startsWith('Spot 0') ? { status: 'retry', code: 503 } : ok(text));
    const run = await matchPlaces(queries.slice(0, 3), { search, store: memoryStore(), maxRetries: 2, ...clock });
    expect(run.results[queries[0].key]).toMatchObject({ status: 'error', reasons: ['failed'] });
    expect(run.progress.matched).toBe(2);
  });

  it('stops at once on a refused key', async () => {
    let calls = 0;
    const run = await matchPlaces(queries, {
      search: async () => (calls++, { status: 'fatal', code: 403 }),
      store: memoryStore(),
      concurrency: 2,
    });
    expect(run.fatal).toEqual({ code: 403 });
    expect(calls).toBe(2);
    expect(run.progress.errors).toBe(12);
  });

  it('never makes more calls than the cap', async () => {
    let calls = 0;
    const run = await matchPlaces(queries, { search: async (t) => (calls++, ok(t)), store: memoryStore(), maxCalls: 5 });
    expect(calls).toBe(5);
    expect(Object.values(run.results).filter((r) => r.reasons.includes('cap'))).toHaveLength(7);
  });

  it('cancels: finished lookups are kept and cached, the rest come back as errors', async () => {
    const controller = new AbortController();
    const store = memoryStore<CachedLookup>();
    let calls = 0;
    const search = async (text: string) => {
      if (++calls === 4) controller.abort();
      return ok(text);
    };
    const run = await matchPlaces(queries, { search, store, concurrency: 1, signal: controller.signal });
    expect(run.progress.matched).toBe(4);
    expect(Object.values(run.results).filter((r) => r.reasons.includes('cancelled'))).toHaveLength(8);
    const resumed = await matchPlaces(queries, { search: async (t) => ok(t), store });
    expect(resumed.progress).toMatchObject({ fromCache: 4, apiCalls: 8, matched: 12 });
  });

  it('ignores cache entries older than 30 days', async () => {
    const store = memoryStore<CachedLookup>();
    await store.set('Spot 0, Irvine, CA', { places: [], at: 0 });
    const run = await matchPlaces(queries.slice(0, 1), { search: async (t) => ok(t), store, now: () => 40 * 86_400_000 });
    expect(run.progress).toMatchObject({ apiCalls: 1, matched: 1 });
  });
});

describe('syntheticPlacesSearch (emulator stand-in)', () => {
  it('reads names with commas and bare cities', async () => {
    const { syntheticPlacesSearch } = await import('./fixtures');
    const res = await syntheticPlacesSearch('Nonna’s Kitchen, Pasta & Wine, New York, NY');
    expect(res.status === 'ok' && res.places[0].displayName.text).toBe('Nonna’s Kitchen, Pasta & Wine');
    const bare = await syntheticPlacesSearch('Café Lumière, Tel Aviv-Yafo');
    expect(bare.status === 'ok' && bare.places[0].addressComponents[0].longText).toBe('Tel Aviv-Yafo');
  });
});

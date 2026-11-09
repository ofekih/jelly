import { CATEGORY_GROUP, type PlaceCandidate, type SpotCategory } from '../../types';
import {
  computeNameMatchScore,
  mapGooglePlaceToCandidate,
  searchTextForImport,
  type ImportSearchResponse,
} from '../placesService';
import { foldText } from './parse';
import { indexedDbStore, type KeyValueStore } from './store';
import type { BeliExport, MatchProgress, MatchQuery, MatchReason, MatchResult } from './types';

/**
 * Finding each Beli place on Google: one Text Search Pro call per (name, city), "name, city" as the
 * query. Results are scored here (pure) and the raw responses cached on the device for 30 days
 * (Google's terms allow caching place content up to 30 days; place IDs indefinitely).
 */

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STRONG_NAME = 95; // computeNameMatchScore: exact (120), prefix (100/105), every word (95)
const LOOSE_NAME = 40;

export interface CachedLookup {
  places: any[];
  at: number;
}

/** "Costa Mesa, CA" → { city: 'costa mesa', region: 'ca' }; "Tel Aviv-Yafo" → { city: 'tel aviv-yafo' } */
export function splitBeliCity(raw: string): { city: string; region?: string } {
  const parts = raw.split(',').map((p) => foldText(p)).filter(Boolean);
  if (parts.length >= 2 && /^[a-z]{2,3}$/.test(parts[parts.length - 1])) {
    return { city: parts.slice(0, -1).join(', '), region: parts[parts.length - 1] };
  }
  return { city: parts.join(', ') };
}

const NYC_BOROUGHS = new Set(['brooklyn', 'manhattan', 'queens', 'bronx', 'the bronx', 'staten island']);
const CITY_TYPES = ['locality', 'postal_town', 'sublocality', 'sublocality_level_1', 'administrative_area_level_2', 'administrative_area_level_3', 'neighborhood'];

const loose = (s: string) => foldText(s).replace(/[-–]/g, ' ').replace(/\s+/g, ' ');

/** Whether a Google place lies in the Beli city (locality, postal town, borough, …; "Tel Aviv" ≈ "Tel Aviv-Yafo") */
export function placeIsInCity(place: any, beliCity: string): boolean {
  const { city, region } = splitBeliCity(beliCity);
  if (!city) return true; // Nothing to check against
  const comps: Array<{ longText?: string; shortText?: string; types?: string[] }> = Array.isArray(place?.addressComponents)
    ? place.addressComponents
    : [];
  const target = loose(city);
  const names = comps
    .filter((c) => c.types?.some((t) => CITY_TYPES.includes(t)))
    .flatMap((c) => [c.longText, c.shortText])
    .filter((t): t is string => Boolean(t))
    .map(loose);
  const cityMatch =
    names.some((n) => n === target || n.startsWith(`${target} `) || target.startsWith(`${n} `)) ||
    // Beli says "New York" for every borough
    (target === 'new york' && names.some((n) => NYC_BOROUGHS.has(n))) ||
    (!comps.length && loose(place?.formattedAddress || '').includes(target));
  if (!cityMatch) return false;
  // "Portland, OR" is not Portland, Maine
  const admin1 = comps.find((c) => c.types?.includes('administrative_area_level_1'));
  const country = comps.find((c) => c.types?.includes('country'))?.shortText;
  if (region && admin1?.shortText && country === 'US' && foldText(admin1.shortText) !== region) return false;
  return true;
}

function nameScore(googleName: string, beliName: string): number {
  const g = foldText(googleName);
  const b = foldText(beliName);
  // Both ways: Google's name may be longer ("Tatte Bakery & Cafe") or shorter ("Tatte")
  return Math.max(computeNameMatchScore(g, b), computeNameMatchScore(b, g));
}

const FOOD_TYPES = new Set([
  'restaurant', 'food', 'cafe', 'coffee_shop', 'bakery', 'bar', 'pub', 'meal_takeaway', 'meal_delivery',
  'ice_cream_shop', 'dessert_shop', 'donut_shop', 'bagel_shop', 'juice_shop', 'tea_house', 'cafeteria',
  'diner', 'deli', 'food_court', 'confectionery', 'chocolate_shop', 'candy_store', 'brewery', 'winery',
  'night_club', 'sandwich_shop', 'steak_house', 'pastry_shop', 'cat_cafe', 'dog_cafe', 'acai_shop',
]);
const FOOD_SUFFIXES = ['_restaurant', '_bar', '_cafe', '_bakery'];

/**
 * Whether Google's types fit the lists it goes into. Eat lists check the raw types (the categorizer
 * falls back to Restaurants for anything, so its categories can't tell a gas station apart).
 */
function fitsLists(place: any, cand: PlaceCandidate, categories: SpotCategory[]): boolean {
  const groups = new Set(categories.map((c) => CATEGORY_GROUP[c]));
  if (groups.has('eat')) {
    const types: string[] = [...(Array.isArray(place.types) ? place.types : []), place.primaryType].filter(Boolean);
    if (types.some((t) => FOOD_TYPES.has(t) || FOOD_SUFFIXES.some((s) => t.endsWith(s)))) return true;
  }
  return cand.categories.some((c) => CATEGORY_GROUP[c] !== 'eat' && groups.has(CATEGORY_GROUP[c]));
}

interface Scored {
  cand: PlaceCandidate;
  name: number;
  city: boolean;
  type: boolean;
  closed: boolean;
  order: number;
}

/** Scores one lookup's Google results against the Beli place (pure). */
export function scoreLookup(query: MatchQuery, places: any[], meta: { fromCache: boolean; query: string }): MatchResult {
  const scored: Scored[] = places
    .filter((p) => p && typeof p.id === 'string')
    .map((p, order) => {
      const cand = mapGooglePlaceToCandidate(p, query.name);
      return {
        cand,
        name: nameScore(cand.name, query.name),
        city: placeIsInCity(p, query.city),
        type: fitsLists(p, cand, query.categories),
        closed: p.businessStatus === 'CLOSED_PERMANENTLY',
        order,
      };
    });
  const rank = (s: Scored) => s.name + (s.city ? 30 : 0) + (s.type ? 10 : 0);
  scored.sort((a, b) => rank(b) - rank(a) || a.order - b.order);
  const candidates = scored.slice(0, 3).map((s) => s.cand);
  const base = { key: query.key, candidates, query: meta.query, fromCache: meta.fromCache };
  if (scored.length === 0) return { ...base, status: 'not_found', reasons: ['no_results'] };

  const best = scored[0];
  const strong = (s: Scored) => s.name >= STRONG_NAME && s.city;
  const branches = scored.filter((s) => strong(s) && s.cand.placeId !== best.cand.placeId);
  const reasons: MatchReason[] = [];
  if (best.name < STRONG_NAME) reasons.push('name');
  if (!best.city) reasons.push('city');
  if (!best.type) reasons.push('type');
  if (strong(best) && branches.length > 0) reasons.push('chain');
  if (best.closed) reasons.push('closed');

  const blocking = reasons.filter((r) => r !== 'closed');
  if (blocking.length === 0) return { ...base, status: 'matched', best: best.cand, reasons };
  if (best.name >= LOOSE_NAME || best.city) return { ...base, status: 'review', best: best.cand, reasons };
  return { ...base, status: 'not_found', reasons };
}

/** The places to look up: ranked spots and bookmarks of one (name, city) share a lookup. `skipKeys` (already imported) are left out. */
export function buildMatchQueries(exp: BeliExport, skipKeys: (key: string, category: SpotCategory) => boolean = () => false): MatchQuery[] {
  const byKey = new Map<string, MatchQuery>();
  const rows = [...Object.values(exp.lists).flatMap((rows) => rows ?? []), ...exp.bookmarks];
  for (const row of rows) {
    if (skipKeys(row.key, row.category)) continue;
    const q = byKey.get(row.key) ?? { key: row.key, name: row.name, city: row.city, categories: [] };
    if (!q.categories.includes(row.category)) q.categories.push(row.category);
    byKey.set(row.key, q);
  }
  return [...byKey.values()];
}

export function textQueryFor(q: Pick<MatchQuery, 'name' | 'city'>): string {
  return q.city ? `${q.name}, ${q.city}` : q.name;
}

export interface MatchRunOptions {
  /** Defaults to Google Text Search with the import field mask and `apiKey` */
  search?: (textQuery: string, signal?: AbortSignal) => Promise<ImportSearchResponse>;
  apiKey?: string;
  /** Lookup cache by text query; defaults to IndexedDB */
  store?: KeyValueStore<CachedLookup>;
  concurrency?: number; // Default 4
  /** Hard cap on billable calls this run (default: one per query plus 10% for retries) */
  maxCalls?: number;
  maxRetries?: number; // Per query, default 5
  signal?: AbortSignal;
  onProgress?: (progress: MatchProgress) => void;
  onResult?: (result: MatchResult) => void;
  /** Injected for tests */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

export interface MatchRun {
  results: Record<string, MatchResult>;
  progress: MatchProgress;
  /** Google refused the key (403/400…): nothing further was tried */
  fatal?: { code: number };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Looks every query up, `concurrency` at a time, cached first. On a rate limit or server error
 * all workers back off together (exponential with jitter, up to 30 s) and retry; a refused key
 * stops the run. Cancelling (`signal`) keeps what finished; unfinished queries come back as
 * `error`, and running again resumes from the cache for free.
 */
export async function matchPlaces(queries: MatchQuery[], options: MatchRunOptions = {}): Promise<MatchRun> {
  const {
    apiKey,
    concurrency = 4,
    maxRetries = 5,
    signal,
    onProgress,
    onResult,
    sleep = defaultSleep,
    now = Date.now,
    random = Math.random,
  } = options;
  const search = options.search ?? ((q: string, s?: AbortSignal) => searchTextForImport(q, { apiKey, signal: s }));
  const store = options.store ?? indexedDbStore<CachedLookup>('lookups');
  const maxCalls = options.maxCalls ?? Math.ceil(queries.length * 1.1) + 5;

  const results: Record<string, MatchResult> = {};
  const progress: MatchProgress = { total: queries.length, done: 0, matched: 0, review: 0, notFound: 0, errors: 0, fromCache: 0, apiCalls: 0, backingOff: false };
  let fatal: { code: number } | undefined;
  let pauseUntil = 0;
  let next = 0;

  const report = (result: MatchResult) => {
    results[result.key] = result;
    progress.done++;
    if (result.fromCache) progress.fromCache++;
    if (result.status === 'matched') progress.matched++;
    else if (result.status === 'review') progress.review++;
    else if (result.status === 'not_found') progress.notFound++;
    else progress.errors++;
    onResult?.(result);
    onProgress?.({ ...progress });
  };
  const failed = (q: MatchQuery, reason: MatchReason): MatchResult => ({
    key: q.key,
    status: 'error',
    candidates: [],
    reasons: [reason],
    query: textQueryFor(q),
    fromCache: false,
  });

  const lookUp = async (q: MatchQuery): Promise<MatchResult> => {
    const text = textQueryFor(q);
    const cached = await store.get(text).catch(() => undefined);
    if (cached && now() - cached.at < CACHE_TTL_MS) return scoreLookup(q, cached.places, { fromCache: true, query: text });
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) return failed(q, 'cancelled');
      if (fatal) return failed(q, 'failed');
      const wait = pauseUntil - now();
      if (wait > 0) {
        progress.backingOff = true;
        onProgress?.({ ...progress });
        await new Promise<void>((resolve) => {
          const onAbort = () => resolve();
          signal?.addEventListener('abort', onAbort, { once: true });
          sleep(wait).then(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
          });
        });
        progress.backingOff = false;
        continue; // Re-check: another worker may have pushed the pause further
      }
      if (progress.apiCalls >= maxCalls) return failed(q, 'cap');
      progress.apiCalls++;
      let res: ImportSearchResponse;
      try {
        res = await search(text, signal);
      } catch {
        return failed(q, signal?.aborted ? 'cancelled' : 'failed');
      }
      if (res.status === 'ok') {
        await store.set(text, { places: res.places, at: now() }).catch(() => undefined);
        return scoreLookup(q, res.places, { fromCache: false, query: text });
      }
      if (res.status === 'fatal') {
        fatal ??= { code: res.code };
        return failed(q, 'failed');
      }
      if (attempt >= maxRetries) return failed(q, 'failed');
      const delay = Math.min(30_000, 1000 * 2 ** attempt) * (0.75 + random() * 0.5);
      pauseUntil = Math.max(pauseUntil, now() + delay);
    }
  };

  const worker = async () => {
    while (next < queries.length) {
      const q = queries[next++];
      report(await lookUp(q));
    }
  };
  onProgress?.({ ...progress });
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queries.length)) }, worker));
  return { results, progress: { ...progress }, fatal };
}

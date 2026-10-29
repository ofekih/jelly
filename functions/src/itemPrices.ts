/**
 * Shared prices, `prices/{placeId}` (public read, written only here). The ID is the title's
 * place ID, which names its source (`bgg:174430`, `igdb:1942`), so one flat collection serves every
 * list, and a new kind of title (books, say) is one more entry in `PROVIDERS`.
 *
 * Nobody waits on a provider: saving or ranking a title queues `priceJobs/{placeId}` when its price
 * is missing or old (`queuePrice`), `runPriceJobs` works the queue every minute at a gentle pace,
 * and a nightly pass re-queues whatever is missing (titles from before prices existed, lookups
 * that kept failing) or stale. A doc with no price on it records "asked, found nothing", so those
 * titles aren't asked again for a month.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import type { ItemPrice } from '../../src/types';
import { bookPrice } from './books';
import { boardGamePrice } from './gamePrice';
import { videoGamePrice } from './steamPrice';

export const PRICE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const NO_PRICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const JOBS_PER_RUN = 25;
const CONCURRENCY = 5;
const MAX_ATTEMPTS = 5;

export interface PriceContext {
  twitchClientId: string;
  twitchClientSecret: string;
  googleBooksKey: string;
}

/** What a provider may need beyond the ID: books have no ID of their own, so it's looked up by name */
export interface PriceHint {
  name?: string;
  creator?: string;
}

/** The hint, from a ranked or saved spot's `name` and `media.creator` (undefined when it has neither) */
export function priceHint(spot: any): PriceHint | undefined {
  const name = typeof spot?.name === 'string' ? spot.name : undefined;
  const creator = typeof spot?.media?.creator === 'string' ? spot.media.creator : undefined;
  return name || creator ? { ...(name ? { name } : {}), ...(creator ? { creator } : {}) } : undefined;
}

type Provider = (id: string, ctx: PriceContext, hint: PriceHint, placeId: string) => Promise<ItemPrice | null>;

/** Place ID prefix → where its price comes from */
export const PROVIDERS: Record<string, Provider> = {
  bgg: (id) => boardGamePrice(id),
  igdb: (id, ctx) => videoGamePrice(id, ctx.twitchClientId, ctx.twitchClientSecret),
  book: (_id, ctx, hint, placeId) =>
    hint.name && hint.creator ? bookPrice(placeId, hint.name, hint.creator, ctx.googleBooksKey) : Promise.resolve(null),
};

/** Prefixes whose IDs are the source's own numbers; the rest (books) are made from title and author */
const NUMERIC = new Set(['bgg', 'igdb']);

/** `bgg:174430` → `{ prefix: 'bgg', id: '174430' }`, undefined for places and titles with no provider */
export function parsePriceId(placeId: unknown): { prefix: string; id: string } | undefined {
  const match = typeof placeId === 'string' ? placeId.match(/^([a-z]+):([^/]{1,200})$/) : null;
  if (!match || !(match[1] in PROVIDERS)) return undefined;
  return !NUMERIC.has(match[1]) || /^\d+$/.test(match[2]) ? { prefix: match[1], id: match[2] } : undefined;
}

const pricesDoc = (db: Firestore, placeId: string) => db.doc(`prices/${placeId}`);
const jobDoc = (db: Firestore, placeId: string) => db.doc(`priceJobs/${placeId}`);

/** Whether a stored price doc is due for another lookup */
export function isStale(price: { fetchedAt?: unknown; new?: unknown; used?: unknown } | undefined, now: number): boolean {
  if (!price || typeof price.fetchedAt !== 'number') return true;
  return now - price.fetchedAt > (price.new || price.used ? PRICE_TTL_MS : NO_PRICE_TTL_MS);
}

/** Queues a lookup when the title has a provider and its price is missing or stale. */
export async function queuePrice(db: Firestore, placeId: unknown, hint?: PriceHint, now = Date.now()): Promise<boolean> {
  if (!parsePriceId(placeId)) return false;
  const id = placeId as string;
  const stored = await pricesDoc(db, id).get();
  if (!isStale(stored.data(), now)) return false;
  await enqueue(db, id, hint, now);
  return true;
}

/** create() keeps an existing job's retry count */
const enqueue = (db: Firestore, placeId: string, hint: PriceHint | undefined, now: number) =>
  jobDoc(db, placeId).create({ queuedAt: now, attempts: 0, ...(hint ? { hint } : {}) }).catch(() => undefined);

/** Looks up the next queued prices; returns how many it stored. */
export async function runPriceJobs(
  db: Firestore,
  ctx: PriceContext,
  now = Date.now(),
  providers: Record<string, Provider> = PROVIDERS
): Promise<number> {
  const jobs = await db.collection('priceJobs').orderBy('queuedAt').limit(JOBS_PER_RUN).get();
  let stored = 0;
  for (let i = 0; i < jobs.docs.length; i += CONCURRENCY) {
    await Promise.all(
      jobs.docs.slice(i, i + CONCURRENCY).map(async (job) => {
        const parsed = parsePriceId(job.id);
        if (!parsed) {
          await job.ref.delete();
          return;
        }
        try {
          const hint: PriceHint = job.get('hint') ?? {};
          const price = await providers[parsed.prefix](parsed.id, ctx, hint, job.id);
          // The hint stays with the price, so the weekly refresh can look it up again
          await pricesDoc(db, job.id).set({ ...(price ?? {}), ...(job.get('hint') ? { hint } : {}), fetchedAt: now });
          await job.ref.delete();
          stored += 1;
        } catch (err) {
          const attempts = Number(job.get('attempts') ?? 0) + 1;
          logger.warn('price lookup failed', { placeId: job.id, attempts, err: String(err) });
          if (attempts >= MAX_ATTEMPTS) await job.ref.delete();
          else await job.ref.update({ attempts, queuedAt: now });
        }
      })
    );
  }
  return stored;
}

/** Every distinct place ID in anyone's ranked or saved spots that a provider knows, with its hint. */
async function listedPrices(db: Firestore): Promise<Map<string, PriceHint | undefined>> {
  const listed = new Map<string, PriceHint | undefined>();
  for (const group of ['restaurants', 'bookmarks']) {
    const snap = await db.collectionGroup(group).select('placeId', 'name', 'media').get();
    for (const d of snap.docs) {
      if (d.ref.parent.parent?.parent.id !== 'users') continue;
      const placeId = d.get('placeId');
      if (parsePriceId(placeId) && !listed.get(placeId)) listed.set(placeId, priceHint(d.data()));
    }
  }
  return listed;
}

/** Queues listed titles that have no price doc at all; returns how many were queued. */
export async function queueMissingPrices(db: Firestore, now = Date.now()): Promise<number> {
  const listed = await listedPrices(db);
  const ids = [...listed.keys()];
  let queued = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const docs = await db.getAll(...ids.slice(i, i + 100).map((id) => pricesDoc(db, id)));
    for (const doc of docs) {
      if (doc.exists) continue;
      await enqueue(db, doc.id, listed.get(doc.id), now);
      queued += 1;
    }
  }
  return queued;
}

/** Queues price docs past their refresh time (oldest first); returns how many were queued. */
export async function queueStalePrices(db: Firestore, now = Date.now(), limit = 500): Promise<number> {
  const old = await db.collection('prices').where('fetchedAt', '<', now - PRICE_TTL_MS).orderBy('fetchedAt').limit(limit).get();
  let queued = 0;
  for (const doc of old.docs) {
    if (!isStale(doc.data(), now) || !parsePriceId(doc.id)) continue;
    await enqueue(db, doc.id, doc.get('hint'), now);
    queued += 1;
  }
  return queued;
}

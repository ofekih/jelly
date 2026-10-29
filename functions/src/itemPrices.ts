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
}

type Provider = (id: string, ctx: PriceContext) => Promise<ItemPrice | null>;

/** Place ID prefix → where its price comes from */
export const PROVIDERS: Record<string, Provider> = {
  bgg: (id) => boardGamePrice(id),
  igdb: (id, ctx) => videoGamePrice(id, ctx.twitchClientId, ctx.twitchClientSecret),
};

/** `bgg:174430` → `{ prefix: 'bgg', id: '174430' }`, undefined for places and titles with no provider */
export function parsePriceId(placeId: unknown): { prefix: string; id: string } | undefined {
  const match = typeof placeId === 'string' ? placeId.match(/^([a-z]+):(\d+)$/) : null;
  return match && match[1] in PROVIDERS ? { prefix: match[1], id: match[2] } : undefined;
}

const pricesDoc = (db: Firestore, placeId: string) => db.doc(`prices/${placeId}`);
const jobDoc = (db: Firestore, placeId: string) => db.doc(`priceJobs/${placeId}`);

/** Whether a stored price doc is due for another lookup */
export function isStale(price: { fetchedAt?: unknown; new?: unknown; used?: unknown } | undefined, now: number): boolean {
  if (!price || typeof price.fetchedAt !== 'number') return true;
  return now - price.fetchedAt > (price.new || price.used ? PRICE_TTL_MS : NO_PRICE_TTL_MS);
}

/** Queues a lookup when the title has a provider and its price is missing or stale. */
export async function queuePrice(db: Firestore, placeId: unknown, now = Date.now()): Promise<boolean> {
  if (!parsePriceId(placeId)) return false;
  const id = placeId as string;
  const stored = await pricesDoc(db, id).get();
  if (!isStale(stored.data(), now)) return false;
  // create() keeps an existing job's retry count
  await jobDoc(db, id).create({ queuedAt: now, attempts: 0 }).catch(() => undefined);
  return true;
}

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
          const price = await providers[parsed.prefix](parsed.id, ctx);
          await pricesDoc(db, job.id).set({ ...(price ?? {}), fetchedAt: now });
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

/** Every distinct place ID in anyone's ranked or saved spots that a provider knows. */
async function listedPriceIds(db: Firestore): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const group of ['restaurants', 'bookmarks']) {
    const snap = await db.collectionGroup(group).select('placeId').get();
    for (const d of snap.docs) {
      if (d.ref.parent.parent?.parent.id !== 'users') continue;
      const placeId = d.get('placeId');
      if (parsePriceId(placeId)) ids.add(placeId);
    }
  }
  return ids;
}

/** Queues listed titles that have no price doc at all; returns how many were queued. */
export async function queueMissingPrices(db: Firestore, now = Date.now()): Promise<number> {
  const ids = [...(await listedPriceIds(db))];
  let queued = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const docs = await db.getAll(...ids.slice(i, i + 100).map((id) => pricesDoc(db, id)));
    for (const doc of docs) {
      if (doc.exists) continue;
      await jobDoc(db, doc.id).create({ queuedAt: now, attempts: 0 }).catch(() => undefined);
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
    await jobDoc(db, doc.id).create({ queuedAt: now, attempts: 0 }).catch(() => undefined);
    queued += 1;
  }
  return queued;
}

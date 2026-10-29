import { beforeEach, describe, expect, it } from 'vitest';
import { queueMissingPrices, queuePrice, queueStalePrices, runPriceJobs, PRICE_TTL_MS } from '../src/itemPrices';
import { adminDb, clearProject } from './helpers';

// Separate project so the Functions emulator's triggers don't react to these writes
const PROJECT = 'demo-jelly-prices';
const db = adminDb(PROJECT);
const ctx = { twitchClientId: 'id', twitchClientSecret: 'secret', googleBooksKey: 'key' };
const NOW = 1_800_000_000_000;

const ids = async (col: string) => (await db.collection(col).listDocuments()).map((d) => d.id).sort();

describe('item prices', () => {
  beforeEach(() => clearProject(PROJECT));

  it('queues only titles with a provider whose price is missing or stale', async () => {
    expect(await queuePrice(db, 'ChIJplace', undefined, NOW)).toBe(false);
    expect(await queuePrice(db, 'tmdb:movie:5', undefined, NOW)).toBe(false);
    expect(await queuePrice(db, 'bgg:13', undefined, NOW)).toBe(true);
    await db.doc('prices/igdb:1').set({ new: { amount: 10, currency: 'USD' }, fetchedAt: NOW - 1000 });
    expect(await queuePrice(db, 'igdb:1', undefined, NOW)).toBe(false);
    await db.doc('prices/igdb:2').set({ new: { amount: 10, currency: 'USD' }, fetchedAt: NOW - PRICE_TTL_MS - 1 });
    expect(await queuePrice(db, 'igdb:2', undefined, NOW)).toBe(true);
    expect(await ids('priceJobs')).toEqual(['bgg:13', 'igdb:2']);
  });

  it('stores found prices, records "nothing found", and retries failures', async () => {
    for (const id of ['bgg:1', 'bgg:2', 'igdb:3']) await queuePrice(db, id, undefined, NOW);
    const providers = {
      bgg: async (id: string) => {
        if (id === '2') return null;
        return { source: 'amazon' as const, new: { amount: 40, currency: 'USD' } };
      },
      igdb: async () => {
        throw new Error('down');
      },
    };
    expect(await runPriceJobs(db, ctx, NOW, providers)).toBe(2);
    expect((await db.doc('prices/bgg:1').get()).data()).toEqual({ source: 'amazon', new: { amount: 40, currency: 'USD' }, fetchedAt: NOW });
    expect((await db.doc('prices/bgg:2').get()).data()).toEqual({ fetchedAt: NOW });
    expect(await ids('priceJobs')).toEqual(['igdb:3']);
    expect((await db.doc('priceJobs/igdb:3').get()).get('attempts')).toBe(1);

    // Gives up after enough failures
    for (let i = 0; i < 4; i++) await runPriceJobs(db, ctx, NOW, providers);
    expect(await ids('priceJobs')).toEqual([]);
    expect((await db.doc('prices/igdb:3').get()).exists).toBe(false);
  });

  it('books are looked up by name and keep it for the weekly refresh', async () => {
    const id = 'book:weir:project-hail-mary';
    expect(await queuePrice(db, id, { name: 'Project Hail Mary', creator: 'Andy Weir' }, NOW)).toBe(true);
    const seen: unknown[] = [];
    const providers = {
      book: async (_id: string, _ctx: unknown, hint: unknown, placeId: string) => {
        seen.push(hint, placeId);
        return { source: 'google_books' as const, new: { amount: 9.99, currency: 'USD' } };
      },
    };
    expect(await runPriceJobs(db, ctx, NOW, providers as never)).toBe(1);
    expect(seen).toEqual([{ name: 'Project Hail Mary', creator: 'Andy Weir' }, id]);
    expect((await db.doc(`prices/${id}`).get()).data()).toMatchObject({ hint: { name: 'Project Hail Mary', creator: 'Andy Weir' }, fetchedAt: NOW });

    await db.doc(`prices/${id}`).update({ fetchedAt: NOW - PRICE_TTL_MS - 5 });
    expect(await queueStalePrices(db, NOW)).toBe(1);
    expect((await db.doc(`priceJobs/${id}`).get()).get('hint')).toEqual({ name: 'Project Hail Mary', creator: 'Andy Weir' });
  });

  it('the nightly pass queues listed titles with no price and prices past their refresh time', async () => {
    await db.doc('users/a/restaurants/bgg:1__board_games').set({ placeId: 'bgg:1', category: 'board_games' });
    await db.doc('users/a/bookmarks/igdb:2__video_games').set({ placeId: 'igdb:2', category: 'video_games' });
    await db.doc('users/a/restaurants/book:weir:x__fiction').set({ placeId: 'book:weir:x', name: 'X', media: { creator: 'Andy Weir' } });
    await db.doc('users/b/restaurants/p1__bars').set({ placeId: 'p1', category: 'bars' });
    await db.doc('prices/bgg:1').set({ fetchedAt: NOW });
    await db.doc('prices/bgg:9').set({ new: { amount: 5, currency: 'USD' }, fetchedAt: NOW - PRICE_TTL_MS - 5 });
    await db.doc('prices/bgg:8').set({ fetchedAt: NOW - PRICE_TTL_MS - 5 }); // nothing found: waits a month

    expect(await queueMissingPrices(db, NOW)).toBe(2);
    expect(await queueStalePrices(db, NOW)).toBe(1);
    expect(await ids('priceJobs')).toEqual(['bgg:9', 'book:weir:x', 'igdb:2']);
  });
});

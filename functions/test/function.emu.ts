import { beforeAll, describe, expect, it } from 'vitest';
import { computePlaceStat, placeKeyOf, placeStatId } from '../src/placeStats';
import { adminDb, clearProject } from './helpers';

// Must match the project the Functions emulator runs triggers for (`--project` in test:emulator)
const PROJECT = 'demo-jelly';
const db = adminDb(PROJECT);

/** Brute-force placeStats from every user's restaurants. */
async function bruteForce() {
  const snap = await db.collectionGroup('restaurants').get();
  const rows = new Map<string, { uid: string; magicScore: unknown }[]>();
  for (const d of snap.docs) {
    const key = placeKeyOf(d.data());
    if (!key) continue;
    const id = placeStatId(key);
    rows.set(id, [...(rows.get(id) || []), { uid: d.ref.parent.parent!.id, magicScore: d.get('magicScore') }]);
  }
  const out: Record<string, { sum: number; count: number; avg: number }> = {};
  for (const [id, r] of rows) out[id] = computePlaceStat(r)!;
  return out;
}

async function actualStats() {
  const snap = await db.collection('placeStats').get();
  const out: Record<string, { sum: number; count: number; avg: number }> = {};
  for (const d of snap.docs) out[d.id] = { sum: d.get('sum'), count: d.get('count'), avg: d.get('avg') };
  return out;
}

/** Waits until the triggers have caught up with the brute-force answer. */
async function expectStatsConverge() {
  const expected = await bruteForce();
  const deadline = Date.now() + 20000;
  let actual = await actualStats();
  while (JSON.stringify(sorted(actual)) !== JSON.stringify(sorted(expected)) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    actual = await actualStats();
  }
  expect(sorted(actual)).toEqual(sorted(expected));
  return actual;
}
const sorted = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort());

const entry = (placeId: string, category: string, magicScore: number) => ({
  name: placeId,
  placeId,
  category,
  initialRating: 7,
  rankIndex: 0,
  magicScore,
});

describe('onRestaurantWritten (Functions emulator)', () => {
  beforeAll(() => clearProject(PROJECT));

  it('keeps placeStats equal to a brute-force recompute through rank / rerank / move / delete', async () => {
    const r = (uid: string, id: string) => db.doc(`users/${uid}/restaurants/${id}`);

    // Rank
    await r('alice', 'p1__bars').set(entry('p1', 'bars', 8));
    await r('bob', 'p1__bars').set(entry('p1', 'bars', 6));
    await r('bob', 'p2__restaurants').set(entry('p2', 'restaurants', 9));
    await r('carol', 'manual_1__bars').set(entry('manual_1', 'bars', 5));
    let stats = await expectStatsConverge();
    expect(stats['p1__bars']).toEqual({ sum: 14, count: 2, avg: 7 });
    expect(stats['manual_1__bars']).toBeUndefined();

    // Rerank (magic score changes)
    await r('bob', 'p1__bars').update({ magicScore: 4, rankIndex: 1 });
    stats = await expectStatsConverge();
    expect(stats['p1__bars']).toEqual({ sum: 12, count: 2, avg: 6 });

    // Same place twice for one user counts once (their best)
    await r('alice', 'p1__bars_dup').set(entry('p1', 'bars', 9));
    stats = await expectStatsConverge();
    expect(stats['p1__bars']).toEqual({ sum: 13, count: 2, avg: 6.5 });

    // Move an entry to another list: both the old and the new stats update
    await r('bob', 'p1__bars').update({ category: 'brunch' });
    stats = await expectStatsConverge();
    expect(stats['p1__bars']).toEqual({ sum: 9, count: 1, avg: 9 });
    expect(stats['p1__brunch']).toEqual({ sum: 4, count: 1, avg: 4 });

    // Delete: last rater gone -> stats doc removed
    await r('bob', 'p2__restaurants').delete();
    await r('bob', 'p1__bars').delete();
    stats = await expectStatsConverge();
    expect(stats['p2__restaurants']).toBeUndefined();
    expect(stats['p1__brunch']).toBeUndefined();

    // A burst of concurrent writes still converges (recompute, not increment)
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => r(`u${i % 4}`, `p3__bars`).set(entry('p3', 'bars', (i % 10) + 0.5)))
    );
    await expectStatsConverge();
  });
});

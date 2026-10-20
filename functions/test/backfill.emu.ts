import { beforeEach, describe, expect, it } from 'vitest';
import { backfill } from '../scripts/backfill';
import { adminDb, clearProject } from './helpers';

// Separate project so the Functions emulator's triggers don't touch these placeStats
const PROJECT = 'demo-jelly-backfill';
const db = adminDb(PROJECT);

const entry = (placeId: string, category: string, magicScore: number) => ({
  name: placeId, placeId, category, initialRating: 7, rankIndex: 0, magicScore,
});

async function seed() {
  await db.doc('sharedLists/alice').set({
    ownerUid: 'alice', ownerName: 'Alice', displayName: 'Alice Ng', handle: 'alice',
    photoURL: 'https://example.com/a.png', followingIds: ['bob', 'carol'], restaurants: [{}, {}],
  });
  await db.doc('sharedLists/bob').set({ ownerUid: 'bob', ownerName: 'Bob', followingIds: ['alice'] });
  await db.doc('users/alice/restaurants/p1__bars').set(entry('p1', 'bars', 8));
  await db.doc('users/alice/restaurants/p2__bars').set(entry('p2', 'bars', 7));
  await db.doc('users/bob/restaurants/p1__bars').set(entry('p1', 'bars', 6));
  await db.doc('placeStats/stale__bars').set({ sum: 1, count: 1, avg: 1 });
}

const paths = async (col: string) => (await db.collection(col).listDocuments()).map((d) => d.id).sort();

describe('backfill', () => {
  beforeEach(async () => {
    await clearProject(PROJECT);
    await seed();
  });

  it('--dry-run writes nothing', async () => {
    const result = await backfill(db, { dryRun: true });
    expect(result).toMatchObject({ sharedLists: 2, profiles: 2, newEdges: 3, stats: 2, staleStats: 1 });
    expect(await paths('profiles')).toEqual([]);
    expect(await paths('placeStats')).toEqual(['stale__bars']);
  });

  it('builds profiles, follower edges and placeStats, and is idempotent', async () => {
    await backfill(db, { dryRun: false });

    const alice = (await db.doc('profiles/alice').get()).data()!;
    expect(alice).toMatchObject({
      handle: 'alice', handleLower: 'alice', displayName: 'Alice Ng', nameLower: 'alice ng',
      photoURL: 'https://example.com/a.png', followingIds: ['bob', 'carol'], rankedCount: 2,
    });
    expect((await db.doc('profiles/bob').get()).data()).toMatchObject({
      displayName: 'Bob', nameLower: 'bob', followingIds: ['alice'], rankedCount: 1,
    });
    expect(await paths('profiles/bob/followers')).toEqual(['alice']);
    expect(await paths('profiles/carol/followers')).toEqual(['alice']);
    expect(await paths('profiles/alice/followers')).toEqual(['bob']);
    const edge = (await db.doc('profiles/bob/followers/alice').get()).data()!;

    expect((await db.doc('placeStats/p1__bars').get()).data()).toMatchObject({ sum: 14, count: 2, avg: 7 });
    expect((await db.doc('placeStats/p2__bars').get()).data()).toMatchObject({ sum: 7, count: 1, avg: 7 });
    expect(await paths('placeStats')).toEqual(['p1__bars', 'p2__bars']);

    // Second run: no new edges, existing createdAt preserved, same stats
    const again = await backfill(db, { dryRun: false });
    expect(again).toMatchObject({ profiles: 2, newEdges: 0, stats: 2, staleStats: 0 });
    expect((await db.doc('profiles/bob/followers/alice').get()).data()).toEqual(edge);
    expect(await paths('placeStats')).toEqual(['p1__bars', 'p2__bars']);
  });
});

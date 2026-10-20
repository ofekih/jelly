import { describe, expect, it } from 'vitest';
import { affectedPlaceKeys, computePlaceStat, placeKeyOf, placeStatId, type PlaceStat } from '../src/placeStats';
import { profileFromSharedList, sharedListOwner } from '../src/profiles';

type Doc = { placeId?: string; category?: string; magicScore: number };
type Db = Map<string, Doc>; // `${uid}/${entryId}` -> doc

/** Brute force: aggregate every stat straight from all docs. */
function bruteForce(db: Db): Map<string, PlaceStat> {
  const rows = new Map<string, { uid: string; magicScore: number }[]>();
  for (const [path, doc] of db) {
    const key = placeKeyOf(doc);
    if (!key) continue;
    const id = placeStatId(key);
    rows.set(id, [...(rows.get(id) || []), { uid: path.split('/')[0], magicScore: doc.magicScore }]);
  }
  const out = new Map<string, PlaceStat>();
  for (const [id, r] of rows) out.set(id, computePlaceStat(r)!);
  return out;
}

/** What the trigger does: recompute only the keys touched by one write. */
function applyTrigger(db: Db, stats: Map<string, PlaceStat>, before?: Doc, after?: Doc) {
  for (const key of affectedPlaceKeys(before, after)) {
    const rows = [...db]
      .filter(([, d]) => d.placeId === key.placeId && d.category === key.category)
      .map(([path, d]) => ({ uid: path.split('/')[0], magicScore: d.magicScore }));
    const stat = computePlaceStat(rows);
    if (stat) stats.set(placeStatId(key), stat);
    else stats.delete(placeStatId(key));
  }
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

describe('computePlaceStat', () => {
  it('averages one score per user, taking the max for duplicates', () => {
    expect(
      computePlaceStat([
        { uid: 'a', magicScore: 8 },
        { uid: 'a', magicScore: 6 },
        { uid: 'b', magicScore: 5 },
      ])
    ).toEqual({ sum: 13, count: 2, avg: 6.5 });
  });

  it('ignores invalid scores and returns null when empty', () => {
    expect(computePlaceStat([])).toBeNull();
    expect(
      computePlaceStat([
        { uid: 'a', magicScore: 'x' },
        { uid: 'b', magicScore: NaN },
        { uid: 'c', magicScore: 11 },
      ])
    ).toBeNull();
  });
});

describe('placeKeyOf / affectedPlaceKeys', () => {
  it('skips entries without a usable placeId or category', () => {
    expect(placeKeyOf({ category: 'bars' })).toBeNull();
    expect(placeKeyOf({ placeId: '', category: 'bars' })).toBeNull();
    expect(placeKeyOf({ placeId: 'manual_123', category: 'bars' })).toBeNull();
    expect(placeKeyOf({ placeId: 'a/b', category: 'bars' })).toBeNull();
    expect(placeKeyOf({ placeId: 'p1' })).toBeNull();
    expect(placeKeyOf({ placeId: 'p1', category: 'bars' })).toEqual({ placeId: 'p1', category: 'bars' });
  });

  it('returns both keys when an entry moves, one when it stays', () => {
    const a = { placeId: 'p1', category: 'bars' };
    const b = { placeId: 'p1', category: 'brunch' };
    expect(affectedPlaceKeys(a, b).map(placeStatId)).toEqual(['p1__bars', 'p1__brunch']);
    expect(affectedPlaceKeys(a, a).map(placeStatId)).toEqual(['p1__bars']);
    expect(affectedPlaceKeys(undefined, a).map(placeStatId)).toEqual(['p1__bars']);
    expect(affectedPlaceKeys(a, undefined).map(placeStatId)).toEqual(['p1__bars']);
  });
});

describe('trigger recompute vs brute force', () => {
  it('stays equal through random rank / rerank / move / delete sequences', () => {
    const rand = rng(42);
    const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    const users = ['u1', 'u2', 'u3', 'u4'];
    const places = ['p1', 'p2', 'p3', 'manual_x', undefined];
    const categories = ['restaurants', 'bars', undefined];
    const db: Db = new Map();
    const stats = new Map<string, PlaceStat>();

    for (let step = 0; step < 2000; step++) {
      const path = `${pick(users)}/${Math.floor(rand() * 6)}`;
      const before = db.get(path);
      const op = rand();
      let after: Doc | undefined;
      if (op < 0.2) after = undefined; // delete
      else if (before && op < 0.7) after = { ...before, magicScore: Math.round(rand() * 100) / 10 }; // rerank
      else after = { placeId: pick(places), category: pick(categories), magicScore: Math.round(rand() * 100) / 10 };
      if (after) db.set(path, after);
      else db.delete(path);
      applyTrigger(db, stats, before, after);
      // Redelivery of the same event is a no-op
      if (rand() < 0.1) applyTrigger(db, stats, before, after);
      expect(stats).toEqual(bruteForce(db));
    }
    expect(stats.size).toBeGreaterThan(0);
  });
});

describe('profileFromSharedList', () => {
  it('builds a rules-valid profile', () => {
    const p = profileFromSharedList(
      'me',
      {
        ownerName: 'Ofek',
        displayName: 'Ofek Gila',
        handle: '@Ofek Gila!',
        photoURL: 'https://x/y.png',
        followingIds: ['a', 'a', 'me', 3, 'b/c', 'b'],
      },
      12.7
    );
    expect(p).toEqual({
      handle: 'ofekgila',
      handleLower: 'ofekgila',
      displayName: 'Ofek Gila',
      nameLower: 'ofek gila',
      photoURL: 'https://x/y.png',
      followingIds: ['a', 'b'],
      rankedCount: 12,
    });
  });

  it('omits missing fields and falls back to the doc ID for the owner', () => {
    expect(profileFromSharedList('me', {}, 0)).toEqual({ followingIds: [], rankedCount: 0 });
    expect(sharedListOwner('doc1', {})).toBe('doc1');
    expect(sharedListOwner('doc1', { ownerUid: 'u9' })).toBe('u9');
  });
});

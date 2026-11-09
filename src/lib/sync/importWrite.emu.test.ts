import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { PlaceCandidate, SpotCategory } from '../../types';
import { buildMatchQueries } from '../beliImport/match';
import { syntheticBeliTexts } from '../beliImport/fixtures';
import { parseBeliExport } from '../beliImport/parse';
import { buildImportPlan, createImportBatchId, undoImport } from '../beliImport/plan';
import { BeliExport, MatchResult, ScoredList } from '../beliImport/types';
import { loadBookmarks, loadRestaurants } from '../categoryLists';
import { clearEmulator, closeDevices, createDevice, MemoryStorage } from './emulatorDevice';
import { persistListChange } from './importWrite';
import { LOCAL_STORAGE_KEY, readStoredArray } from './localCache';
import { publishPublicDocs } from './publish';

function matchAll(exp: BeliExport): Record<string, MatchResult> {
  return Object.fromEntries(
    buildMatchQueries(exp).map((q) => {
      const best: PlaceCandidate = {
        placeId: `g_${q.key.replace(/[^a-z0-9]/g, '')}`,
        name: q.name,
        formattedAddress: q.city,
        city: q.city.split(',')[0],
        categories: ['restaurants'],
        cuisines: [],
        source: 'google_places',
      };
      return [q.key, { key: q.key, status: 'matched', best, candidates: [], reasons: [], query: q.name, fromCache: false } as MatchResult];
    })
  );
}

const lists = (exp: BeliExport): ScoredList[] =>
  (Object.keys(exp.lists) as SpotCategory[]).map((category) => ({ category, order: exp.lists[category]!.map((r) => r.key), anchors: [], answers: [] }));

async function cloudLists(device: ReturnType<typeof createDevice>) {
  const [r, b] = await Promise.all([
    getDocs(collection(device.db, 'users', device.uid, 'restaurants')),
    getDocs(collection(device.db, 'users', device.uid, 'bookmarks')),
  ]);
  return { restaurants: loadRestaurants(r.docs.map((d) => d.data())), bookmarks: loadBookmarks(b.docs.map((d) => d.data())) };
}

beforeEach(() => clearEmulator());
afterEach(() => closeDevices());
afterAll(() => closeDevices());

describe('Beli import write path', () => {
  // 590 ranked spots: more than one 500-write batch
  const exp = parseBeliExport(syntheticBeliTexts({ restaurants: 583 }) as any);
  const batch = createImportBatchId(Date.UTC(2026, 10, 8));
  const plan = buildImportPlan({ exp, lists: lists(exp), matches: matchAll(exp), restaurants: [], bookmarks: [], batch });

  it('writes a large import in several batches, accepted by the rules, and publishes nothing private', async () => {
    const device = createDevice('importer');
    const counts = await persistListChange(
      { prevRestaurants: [], nextRestaurants: plan.restaurants, prevBookmarks: [], nextBookmarks: plan.bookmarks },
      { db: device.db, uid: device.uid, storage: device.storage }
    );
    expect(counts).toEqual({ restaurants: 590, bookmarks: 3, deletes: 0 });
    const cloud = await cloudLists(device);
    expect(cloud.restaurants).toHaveLength(590);
    expect(cloud.bookmarks).toHaveLength(3);
    const nonna = cloud.restaurants.find((r) => r.name.startsWith('Nonna'))!;
    expect(nonna.privateNotes).toBe('Ask for the back table');
    expect(nonna.imported).toEqual({ source: 'beli', batch, key: nonna.imported!.key });
    // Stored scores are exactly what loading recomputes (no refresh writes on next load)
    const byId = new Map(plan.restaurants.map((r) => [r.id, r]));
    expect(cloud.restaurants.every((r) => r.magicScore === byId.get(r.id)!.magicScore)).toBe(true);

    await publishPublicDocs(
      device.db,
      { uid: device.uid, displayName: 'Importer', email: null, photoURL: null, handle: 'importer', restaurants: cloud.restaurants, bookmarks: cloud.bookmarks, friends: [] },
      null
    );
    const shared = JSON.stringify((await getDoc(doc(device.db, 'sharedLists', device.uid))).data());
    expect(shared).toContain('Second visit');
    expect(shared).not.toContain('Ask for the back table');
    expect(shared).not.toContain('privateNotes');
    expect(shared).not.toContain(batch);
  }, 180_000); // The emulator checks the rules for each of the ~600 docs: slow there, quick in production

  it('re-running the same change writes nothing; undo deletes exactly the batch', async () => {
    const device = createDevice('importer');
    const existing = { ...plan.restaurants[0], id: 'mine__bars', placeId: 'mine', category: 'bars' as const, imported: undefined, name: 'Mine' };
    const before = loadRestaurants([existing]); // Scored as loading would
    const withImport = buildImportPlan({ exp, lists: lists(exp), matches: matchAll(exp), restaurants: before, bookmarks: [], batch });
    const change = { prevRestaurants: before, nextRestaurants: withImport.restaurants, prevBookmarks: [], nextBookmarks: withImport.bookmarks };
    await persistListChange({ ...change, prevRestaurants: [], nextRestaurants: before, nextBookmarks: [] }, { db: device.db, uid: device.uid, storage: device.storage });
    await persistListChange(change, { db: device.db, uid: device.uid, storage: device.storage });
    // As after a reload mid-import: compare against what the cloud has now
    const cloud = await cloudLists(device);
    const again = await persistListChange(
      { prevRestaurants: cloud.restaurants, nextRestaurants: withImport.restaurants, prevBookmarks: cloud.bookmarks, nextBookmarks: withImport.bookmarks },
      { storage: new MemoryStorage() }
    );
    expect(again).toEqual({ restaurants: 0, bookmarks: 0, deletes: 0 });

    const undone = undoImport(cloud.restaurants, cloud.bookmarks, batch);
    const counts = await persistListChange(
      { prevRestaurants: cloud.restaurants, nextRestaurants: undone.restaurants, prevBookmarks: cloud.bookmarks, nextBookmarks: undone.bookmarks },
      { db: device.db, uid: device.uid, storage: device.storage }
    );
    expect(counts.deletes).toBe(593);
    const after = await cloudLists(device);
    expect(after.restaurants.map((r) => r.id)).toEqual(['mine__bars']);
    expect(after.bookmarks).toEqual([]);
  }, 300_000);

  it('signed out, the change goes to the local copy only', async () => {
    const storage = new MemoryStorage();
    const counts = await persistListChange(
      { prevRestaurants: [], nextRestaurants: plan.restaurants, prevBookmarks: [], nextBookmarks: plan.bookmarks },
      { storage }
    );
    expect(counts.restaurants).toBe(590);
    expect(readStoredArray(LOCAL_STORAGE_KEY, storage)).toHaveLength(590);
  });

  it('the rules reject malformed import details and oversized private notes', async () => {
    const device = createDevice('importer');
    const base = { ...plan.restaurants[0] };
    const ref = doc(device.db, 'users', device.uid, 'restaurants', base.id);
    const write = (data: Record<string, unknown>) => setDoc(ref, JSON.parse(JSON.stringify(data)));
    await expect(write({ ...base, imported: { source: 'beli', batch, key: 'k' } })).resolves.toBeUndefined();
    await expect(write({ ...base, imported: { source: 'yelp', batch, key: 'k' } })).rejects.toThrow();
    await expect(write({ ...base, imported: { source: 'beli', batch, key: 'k', extra: 1 } })).rejects.toThrow();
    await expect(write({ ...base, imported: { source: 'beli', batch } })).rejects.toThrow();
    await expect(write({ ...base, imported: 'beli' })).rejects.toThrow();
    await expect(write({ ...base, privateNotes: 'x'.repeat(5001) })).rejects.toThrow();
    const bm = doc(device.db, 'users', device.uid, 'bookmarks', 'b1');
    await expect(setDoc(bm, { name: 'B', privateNotes: 'ok', imported: { source: 'beli', batch, key: 'k' } })).resolves.toBeUndefined();
    await expect(setDoc(bm, { name: 'B', imported: { source: 'beli', batch: '', key: 'k' } })).rejects.toThrow();
  });
});

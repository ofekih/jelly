import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-jelly-rules',
    firestore: { rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8') },
  });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'profiles/bob'), { handle: 'bob', handleLower: 'bob', rankedCount: 3 });
    await setDoc(doc(db, 'profiles/bob/followers/carol'), { createdAt: 1 });
    await setDoc(doc(db, 'placeStats/p1__bars'), { sum: 8, count: 1, avg: 8 });
    await setDoc(doc(db, 'sharedLists/bob'), { ownerUid: 'bob', restaurants: [] });
  });
});

const anon = () => env.unauthenticatedContext().firestore();
const as = (uid: string) => env.authenticatedContext(uid).firestore();

const validProfile = {
  handle: 'alice_1',
  handleLower: 'alice_1',
  displayName: 'Alice Ng',
  nameLower: 'alice ng',
  photoURL: 'https://example.com/a.png',
  followingIds: ['bob'],
  rankedCount: 5,
  updatedAt: Date.now(),
};

describe('profiles/{uid}', () => {
  it('is publicly gettable and listable', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'profiles/bob')));
    await assertSucceeds(getDocs(collection(anon(), 'profiles')));
  });

  it('owner can create, update and delete a valid profile', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'profiles/alice'), validProfile));
    await assertSucceeds(updateDoc(doc(as('alice'), 'profiles/alice'), { rankedCount: 6 }));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'profiles/alice')));
  });

  it('nobody else can write it', async () => {
    await assertFails(setDoc(doc(anon(), 'profiles/alice'), validProfile));
    await assertFails(setDoc(doc(as('mallory'), 'profiles/alice'), validProfile));
    await assertFails(updateDoc(doc(as('mallory'), 'profiles/bob'), { rankedCount: 0 }));
    await assertFails(deleteDoc(doc(as('mallory'), 'profiles/bob')));
  });

  it('rejects invalid fields', async () => {
    const bad: Record<string, unknown>[] = [
      { ...validProfile, notes: 'private' },
      { ...validProfile, handle: 'Alice', handleLower: 'alice' },
      { ...validProfile, handle: 'has space', handleLower: 'has space' },
      { ...validProfile, handle: 'a'.repeat(31), handleLower: 'a'.repeat(31) },
      { ...validProfile, handleLower: 'someone_else' },
      { ...validProfile, nameLower: 'Alice Ng' },
      { ...validProfile, displayName: 'x'.repeat(201), nameLower: 'x'.repeat(201) },
      { ...validProfile, photoURL: 'x'.repeat(1001) },
      { ...validProfile, followingIds: Array.from({ length: 2001 }, (_, i) => `u${i}`) },
      { ...validProfile, followingIds: 'bob' },
      { ...validProfile, rankedCount: 1.5 },
      { ...validProfile, rankedCount: -1 },
      { ...validProfile, updatedAt: 'now' },
      { ...validProfile, displayName: null },
    ];
    for (const data of bad) {
      await assertFails(setDoc(doc(as('alice'), 'profiles/alice'), data));
    }
  });
});

describe('profiles/{uid}/followers/{followerUid}', () => {
  it('is publicly readable', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'profiles/bob/followers/carol')));
    await assertSucceeds(getDocs(collection(anon(), 'profiles/bob/followers')));
  });

  it('only the follower can create and delete their own edge', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'profiles/bob/followers/alice'), { createdAt: Date.now() }));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'profiles/bob/followers/alice')));
  });

  it("nobody can write someone else's follower edge", async () => {
    await assertFails(setDoc(doc(anon(), 'profiles/bob/followers/alice'), { createdAt: 1 }));
    await assertFails(setDoc(doc(as('mallory'), 'profiles/bob/followers/alice'), { createdAt: 1 }));
    await assertFails(deleteDoc(doc(as('mallory'), 'profiles/bob/followers/carol')));
    // Not even the profile owner can remove a follower edge
    await assertFails(deleteDoc(doc(as('bob'), 'profiles/bob/followers/carol')));
  });

  it('rejects self-follows, updates and invalid fields', async () => {
    await assertFails(setDoc(doc(as('bob'), 'profiles/bob/followers/bob'), { createdAt: 1 }));
    await assertFails(updateDoc(doc(as('carol'), 'profiles/bob/followers/carol'), { createdAt: 2 }));
    await assertFails(setDoc(doc(as('alice'), 'profiles/bob/followers/alice'), {}));
    await assertFails(setDoc(doc(as('alice'), 'profiles/bob/followers/alice'), { createdAt: 'now' }));
    await assertFails(setDoc(doc(as('alice'), 'profiles/bob/followers/alice'), { createdAt: 1, extra: true }));
  });
});

describe('placeStats/{id}', () => {
  it('is publicly readable', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'placeStats/p1__bars')));
    await assertSucceeds(getDocs(collection(anon(), 'placeStats')));
  });

  it('clients can never write it', async () => {
    const stat = { sum: 10, count: 1, avg: 10 };
    await assertFails(setDoc(doc(anon(), 'placeStats/p1__bars'), stat));
    await assertFails(setDoc(doc(as('alice'), 'placeStats/p1__bars'), stat));
    await assertFails(setDoc(doc(as('alice'), 'placeStats/p2__bars'), stat));
    await assertFails(deleteDoc(doc(as('alice'), 'placeStats/p1__bars')));
  });
});

describe('sharedLists', () => {
  it('can be opened one at a time by anyone, but never listed or queried', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'sharedLists/bob')));
    await assertFails(getDocs(collection(anon(), 'sharedLists')));
    await assertFails(getDocs(collection(as('alice'), 'sharedLists')));
    await assertFails(getDocs(collection(as('bob'), 'sharedLists')));
  });

  it('lets you create only your own list, and update only lists you own', async () => {
    const list = { ownerUid: 'alice', restaurants: [] };
    await assertFails(setDoc(doc(as('alice'), 'sharedLists/dave'), list));
    await assertSucceeds(setDoc(doc(as('alice'), 'sharedLists/alice'), list));
    await assertSucceeds(updateDoc(doc(as('alice'), 'sharedLists/alice'), { title: 'Mine' }));
    await assertFails(updateDoc(doc(as('alice'), 'sharedLists/bob'), { title: 'Hijack' }));
  });
});

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
    await setDoc(doc(db, 'users/bob/private/predictions'), {
      spots: { p1__bars: { score: 8.1, confidence: 'high', basis: 'Based on 3 taste-matched jelly users', raters: 3 } },
    });
    await setDoc(doc(db, 'predictionJobs/bob'), { dirtyAt: 1 });
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
      { ...validProfile, nameLower: 42 },
      { ...validProfile, nameLower: 'x'.repeat(201) },
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

  it('has no count limit on spots', async () => {
    const restaurants = Array.from({ length: 800 }, (_, i) => ({ name: `Spot ${i}`, rankIndex: i }));
    await assertSucceeds(setDoc(doc(as('alice'), 'sharedLists/alice'), { ownerUid: 'alice', restaurants }));
  });
});

describe('users/{uid}/restaurants and bookmarks: movies & shows', () => {
  const movie = {
    id: 'tmdb:movie:438631__movies',
    placeId: 'tmdb:movie:438631',
    name: 'Dune',
    formattedAddress: '2021 · Denis Villeneuve',
    category: 'movies',
    categories: ['movies'],
    cuisines: ['Sci-Fi', 'Adventure'],
    media: { year: 2021, poster: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg', creator: 'Denis Villeneuve' },
    initialRating: 8.4,
    elo: 1600,
    rankIndex: 0,
    magicScore: 8.4,
    comparisonsCount: 0,
  };

  it('accepts a ranked movie, a show and a saved title', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), `users/alice/restaurants/${movie.id}`), movie));
    const show = { ...movie, id: 'tmdb:tv:1396__tv_shows', placeId: 'tmdb:tv:1396', category: 'tv_shows', media: { year: 2008 } };
    await assertSucceeds(setDoc(doc(as('alice'), `users/alice/restaurants/${show.id}`), show));
    const { initialRating: _r, elo: _e, rankIndex: _i, magicScore: _m, comparisonsCount: _c, ...saved } = movie;
    await assertSucceeds(setDoc(doc(as('alice'), 'users/alice/bookmarks/tmdb:movie:438631'), saved));
    const book = {
      ...movie,
      id: 'book:weir:project-hail-mary__fiction',
      placeId: 'book:weir:project-hail-mary',
      category: 'fiction',
      media: { poster: 'https://books.google.com/books/content?id=x&printsec=frontcover&img=1&zoom=1&source=gbs_api', creator: 'Andy Weir' },
    };
    await assertSucceeds(setDoc(doc(as('alice'), `users/alice/restaurants/${book.id}`), book));
    const game = {
      ...movie,
      id: 'bgg:266192__board_games',
      placeId: 'bgg:266192',
      category: 'board_games',
      media: { year: 2019, poster: 'https://cf.geekdo-images.com/w.jpg', creator: 'Elizabeth Hargrave', players: [1, 5], best: [3, 3], time: [40, 70], weight: 2.48 },
    };
    await assertSucceeds(setDoc(doc(as('alice'), `users/alice/restaurants/${game.id}`), game));
    const hotel = { ...movie, id: 'ChIJhotel__stays', placeId: 'ChIJhotel', category: 'stays', media: null, priceLevel: 4 };
    await assertSucceeds(setDoc(doc(as('alice'), `users/alice/restaurants/${hotel.id}`), hotel));
    const videoGame = { ...movie, id: 'igdb:113112__video_games', placeId: 'igdb:113112', category: 'video_games', media: { year: 2020 } };
    await assertSucceeds(setDoc(doc(as('alice'), `users/alice/restaurants/${videoGame.id}`), videoGame));
  });

  it('rejects unknown or malformed media fields', async () => {
    const bad = (media: unknown) => setDoc(doc(as('alice'), `users/alice/restaurants/${movie.id}`), { ...movie, media });
    await assertFails(bad({ year: 2021, rating: 9 }));
    await assertFails(bad({ year: '2021' }));
    await assertFails(bad({ year: 2021.5 }));
    await assertFails(bad({ poster: 'x'.repeat(201) }));
    await assertFails(bad('2021'));
    await assertFails(bad({ players: [5, 1] }));
    await assertFails(bad({ players: [1, 2, 3] }));
    await assertFails(bad({ time: [0, 30] }));
    await assertFails(bad({ weight: 6 }));
  });
});

describe('users/{uid}/restaurants and bookmarks: price ranges', () => {
  const spot = {
    id: 'ChIJpizza__restaurants',
    placeId: 'ChIJpizza',
    name: 'Pizza Place',
    formattedAddress: '1 Main St, San Francisco, CA, USA',
    category: 'restaurants',
    categories: ['restaurants'],
    cuisines: ['Pizza'],
    priceLevel: 2,
    initialRating: 7,
    rankIndex: 0,
    magicScore: 7,
    comparisonsCount: 0,
  };
  const ranked = (priceRange: unknown) =>
    setDoc(doc(as('alice'), `users/alice/restaurants/${spot.id}`), { ...spot, priceRange });
  const saved = (priceRange: unknown) => {
    const { initialRating: _r, rankIndex: _i, magicScore: _m, comparisonsCount: _c, ...bookmark } = spot;
    return setDoc(doc(as('alice'), 'users/alice/bookmarks/ChIJpizza'), { ...bookmark, priceRange });
  };

  it('accepts closed, open-ended and free ranges', async () => {
    await assertSucceeds(ranked({ currency: 'USD', start: 20, end: 30 }));
    await assertSucceeds(ranked({ currency: 'EUR', start: 100 }));
    await assertSucceeds(ranked({ currency: 'USD', start: 0, end: 10 }));
    await assertSucceeds(ranked({ currency: 'IDR', start: 150000, end: 300000 }));
    await assertSucceeds(saved({ currency: 'USD', start: 20, end: 30 }));
  });

  it('rejects malformed ranges', async () => {
    for (const write of [ranked, saved]) {
      await assertFails(write({ currency: 'usd', start: 20 }));
      await assertFails(write({ currency: 'US', start: 20 }));
      await assertFails(write({ currency: 'USD' }));
      await assertFails(write({ currency: 'USD', start: -1 }));
      await assertFails(write({ currency: 'USD', start: 30, end: 20 }));
      await assertFails(write({ currency: 'USD', start: 2e9 }));
      await assertFails(write({ currency: 'USD', start: '20' }));
      await assertFails(write({ currency: 'USD', start: 20, perPerson: true }));
      await assertFails(write('$20–30'));
    }
  });
});

describe('users/{uid}/private/predictions', () => {
  it('only the owner can read it', async () => {
    await assertSucceeds(getDoc(doc(as('bob'), 'users/bob/private/predictions')));
    await assertFails(getDoc(doc(as('alice'), 'users/bob/private/predictions')));
    await assertFails(getDoc(doc(anon(), 'users/bob/private/predictions')));
    await assertFails(getDocs(collection(as('alice'), 'users/bob/private')));
  });

  it('nobody can write it from a client, not even the owner', async () => {
    const forged = { spots: { p2__bars: { score: 10, confidence: 'high', basis: 'x', raters: 9 } } };
    await assertFails(setDoc(doc(as('bob'), 'users/bob/private/predictions'), forged));
    await assertFails(updateDoc(doc(as('bob'), 'users/bob/private/predictions'), forged));
    await assertFails(deleteDoc(doc(as('bob'), 'users/bob/private/predictions')));
    await assertFails(setDoc(doc(as('alice'), 'users/alice/private/predictions'), forged));
    await assertFails(setDoc(doc(as('alice'), 'users/bob/private/predictions'), forged));
  });

  it('other docs under private/ stay closed', async () => {
    await assertFails(setDoc(doc(as('bob'), 'users/bob/private/other'), { a: 1 }));
    await assertFails(getDoc(doc(as('bob'), 'users/bob/private/other')));
  });
});

describe('predictionJobs/{uid}', () => {
  it('is server-only', async () => {
    await assertFails(getDoc(doc(as('bob'), 'predictionJobs/bob')));
    await assertFails(setDoc(doc(as('bob'), 'predictionJobs/bob'), { dirtyAt: 2 }));
    await assertFails(getDocs(collection(anon(), 'predictionJobs')));
  });
});

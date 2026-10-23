/**
 * Fills the local emulators (`npm run dev:emu`, the e2e tests) with a test account, two friends and
 * their lists. Only ever talks to emulators: it refuses to run without the emulator host variables
 * that `firebase emulators:exec` sets.
 *
 * Run on its own against running emulators: `npx tsx scripts/emulator/seed.ts`
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { TEST_USER } from '../../src/dev/emulator';
import { buildPublicLists } from '../../src/lib/publicList';
import { recomputeMagicScores } from '../../src/lib/rankingEngine';
import { buildProfileDoc } from '../../src/lib/socialService';
import { BookmarkEntry, FriendProfile, MediaInfo, RestaurantEntry, SpotCategory } from '../../src/types';

export const PROJECT_ID = 'demo-jelly-dev';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;

const T0 = Date.UTC(2026, 8, 1); // Seeded spots were "ranked" in September 2026
const DAY = 86_400_000;

interface SpotSeed {
  name: string;
  gut: number;
  city?: string;
  lat?: number;
  lng?: number;
  tags?: string[];
  notes?: string;
  media?: MediaInfo;
  placeId?: string;
  address?: string;
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const placeIdOf = (s: SpotSeed) => s.placeId ?? `seed_${slug(s.name)}`;

/** One ranked list, in rank order, scored by the real engine. */
function rankedList(category: SpotCategory, spots: SpotSeed[], dayOffset = 0): RestaurantEntry[] {
  return recomputeMagicScores(
    spots.map((s, i): RestaurantEntry => {
      const at = T0 + (dayOffset + i) * DAY;
      return {
        id: `${placeIdOf(s)}__${category}`,
        placeId: placeIdOf(s),
        name: s.name,
        formattedAddress: s.address ?? (s.city ? `${s.city}, CA` : ''),
        city: s.city,
        lat: s.lat,
        lng: s.lng,
        category,
        categories: [category],
        cuisines: s.tags ?? [],
        media: s.media,
        initialRating: s.gut,
        rankIndex: i,
        magicScore: s.gut,
        comparisonsCount: i === 0 ? 0 : 2,
        notes: s.notes,
        rankedHistory: [{ timestamp: at, initialRating: s.gut }],
        createdAt: at,
        updatedAt: at,
      };
    })
  );
}

function bookmark(category: SpotCategory, s: SpotSeed, recommendedBy?: string): BookmarkEntry {
  return {
    id: `${placeIdOf(s)}__${category}`,
    placeId: placeIdOf(s),
    name: s.name,
    formattedAddress: s.city ? `${s.city}, CA` : '',
    city: s.city,
    lat: s.lat,
    lng: s.lng,
    category,
    categories: [category],
    cuisines: s.tags ?? [],
    media: s.media,
    recommendedBy,
    createdAt: T0 + 20 * DAY,
    updatedAt: T0 + 20 * DAY,
  };
}

// Fictional places around Irvine, CA; real titles (TMDB / BGG IDs) for the title lists
const NOODLE = { name: 'Noodle Bar Uno', city: 'Irvine', lat: 33.6846, lng: -117.8265, tags: ['Japanese', 'Ramen'] };
const CASA = { name: 'Casa Verde', city: 'Tustin', lat: 33.7458, lng: -117.8262, tags: ['Mexican'] };
const DUMPLING = { name: 'Golden Dumpling House', city: 'Irvine', lat: 33.6695, lng: -117.7647, tags: ['Chinese'] };
const TRATTORIA = { name: 'Trattoria Sole', city: 'Costa Mesa', lat: 33.6411, lng: -117.9187, tags: ['Italian'] };
const BURGER = { name: 'Burger Lab', city: 'Irvine', lat: 33.6505, lng: -117.8411, tags: ['American', 'Burgers'] };
const PHO = { name: 'Pho Corner', city: 'Santa Ana', lat: 33.7455, lng: -117.8677, tags: ['Vietnamese'] };
const LUNA = { name: 'Taqueria Luna', city: 'Santa Ana', lat: 33.7492, lng: -117.8732, tags: ['Mexican'] };
const SUSHI = { name: 'Sushi Kaze', city: 'Newport Beach', lat: 33.6189, lng: -117.9298, tags: ['Japanese', 'Sushi'] };

const movie = (id: number, name: string, year: number, creator: string, gut: number): SpotSeed => ({
  name,
  gut,
  placeId: `tmdb:movie:${id}`,
  address: `${year} · ${creator}`,
  media: { year, creator },
});
const game = (id: number, name: string, gut: number, players: number[], time: number[], weight: number): SpotSeed => ({
  name,
  gut,
  placeId: `bgg:${id}`,
  media: { players, time, weight },
});

export const USERS = {
  me: TEST_USER,
  riley: { uid: 'test-riley', email: 'riley@jelly.test', name: 'Riley Friend', handle: 'rileyfriend' },
  jordan: { uid: 'test-jordan', email: 'jordan@jelly.test', name: 'Jordan Friend', handle: 'jordanfriend' },
};

const LISTS: Record<keyof typeof USERS, RestaurantEntry[]> = {
  me: [
    ...rankedList('restaurants', [
      { ...NOODLE, gut: 9.3, notes: 'Get the spicy miso' },
      { ...CASA, gut: 8.6 },
      { ...DUMPLING, gut: 8.2, notes: 'Soup dumplings, always' },
      { ...TRATTORIA, gut: 7.4 },
      { ...BURGER, gut: 6.9 },
      { ...PHO, gut: 6.0 },
    ]),
    ...rankedList('coffee_tea', [
      { name: 'Bean Theory', city: 'Irvine', lat: 33.6838, lng: -117.7944, tags: ['Cafe'], gut: 8.0 },
      { name: 'Morning Ritual', city: 'Tustin', lat: 33.7392, lng: -117.8185, tags: ['Cafe'], gut: 7.0 },
    ], 8),
    ...rankedList('movies', [
      movie(329865, 'Arrival', 2016, 'Denis Villeneuve', 9.0),
      movie(346648, 'Paddington 2', 2017, 'Paul King', 8.7),
      movie(577922, 'Tenet', 2020, 'Christopher Nolan', 6.5),
    ], 10),
    ...rankedList('board_games', [
      game(295947, 'Cascadia', 8.8, [1, 4], [30, 45], 1.8),
      game(266192, 'Wingspan', 8.1, [1, 5], [40, 70], 2.5),
      game(178900, 'Codenames', 7.2, [2, 8], [15, 15], 1.3),
    ], 13),
  ],
  riley: rankedList('restaurants', [
    { ...CASA, gut: 9.0 },
    { ...NOODLE, gut: 8.4 },
    { ...LUNA, gut: 8.0, notes: 'Al pastor tacos' },
    { ...DUMPLING, gut: 7.0 },
  ]),
  jordan: rankedList('restaurants', [
    { ...NOODLE, gut: 9.5 },
    { ...SUSHI, gut: 8.6 },
    { ...TRATTORIA, gut: 8.1 },
    { ...LUNA, gut: 7.8 },
  ]),
};

const BOOKMARKS: Record<keyof typeof USERS, BookmarkEntry[]> = {
  me: [
    bookmark('restaurants', { ...SUSHI, gut: 0 }, 'Jordan (8.6)'),
    bookmark('bakeries', { name: 'Kettle & Crumb', city: 'Costa Mesa', lat: 33.6603, lng: -117.9001, tags: ['Bakery'], gut: 0 }),
  ],
  riley: [],
  jordan: [],
};

/** Who follows whom (the app keeps a private `friends` list plus public follower edges). */
const FOLLOWS: Record<keyof typeof USERS, Array<keyof typeof USERS>> = {
  me: ['riley', 'jordan'],
  riley: ['me'],
  jordan: [],
};

async function clearEmulators(): Promise<void> {
  const firestore = await fetch(
    `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
  const auth = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' });
  if (!firestore.ok || !auth.ok) throw new Error('Could not clear the emulators – are they running?');
}

/** Wipes the emulators and writes the seed data. Safe to call repeatedly (e2e tests reset with it). */
export async function seedEmulator(): Promise<void> {
  if (!/^(127\.0\.0\.1|localhost):/.test(FIRESTORE_HOST) || !/^(127\.0\.0\.1|localhost):/.test(AUTH_HOST)) {
    throw new Error('Refusing to seed: emulator hosts must be local');
  }
  await clearEmulators();
  const app = getApps().find((a) => a.name === PROJECT_ID) ?? initializeApp({ projectId: PROJECT_ID }, PROJECT_ID);
  const db = getFirestore(app);
  const auth = getAuth(app);
  const batch = db.batch();
  const now = T0 + 30 * DAY;

  for (const key of Object.keys(USERS) as Array<keyof typeof USERS>) {
    const user = USERS[key];
    await auth.createUser({
      uid: user.uid,
      email: user.email,
      displayName: user.name,
      ...(key === 'me' ? { password: TEST_USER.password } : {}),
    });

    const restaurants = LISTS[key];
    const bookmarks = BOOKMARKS[key];
    const friends: FriendProfile[] = FOLLOWS[key].map((k) => ({
      uid: USERS[k].uid,
      name: USERS[k].name.split(' ')[0],
      handle: USERS[k].handle,
      addedAt: T0,
    }));

    for (const r of restaurants) batch.set(db.doc(`users/${user.uid}/restaurants/${r.id}`), stripUndefined(r));
    for (const b of bookmarks) batch.set(db.doc(`users/${user.uid}/bookmarks/${b.id}`), stripUndefined(b));
    batch.set(db.doc(`users/${user.uid}`), {
      handle: user.handle,
      friends,
      followingIds: friends.map((f) => f.uid),
      // Riley's follow is already seen, so no "new follower" toast covers the screen
      seenFollowerIds: key === 'me' ? [USERS.riley.uid] : [],
      defaultCity: 'Irvine',
      useCurrentLocation: false,
      updatedAt: now,
    });

    // Public docs, as `publishPublicDocs` writes them
    const lists = buildPublicLists(restaurants, bookmarks);
    const ownerName = user.name.split(' ')[0];
    batch.set(db.doc(`sharedLists/${user.uid}`), stripUndefined({
      id: user.uid,
      ownerUid: user.uid,
      ownerName,
      displayName: user.name,
      handle: user.handle,
      restaurants: lists.restaurants,
      bookmarks: lists.bookmarks,
      createdAt: T0,
      updatedAt: now,
    }));
    batch.set(db.doc(`profiles/${user.uid}`), {
      ...buildProfileDoc({
        handle: user.handle,
        displayName: user.name,
        photoURL: null,
        followingIds: friends.map((f) => f.uid),
        rankedCount: restaurants.length,
      }),
      updatedAt: now,
    });
    for (const f of friends) batch.set(db.doc(`profiles/${f.uid}/followers/${user.uid}`), { createdAt: T0 });
  }

  // Community averages (normally kept by the onRestaurantWritten function)
  const stats = new Map<string, { sum: number; count: number }>();
  for (const r of Object.values(LISTS).flat()) {
    const key = `${r.placeId}__${r.category}`;
    const s = stats.get(key) ?? { sum: 0, count: 0 };
    stats.set(key, { sum: s.sum + r.magicScore, count: s.count + 1 });
  }
  for (const [key, s] of stats) {
    batch.set(db.doc(`placeStats/${key}`), { ...s, avg: Math.round((s.sum / s.count) * 100) / 100, updatedAt: now });
  }

  // "For you" (normally written by the prediction functions)
  batch.set(db.doc(`users/${USERS.me.uid}/private/predictions`), {
    spots: {
      [`seed_${slug(LUNA.name)}__restaurants`]: {
        score: 8.3,
        confidence: 'medium',
        basis: 'Riley and Jordan liked it (strong taste matches)',
        raters: 2,
        place: { name: LUNA.name, city: LUNA.city, lat: LUNA.lat, lng: LUNA.lng, cuisines: LUNA.tags },
      },
    },
    updatedAt: now,
  });

  await batch.commit();
}

function stripUndefined<T extends object>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

if (process.argv[1] && /seed\.ts$/.test(process.argv[1])) {
  seedEmulator()
    .then(() => {
      console.log(`Seeded ${PROJECT_ID}: sign in as ${TEST_USER.email} (automatic in npm run dev:emu)`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

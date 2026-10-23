import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collection,
  deleteDoc,
  disableNetwork,
  doc,
  enableNetwork,
  getDoc,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import { BookmarkEntry, FriendProfile, RestaurantEntry } from '../../types';
import { loadRestaurants } from '../categoryLists';
import { subscribeAccountLists } from './accountLists';
import {
  clearEmulator,
  closeDevices,
  createDevice,
  Device,
  MemoryStorage,
  settle,
  waitFor,
} from './emulatorDevice';
import { reconcileFollowEdges, saveFollowChange } from './follows';
import {
  CACHE_OWNER_KEY,
  LOCAL_BOOKMARKS_KEY,
  LOCAL_STORAGE_KEY,
  readCacheOwner,
  writeCacheOwner,
} from './localCache';
import { publishPublicDocs } from './publish';
import { nameSearchKey, searchProfiles } from '../socialService';
import { mergeCloudFriends, subscribeUserDoc } from './userDoc';

const spot = (n: number, rankIndex = n, initialRating = 8): RestaurantEntry =>
  ({
    id: `p${n}__restaurants`,
    placeId: `p${n}`,
    name: `Spot ${n}`,
    formattedAddress: '',
    category: 'restaurants',
    categories: ['restaurants'],
    cuisines: [],
    initialRating,
    rankIndex,
    magicScore: initialRating,
    comparisonsCount: 0,
    createdAt: 1,
    updatedAt: 1,
  }) as RestaurantEntry;

const bookmark = (n: number): BookmarkEntry =>
  ({
    id: `b${n}`,
    placeId: `b${n}`,
    name: `Saved ${n}`,
    formattedAddress: '',
    category: 'restaurants',
    categories: ['restaurants'],
    cuisines: [],
    createdAt: n,
    updatedAt: n,
  }) as BookmarkEntry;

const friend = (uid: string, addedAt: number): FriendProfile => ({ uid, name: uid, addedAt });

type Shown = { items: Array<{ id: string }> | null };

const unsubscribers: Array<() => void> = [];

/** Subscribes `device` to its account's lists the way App does, recording what it would show. */
function watchAccount(device: Device) {
  const shown = { restaurants: { items: null } as Shown, bookmarks: { items: null } as Shown };
  unsubscribers.push(
    subscribeAccountLists({
      db: device.db,
      uid: device.uid,
      storage: device.storage,
      onRestaurants: (items) => {
        shown.restaurants.items = items;
      },
      onBookmarks: (items) => {
        shown.bookmarks.items = items;
      },
    })
  );
  return shown;
}

const cloudIds = async (device: Device, kind: string) =>
  (await getDocs(collection(device.db, 'users', device.uid, kind))).docs.map((d) => d.id).sort();

const isMirror = (device: Device) => readCacheOwner(device.storage) === device.uid;

beforeEach(() => clearEmulator());
afterEach(async () => {
  unsubscribers.splice(0).forEach((u) => u());
  await closeDevices();
});
afterAll(() => closeDevices());

describe('account lists', () => {
  it('uploads signed-out data into an empty account once, then mirrors the account', async () => {
    const phone = createDevice('alice');
    phone.storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([spot(1), spot(2)]));
    phone.storage.setItem(LOCAL_BOOKMARKS_KEY, JSON.stringify([bookmark(1)]));

    const { restaurants: ranked, bookmarks: saved } = watchAccount(phone);
    await waitFor(() => ranked.items?.length === 2 && saved.items?.length === 1);

    expect(await cloudIds(phone, 'restaurants')).toEqual(['p1__restaurants', 'p2__restaurants']);
    expect(await cloudIds(phone, 'bookmarks')).toEqual(['b1']);
    // Once both lists are confirmed, the local copy is the account's mirror
    await waitFor(() => isMirror(phone));
  });

  it("never uploads another account's local copy into a new account", async () => {
    const shared = new MemoryStorage();
    shared.setItem(LOCAL_STORAGE_KEY, JSON.stringify([spot(1)]));
    shared.setItem(CACHE_OWNER_KEY, 'alice');
    const laptop = createDevice('bob', shared);

    const ranked = watchAccount(laptop).restaurants;
    await waitFor(() => ranked.items !== null);
    await settle();

    expect(ranked.items).toEqual([]);
    expect(await cloudIds(laptop, 'restaurants')).toEqual([]);
  });

  it('keeps a bookmark deleted on one device from coming back from another', async () => {
    const phone = createDevice('alice');
    const laptop = createDevice('alice');
    const onPhone = watchAccount(phone).bookmarks;
    const onLaptop = watchAccount(laptop).bookmarks;
    await waitFor(() => isMirror(phone) && isMirror(laptop));

    await setDoc(doc(phone.db, 'users/alice/bookmarks/b1'), bookmark(1));
    await waitFor(() => onLaptop.items?.length === 1);
    expect(laptop.storage.getItem(LOCAL_BOOKMARKS_KEY)).toContain('b1');

    // Delete the last bookmark on the phone; the laptop still has it in its local copy
    await deleteDoc(doc(phone.db, 'users/alice/bookmarks/b1'));
    await waitFor(() => onLaptop.items?.length === 0 && onPhone.items?.length === 0);
    await settle();

    expect(await cloudIds(phone, 'bookmarks')).toEqual([]);
    expect(laptop.storage.getItem(LOCAL_BOOKMARKS_KEY)).toBe('[]');
  });

  it('waits for the server instead of treating an empty offline cache as an empty account', async () => {
    const phone = createDevice('alice');
    await setDoc(doc(phone.db, 'users/alice/restaurants/p1__restaurants'), spot(1));

    // A fresh device that starts offline, with signed-out data that must not be uploaded
    const tablet = createDevice('alice');
    tablet.storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([spot(9)]));
    await disableNetwork(tablet.db);
    const ranked = watchAccount(tablet).restaurants;
    await settle();
    expect(ranked.items).toBeNull();

    await enableNetwork(tablet.db);
    await waitFor(() => ranked.items?.length === 1 && isMirror(tablet));
    await settle();
    expect(ranked.items!.map((r) => r.id)).toEqual(['p1__restaurants']);
    expect(await cloudIds(phone, 'restaurants')).toEqual(['p1__restaurants']);
  });

  it('saves scores recomputed on load back to the stored docs', async () => {
    const phone = createDevice('alice');
    // Stored scores from an older scoring model: top spot stored below the one under it
    await setDoc(doc(phone.db, 'users/alice/restaurants/p1__restaurants'), { ...spot(1, 0, 9.5), magicScore: 2 });
    await setDoc(doc(phone.db, 'users/alice/restaurants/p2__restaurants'), { ...spot(2, 1, 6), magicScore: 9 });

    const ranked = watchAccount(phone).restaurants;
    await waitFor(() => ranked.items?.length === 2);
    const expected = loadRestaurants([{ ...spot(1, 0, 9.5) }, { ...spot(2, 1, 6) }]);

    await waitFor(async () => {
      const stored = await getDocs(collection(phone.db, 'users/alice/restaurants'));
      return stored.docs.every(
        (d) => d.get('magicScore') === expected.find((e) => e.id === d.id)!.magicScore
      );
    });
  });

  it('saves titles published long ago (BGG dates Chess to 1475)', async () => {
    const phone = createDevice('alice');
    const chess = {
      ...spot(1),
      id: 'bgg:171__board_games',
      placeId: 'bgg:171',
      name: 'Chess',
      category: 'board_games',
      categories: ['board_games'],
      media: { year: 1475, players: [2, 2], best: [2, 2], weight: 3.6 },
    } as RestaurantEntry;
    await setDoc(doc(phone.db, 'users/alice/restaurants/bgg:171__board_games'), chess);
    expect(await cloudIds(phone, 'restaurants')).toEqual(['bgg:171__board_games']);
  });
});

describe('follows', () => {
  it('keeps an unfollow made on one device on the others', async () => {
    const phone = createDevice('alice');
    const laptop = createDevice('alice');
    writeCacheOwner('alice', laptop.storage);
    await saveFollowChange(phone.db, 'alice', [friend('bob', 2), friend('carol', 1)], 'carol', true, phone.storage);

    let laptopFriends = [friend('bob', 2), friend('carol', 1)];
    unsubscribers.push(
      subscribeUserDoc({
        db: laptop.db,
        uid: 'alice',
        storage: laptop.storage,
        onDoc: (cloud, keepLocal) => {
          if (cloud.friends) laptopFriends = mergeCloudFriends(laptopFriends, cloud.friends, keepLocal);
        },
      })
    );

    await saveFollowChange(phone.db, 'alice', [friend('bob', 2)], 'carol', false, phone.storage);
    await waitFor(() => laptopFriends.length === 1);
    expect(laptopFriends.map((f) => f.uid)).toEqual(['bob']);
    expect((await getDoc(doc(phone.db, 'profiles/carol/followers/alice'))).exists()).toBe(false);
  });

  it('merges follows made while signed out into the account until the device mirrors it', () => {
    const merged = mergeCloudFriends([friend('dave', 3)], [friend('bob', 2)], true);
    expect(merged.map((f) => f.uid)).toEqual(['dave', 'bob']);
  });

  it('creates missing follower edges once, then trusts its record', async () => {
    const phone = createDevice('alice');
    expect(await reconcileFollowEdges(phone.db, 'alice', ['bob', 'carol', 'alice'], phone.storage)).toEqual([
      'bob',
      'carol',
    ]);
    expect((await getDoc(doc(phone.db, 'profiles/bob/followers/alice'))).exists()).toBe(true);
    expect(await reconcileFollowEdges(phone.db, 'alice', ['bob', 'carol'], phone.storage)).toEqual([]);
  });
});

describe('publishing', () => {
  for (const displayName of ['Ofek Gila', 'Zoë Ålvarez', 'ÉMILE Ünal', '李 小龍']) {
    it(`writes a shared list and a profile the rules accept (${displayName})`, async () => {
      const phone = createDevice('alice');
      const { profileJson } = await publishPublicDocs(
        phone.db,
        {
          uid: 'alice',
          displayName,
          email: 'alice@example.com',
          photoURL: null,
          handle: '',
          restaurants: [spot(1)],
          bookmarks: [bookmark(1)],
          friends: [friend('bob', 1)],
        },
        null
      );
      const profile = await getDoc(doc(phone.db, 'profiles/alice'));
      expect(profile.get('displayName')).toBe(displayName);
      expect(profile.get('handle')).toBe('alice');
      expect((await getDoc(doc(phone.db, 'sharedLists/alice'))).get('restaurants')).toHaveLength(1);
      expect(JSON.parse(profileJson).followingIds).toEqual(['bob']);
      // Findable by the start of the name, typed without accents or capitals
      const typed = nameSearchKey(displayName.split(' ')[0]).slice(0, 3);
      expect((await searchProfiles(phone.db, typed)).map((p) => p.id)).toContain('alice');
    });
  }
});

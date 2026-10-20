import {
  collection,
  doc,
  Firestore,
  onSnapshot,
  QuerySnapshot,
  Unsubscribe,
  WriteBatch,
} from 'firebase/firestore';
import { BookmarkEntry, RestaurantEntry } from '../../types';
import {
  isFromNewerVersion,
  isLegacyDoc,
  loadBookmarks,
  loadRestaurants,
  sanitizeLoadedBookmark,
  staleDerivedScores,
} from '../categoryLists';
import { commitInBatches, logWriteError, stripUndefined } from '../firestoreDoc';
import {
  defaultStorage,
  LOCAL_BOOKMARKS_KEY,
  LOCAL_STORAGE_KEY,
  readCacheOwner,
  readStoredArray,
  shouldSeedCloudFromLocal,
  writeCacheOwner,
  writeStoredArray,
} from './localCache';

export type AccountListKind = 'restaurants' | 'bookmarks';

interface Loaded<T> {
  items: T[];
  /** Writes to run before the docs can be used as-is (one-time data migrations) */
  migrate?: Array<(batch: WriteBatch) => void>;
  /** Whether the listener should wait for the migrated docs instead of showing these */
  waitForMigration?: boolean;
}

interface ListSpec<T extends { id: string }> {
  localKey: string;
  fromLocal: (raw: unknown[]) => T[];
  fromSnapshot: (snapshot: QuerySnapshot, ref: (id: string) => ReturnType<typeof doc>) => Loaded<T>;
  /** Runs once per subscription on the first server-confirmed, settled snapshot */
  onServerSnapshot?: (snapshot: QuerySnapshot, ref: (id: string) => ReturnType<typeof doc>) => Array<(batch: WriteBatch) => void>;
}

const RESTAURANTS: ListSpec<RestaurantEntry> = {
  localKey: LOCAL_STORAGE_KEY,
  fromLocal: (raw) => loadRestaurants(raw),
  fromSnapshot: (snapshot, ref) => {
    const raws: any[] = [];
    const legacyIds: string[] = [];
    snapshot.forEach((d) => {
      raws.push(d.data());
      if (isLegacyDoc(d.data())) legacyIds.push(d.id);
    });
    const items = loadRestaurants(raws);
    if (legacyIds.length === 0) return { items };
    // One-time migration from legacy meal occasions to separate category lists: drop the old
    // meal-keyed docs and write the re-keyed, per-category ranked docs
    const keepIds = new Set(items.map((r) => r.id));
    return {
      items,
      waitForMigration: true,
      migrate: [
        ...legacyIds.filter((id) => !keepIds.has(id)).map((id) => (b: WriteBatch) => b.delete(ref(id))),
        ...items.map((item) => (b: WriteBatch) => b.set(ref(item.id), stripUndefined(item))),
      ],
    };
  },
  // Scores are recomputed on load (the scoring model can change between versions); save any that
  // moved so the stored docs, and the community averages built from them, stay current
  onServerSnapshot: (snapshot, ref) => {
    const storedById = new Map(snapshot.docs.map((d) => [d.id, d.data()]));
    return staleDerivedScores(storedById, loadRestaurants([...storedById.values()])).map(
      ({ id, fields }) => (b: WriteBatch) => b.update(ref(id), { ...fields })
    );
  },
};

const BOOKMARKS: ListSpec<BookmarkEntry> = {
  localKey: LOCAL_BOOKMARKS_KEY,
  fromLocal: (raw) => loadBookmarks(raw),
  fromSnapshot: (snapshot, ref) => {
    const items: BookmarkEntry[] = [];
    const legacy: BookmarkEntry[] = [];
    snapshot.forEach((d) => {
      const data = d.data();
      if (isFromNewerVersion(data)) return;
      const bookmark = sanitizeLoadedBookmark(data);
      items.push(bookmark);
      if (isLegacyDoc(data)) legacy.push(bookmark);
    });
    items.sort((a, b) => b.createdAt - a.createdAt);
    // One-time migration: rewrite legacy bookmarks without the old meal fields
    return {
      items,
      migrate: legacy.map((bm) => (b: WriteBatch) => b.set(ref(bm.id), stripUndefined(bm))),
    };
  },
};

const SPECS = { restaurants: RESTAURANTS, bookmarks: BOOKMARKS } as const;

type ItemFor<K extends AccountListKind> = K extends 'restaurants' ? RestaurantEntry : BookmarkEntry;

export interface AccountListOptions<K extends AccountListKind> {
  db: Firestore;
  uid: string;
  kind: K;
  /** The list to show, whenever it changes (local copy is updated to match) */
  onItems: (items: ItemFor<K>[]) => void;
  /** The server has confirmed this list at least once this session */
  onServerConfirmed?: () => void;
  storage?: Storage;
}

/**
 * Keeps `users/{uid}/{kind}` and the device's local copy in step:
 * - An empty offline cache is ignored until the server confirms the list.
 * - Signed-out local data is uploaded into an empty account once, on first load only; a copy
 *   that already mirrors an account is never uploaded (see `CACHE_OWNER_KEY`).
 * - Later empties are deletions and simply show an empty list.
 */
export function subscribeAccountList<K extends AccountListKind>(options: AccountListOptions<K>): Unsubscribe {
  const { db, uid, kind, onItems, onServerConfirmed, storage = defaultStorage() } = options;
  const spec = SPECS[kind] as unknown as ListSpec<ItemFor<K>>;
  const ref = (id: string) => doc(db, 'users', uid, kind, id);
  let applied = false;
  let serverChecked = false;

  const show = (items: ItemFor<K>[], fromCache: boolean) => {
    applied = true;
    writeStoredArray(spec.localKey, items, storage);
    onItems(items);
    if (!fromCache) onServerConfirmed?.();
  };

  return onSnapshot(
    collection(db, 'users', uid, kind),
    // Metadata changes are needed to learn when the server confirms what the cache showed
    { includeMetadataChanges: true },
    async (snapshot) => {
      const { fromCache, hasPendingWrites } = snapshot.metadata;

      if (spec.onServerSnapshot && !serverChecked && !fromCache && !hasPendingWrites && !snapshot.empty) {
        serverChecked = true;
        const ops = spec.onServerSnapshot(snapshot, ref);
        if (ops.length > 0) commitInBatches(db, ops).catch(logWriteError(`refresh stored ${kind}`));
      }

      if (applied && snapshot.docChanges().length === 0) {
        if (!fromCache) onServerConfirmed?.();
        return;
      }

      if (snapshot.empty) {
        // An empty offline cache says nothing about the account; wait for the server
        if (fromCache && !applied) return;
        // Only on first load: later empties are deletions, never a reason to re-upload
        if (!applied && shouldSeedCloudFromLocal(readCacheOwner(storage), fromCache)) {
          const local = spec.fromLocal(readStoredArray(spec.localKey, storage) ?? []);
          if (local.length > 0) {
            try {
              await commitInBatches(
                db,
                local.map((item) => (b: WriteBatch) => b.set(ref(item.id), stripUndefined(item)))
              );
              return; // The listener fires again with the uploaded docs
            } catch (err) {
              logWriteError(`upload signed-out ${kind}`)(err);
            }
          }
        }
        show([], fromCache);
        return;
      }

      const loaded = spec.fromSnapshot(snapshot, ref);
      if (loaded.migrate && loaded.migrate.length > 0) {
        const committing = commitInBatches(db, loaded.migrate);
        if (loaded.waitForMigration) {
          try {
            await committing;
            return; // The listener fires again with the migrated docs
          } catch (err) {
            logWriteError(`migrate ${kind}`)(err);
          }
        } else {
          committing.catch(logWriteError(`migrate ${kind}`));
        }
      }
      show(loaded.items, fromCache);
    },
    (err) => console.error(`Firestore ${kind} subscription error:`, err)
  );
}

/**
 * Subscribes to both of the account's lists. Once the server has confirmed both, the device's
 * local copies become this account's mirror (`CACHE_OWNER_KEY`); until then they count as
 * signed-out data (see `shouldSeedCloudFromLocal`).
 */
export function subscribeAccountLists(options: {
  db: Firestore;
  uid: string;
  onRestaurants: (items: RestaurantEntry[]) => void;
  onBookmarks: (items: BookmarkEntry[]) => void;
  storage?: Storage;
}): Unsubscribe {
  const { db, uid, onRestaurants, onBookmarks, storage = defaultStorage() } = options;
  const confirmed = new Set<AccountListKind>();
  const confirm = (kind: AccountListKind) => () => {
    confirmed.add(kind);
    if (confirmed.size === 2 && readCacheOwner(storage) !== uid) writeCacheOwner(uid, storage);
  };
  const unsubs = [
    subscribeAccountList({ db, uid, kind: 'restaurants', storage, onItems: onRestaurants, onServerConfirmed: confirm('restaurants') }),
    subscribeAccountList({ db, uid, kind: 'bookmarks', storage, onItems: onBookmarks, onServerConfirmed: confirm('bookmarks') }),
  ];
  return () => unsubs.forEach((unsub) => unsub());
}

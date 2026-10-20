import { LOCAL_SETTINGS_KEY } from '../localSettings';

export const LOCAL_STORAGE_KEY = 'palatelo_restaurants_v2';
export const LEGACY_LOCAL_STORAGE_KEY = 'palate_personal_restaurants_v1';
export const LOCAL_BOOKMARKS_KEY = 'palatelo_bookmarks_v2';
export const LOCAL_FRIENDS_KEY = 'jelly_friends_v1';
export const LOCAL_SEEN_FOLLOWERS_KEY = 'jelly_seen_followers_v1';
/** Followed UIDs whose `profiles/{uid}/followers/{me}` edge is known to exist */
export const LOCAL_FOLLOW_EDGES_KEY = 'jelly_follow_edges_v1';

/**
 * UID of the account whose cloud data the local copies above mirror. Absent = signed-out data
 * that belongs to no account yet. Only signed-out data may ever be uploaded into an account,
 * and an account's mirror must never be shown to, or merged into, anyone else.
 */
export const CACHE_OWNER_KEY = 'jelly_cache_owner_v1';

/** The browser's localStorage; tests pass their own per simulated device. */
export function defaultStorage(): Storage {
  return globalThis.localStorage;
}

const ACCOUNT_KEYS = [
  LOCAL_STORAGE_KEY,
  LEGACY_LOCAL_STORAGE_KEY,
  LOCAL_BOOKMARKS_KEY,
  LOCAL_FRIENDS_KEY,
  LOCAL_SEEN_FOLLOWERS_KEY,
  LOCAL_FOLLOW_EDGES_KEY,
  CACHE_OWNER_KEY,
];

export function readCacheOwner(storage = defaultStorage()): string | null {
  try {
    return storage.getItem(CACHE_OWNER_KEY) || null;
  } catch {
    return null;
  }
}

export function writeCacheOwner(uid: string, storage = defaultStorage()): void {
  try {
    storage.setItem(CACHE_OWNER_KEY, uid);
  } catch {
    // Ignore (storage full or unavailable)
  }
}

export function readSyncedFollowEdges(storage = defaultStorage()): Set<string> {
  try {
    const parsed = JSON.parse(storage.getItem(LOCAL_FOLLOW_EDGES_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function writeSyncedFollowEdges(uids: Iterable<string>, storage = defaultStorage()): void {
  try {
    storage.setItem(LOCAL_FOLLOW_EDGES_KEY, JSON.stringify([...new Set(uids)]));
  } catch {
    // Ignore (storage full or unavailable)
  }
}

/** True when the local copies belong to an account other than `uid` (null = signed out). */
export function isForeignCache(cacheOwner: string | null, uid: string | null): boolean {
  return cacheOwner !== null && cacheOwner !== uid;
}

/**
 * Whether an empty cloud collection should be filled from the local copy: only signed-out data,
 * and only once the server (not the offline cache) has confirmed the collection is empty.
 */
export function shouldSeedCloudFromLocal(cacheOwner: string | null, fromCache: boolean): boolean {
  return cacheOwner === null && !fromCache;
}

/** Forgets every local copy of account data (lists, friends, handle) and its owner. */
export function clearAccountCache(storage = defaultStorage()): void {
  try {
    for (const key of ACCOUNT_KEYS) storage.removeItem(key);
    // The handle belongs to the account; device settings (theme, city, …) stay
    const settings = JSON.parse(storage.getItem(LOCAL_SETTINGS_KEY) || '{}');
    if (settings && typeof settings === 'object' && 'handle' in settings) {
      delete settings.handle;
      storage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
    }
  } catch {
    // Ignore (storage unavailable or settings unreadable)
  }
}

/** Reads a JSON array stored under `key`, or null when missing or unreadable. */
export function readStoredArray(key: string, storage = defaultStorage()): unknown[] | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredArray(key: string, items: unknown[], storage = defaultStorage()): void {
  try {
    storage.setItem(key, JSON.stringify(items));
  } catch {
    // Ignore (storage full or unavailable)
  }
}

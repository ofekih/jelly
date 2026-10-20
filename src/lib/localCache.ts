import { updateLocalSettings } from './localSettings';

export const LOCAL_STORAGE_KEY = 'palatelo_restaurants_v2';
export const LEGACY_LOCAL_STORAGE_KEY = 'palate_personal_restaurants_v1';
export const LOCAL_BOOKMARKS_KEY = 'palatelo_bookmarks_v2';
export const LOCAL_FRIENDS_KEY = 'jelly_friends_v1';
export const LOCAL_SEEN_FOLLOWERS_KEY = 'jelly_seen_followers_v1';

/**
 * UID of the account whose cloud data the local copies above mirror. Absent = signed-out data
 * that belongs to no account yet. Only signed-out data may ever be uploaded into an account,
 * and an account's mirror must never be shown to, or merged into, anyone else.
 */
export const CACHE_OWNER_KEY = 'jelly_cache_owner_v1';

const ACCOUNT_KEYS = [
  LOCAL_STORAGE_KEY,
  LEGACY_LOCAL_STORAGE_KEY,
  LOCAL_BOOKMARKS_KEY,
  LOCAL_FRIENDS_KEY,
  LOCAL_SEEN_FOLLOWERS_KEY,
  CACHE_OWNER_KEY,
];

export function readCacheOwner(): string | null {
  try {
    return localStorage.getItem(CACHE_OWNER_KEY) || null;
  } catch {
    return null;
  }
}

export function writeCacheOwner(uid: string): void {
  try {
    localStorage.setItem(CACHE_OWNER_KEY, uid);
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
export function clearAccountCache(): void {
  try {
    for (const key of ACCOUNT_KEYS) localStorage.removeItem(key);
  } catch {
    // Ignore (storage unavailable)
  }
  updateLocalSettings({ handle: undefined });
}

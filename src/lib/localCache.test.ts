import { beforeEach, describe, expect, it } from 'vitest';
import {
  CACHE_OWNER_KEY,
  clearAccountCache,
  isForeignCache,
  LOCAL_BOOKMARKS_KEY,
  LOCAL_STORAGE_KEY,
  readCacheOwner,
  shouldSeedCloudFromLocal,
  writeCacheOwner,
} from './localCache';
import { LOCAL_SETTINGS_KEY, readLocalSettings } from './localSettings';

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

describe('localCache', () => {
  beforeEach(() => store.clear());

  it('treats unowned data as signed-out data', () => {
    expect(readCacheOwner()).toBeNull();
    writeCacheOwner('alice');
    expect(readCacheOwner()).toBe('alice');
  });

  it('flags another account’s mirror as foreign, signed in or out', () => {
    expect(isForeignCache(null, null)).toBe(false);
    expect(isForeignCache(null, 'bob')).toBe(false);
    expect(isForeignCache('alice', 'alice')).toBe(false);
    expect(isForeignCache('alice', 'bob')).toBe(true);
    expect(isForeignCache('alice', null)).toBe(true);
  });

  it('seeds the cloud only from signed-out data the server confirmed is missing', () => {
    expect(shouldSeedCloudFromLocal(null, false)).toBe(true);
    // An empty offline cache says nothing about what the account holds
    expect(shouldSeedCloudFromLocal(null, true)).toBe(false);
    // A mirror of the account (deleted elsewhere) or of another account is never uploaded
    expect(shouldSeedCloudFromLocal('alice', false)).toBe(false);
  });

  it('clears lists, owner and handle but keeps device settings', () => {
    store.set(LOCAL_STORAGE_KEY, '[{"id":"a"}]');
    store.set(LOCAL_BOOKMARKS_KEY, '[{"id":"b"}]');
    store.set(CACHE_OWNER_KEY, 'alice');
    store.set(LOCAL_SETTINGS_KEY, JSON.stringify({ handle: 'alice', darkMode: true }));
    clearAccountCache();
    expect(store.has(LOCAL_STORAGE_KEY)).toBe(false);
    expect(store.has(LOCAL_BOOKMARKS_KEY)).toBe(false);
    expect(readCacheOwner()).toBeNull();
    expect(readLocalSettings()).toEqual({ darkMode: true });
  });
});

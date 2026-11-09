/**
 * A small key-value store on IndexedDB (database `jelly-import`), falling back to memory where
 * IndexedDB is unavailable (private mode, tests). Holds the Places lookup cache and saved import
 * sessions, so a reload or a second try costs no lookups and asks nothing again. Device-local only.
 */
export interface KeyValueStore<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

const DB_NAME = 'jelly-import';
const DB_VERSION = 1;
export const STORE_NAMES = ['lookups', 'sessions'] as const;
export type StoreName = (typeof STORE_NAMES)[number];

export function memoryStore<T>(): KeyValueStore<T> {
  const map = new Map<string, T>();
  return {
    get: async (key) => map.get(key),
    set: async (key, value) => void map.set(key, value),
    delete: async (key) => void map.delete(key),
  };
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const name of STORE_NAMES) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function request<R>(db: IDBDatabase, store: StoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<R>): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    const req = run(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The IndexedDB store, or a memory one when IndexedDB can't be opened (each call then still works, just without persistence). */
export function indexedDbStore<T>(store: StoreName): KeyValueStore<T> {
  const fallback = memoryStore<T>();
  const db = async () => {
    if (typeof indexedDB === 'undefined') return null;
    try {
      return await openDb();
    } catch {
      return null;
    }
  };
  return {
    async get(key) {
      const d = await db();
      if (!d) return fallback.get(key);
      try {
        return (await request(d, store, 'readonly', (s) => s.get(key))) as T | undefined;
      } catch {
        return fallback.get(key);
      }
    },
    async set(key, value) {
      const d = await db();
      if (!d) return fallback.set(key, value);
      try {
        await request(d, store, 'readwrite', (s) => s.put(value, key));
      } catch {
        await fallback.set(key, value);
      }
    },
    async delete(key) {
      const d = await db();
      await fallback.delete(key);
      if (!d) return;
      try {
        await request(d, store, 'readwrite', (s) => s.delete(key));
      } catch {
        // Nothing to clean up
      }
    },
  };
}

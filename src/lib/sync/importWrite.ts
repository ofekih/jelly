import { doc, Firestore, WriteBatch } from 'firebase/firestore';
import { BookmarkEntry, RestaurantEntry } from '../../types';
import { changedDocs, commitInBatches, stripUndefined } from '../firestoreDoc';
import { defaultStorage, LOCAL_BOOKMARKS_KEY, LOCAL_STORAGE_KEY, writeStoredArray } from './localCache';

/**
 * Saves a whole-list change at once (an import, or undoing one): the local copy always, and for a
 * signed-in user every new or changed doc plus the removed ones, in write batches of up to 500.
 * Batches commit in order but not atomically together: if one fails, running the same change
 * again writes only what is still missing (both lists are compared doc by doc), so an import is
 * resumable by re-running it. Publishing `sharedLists` is left to App's debounced publish, which
 * runs once when the new lists land in state.
 */
export interface ListChange {
  prevRestaurants: RestaurantEntry[];
  nextRestaurants: RestaurantEntry[];
  prevBookmarks: BookmarkEntry[];
  nextBookmarks: BookmarkEntry[];
}

export interface ListWriteCounts {
  restaurants: number;
  bookmarks: number;
  deletes: number;
}

function removed<T extends { id: string }>(prev: T[], next: T[]): string[] {
  const keep = new Set(next.map((item) => item.id));
  return prev.filter((item) => !keep.has(item.id)).map((item) => item.id);
}

/** The writes a change needs (counted, for the UI and tests) */
export function planListWrites(change: ListChange): {
  restaurants: RestaurantEntry[];
  bookmarks: BookmarkEntry[];
  deletedRestaurants: string[];
  deletedBookmarks: string[];
} {
  return {
    restaurants: changedDocs(change.nextRestaurants, change.prevRestaurants),
    bookmarks: changedDocs(change.nextBookmarks, change.prevBookmarks),
    deletedRestaurants: removed(change.prevRestaurants, change.nextRestaurants),
    deletedBookmarks: removed(change.prevBookmarks, change.nextBookmarks),
  };
}

export async function persistListChange(
  change: ListChange,
  options: { db?: Firestore; uid?: string | null; storage?: Storage } = {}
): Promise<ListWriteCounts> {
  const { db, uid, storage = defaultStorage() } = options;
  writeStoredArray(LOCAL_STORAGE_KEY, change.nextRestaurants, storage);
  writeStoredArray(LOCAL_BOOKMARKS_KEY, change.nextBookmarks, storage);
  const writes = planListWrites(change);
  const counts = {
    restaurants: writes.restaurants.length,
    bookmarks: writes.bookmarks.length,
    deletes: writes.deletedRestaurants.length + writes.deletedBookmarks.length,
  };
  if (!db || !uid) return counts;

  const ref = (kind: 'restaurants' | 'bookmarks', id: string) => doc(db, 'users', uid, kind, id);
  await commitInBatches(db, [
    ...writes.deletedRestaurants.map((id) => (b: WriteBatch) => b.delete(ref('restaurants', id))),
    ...writes.deletedBookmarks.map((id) => (b: WriteBatch) => b.delete(ref('bookmarks', id))),
    ...writes.restaurants.map((item) => (b: WriteBatch) => b.set(ref('restaurants', item.id), stripUndefined(item))),
    ...writes.bookmarks.map((item) => (b: WriteBatch) => b.set(ref('bookmarks', item.id), stripUndefined(item))),
  ]);
  return counts;
}

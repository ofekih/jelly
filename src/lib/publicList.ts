import { BookmarkEntry, RestaurantEntry } from '../types';
import { toSharedEntry } from './categoryLists';
import { stripUndefined } from './firestoreDoc';

/** Most spots / bookmarks a `sharedLists` doc may hold (`isValidSharedList` in firestore.rules). */
export const MAX_PUBLIC_ITEMS = 500;
/** Firestore's doc limit is 1 MiB; leave room for the other fields. */
export const MAX_PUBLIC_BYTES = 900_000;

export type PublicListTrim = 'none' | 'bookmarkNotes' | 'notes' | 'bookmarks' | 'spots';

function byteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function withoutNotes<T extends { notes?: string; favoriteDishes?: string }>(item: T): T {
  const { notes: _notes, favoriteDishes: _dishes, ...rest } = item;
  return rest as T;
}

/**
 * The spots and bookmarks to publish in `sharedLists/{uid}`, kept under the size and count
 * limits. When over, it drops (in order) bookmark notes, spot notes, bookmarks, then the
 * lowest-ranked spots, and reports how far it had to go.
 */
export function buildPublicLists(
  restaurants: RestaurantEntry[],
  bookmarks: BookmarkEntry[],
  maxBytes = MAX_PUBLIC_BYTES
): { restaurants: Record<string, any>[]; bookmarks: Record<string, any>[]; trimmed: PublicListTrim } {
  let spots = restaurants.map((r) => stripUndefined(toSharedEntry(r)) as Record<string, any>);
  let saved = bookmarks.map((b) => stripUndefined(b) as Record<string, any>);
  let trimmed: PublicListTrim =
    spots.length > MAX_PUBLIC_ITEMS ? 'spots' : saved.length > MAX_PUBLIC_ITEMS ? 'bookmarks' : 'none';
  // Keep the best of each list when over the count limit
  spots = [...spots].sort((a, b) => a.rankIndex - b.rankIndex).slice(0, MAX_PUBLIC_ITEMS);
  saved = saved.slice(0, MAX_PUBLIC_ITEMS);

  const fits = () => byteSize({ spots, saved }) <= maxBytes;
  if (fits()) return { restaurants: spots, bookmarks: saved, trimmed };

  saved = saved.map(withoutNotes);
  if (fits()) return { restaurants: spots, bookmarks: saved, trimmed: 'bookmarkNotes' };
  spots = spots.map(withoutNotes);
  if (fits()) return { restaurants: spots, bookmarks: saved, trimmed: 'notes' };
  saved = [];
  if (fits()) return { restaurants: spots, bookmarks: saved, trimmed: 'bookmarks' };
  while (spots.length > 0 && !fits()) spots = spots.slice(0, Math.floor(spots.length * 0.9));
  return { restaurants: spots, bookmarks: saved, trimmed: 'spots' };
}

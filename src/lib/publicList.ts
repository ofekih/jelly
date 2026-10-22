import { BookmarkEntry, RestaurantEntry } from '../types';
import { toSharedEntry } from './categoryLists';
import { stripUndefined } from './firestoreDoc';

/** Firestore's doc limit is 1 MiB (the only limit on how many spots fit); leave room for the other fields. */
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
 * The spots and bookmarks to publish in `sharedLists/{uid}`, kept under the size limit. When
 * over, it drops (in order) bookmark notes, spot notes, bookmarks, then the lowest-ranked spots
 * of every list, and reports how far it had to go.
 */
export function buildPublicLists(
  restaurants: RestaurantEntry[],
  bookmarks: BookmarkEntry[],
  maxBytes = MAX_PUBLIC_BYTES
): { restaurants: Record<string, any>[]; bookmarks: Record<string, any>[]; trimmed: PublicListTrim } {
  // Rank order across lists, so trimming keeps the best of each list
  let spots = restaurants
    .map((r) => stripUndefined(toSharedEntry(r)) as Record<string, any>)
    .sort((a, b) => a.rankIndex - b.rankIndex);
  let saved = bookmarks.map((b) => stripUndefined(b) as Record<string, any>);

  const fits = () => byteSize({ spots, saved }) <= maxBytes;
  if (fits()) return { restaurants: spots, bookmarks: saved, trimmed: 'none' };

  saved = saved.map(withoutNotes);
  if (fits()) return { restaurants: spots, bookmarks: saved, trimmed: 'bookmarkNotes' };
  spots = spots.map(withoutNotes);
  if (fits()) return { restaurants: spots, bookmarks: saved, trimmed: 'notes' };
  saved = [];
  if (fits()) return { restaurants: spots, bookmarks: saved, trimmed: 'bookmarks' };
  while (spots.length > 0 && !fits()) spots = spots.slice(0, Math.floor(spots.length * 0.9));
  return { restaurants: spots, bookmarks: saved, trimmed: 'spots' };
}

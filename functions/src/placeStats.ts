/**
 * Pure helpers for the community-average `placeStats/{placeId}__{category}` docs.
 * Kept free of Firebase imports so they can be unit-tested and reused by the backfill.
 */

export interface PlaceKey {
  placeId: string;
  category: string;
}

export interface PlaceStat {
  sum: number;
  count: number;
  avg: number;
}

/** One ranked entry as stored at `users/{uid}/restaurants/{id}`. */
export interface RankedRow {
  uid: string;
  magicScore: unknown;
}

/** `placeStats` doc ID for a (placeId, category) pair. */
export function placeStatId({ placeId, category }: PlaceKey): string {
  return `${placeId}__${category}`;
}

/**
 * The (placeId, category) a restaurant doc counts towards, or null when it can't be aggregated:
 * no placeId, manual (per-user) placeIds, IDs that aren't valid Firestore doc IDs, or no category.
 */
export function placeKeyOf(data: Record<string, unknown> | undefined | null): PlaceKey | null {
  if (!data) return null;
  const { placeId, category } = data;
  if (typeof placeId !== 'string' || !placeId || placeId.startsWith('manual_')) return null;
  if (typeof category !== 'string' || !category) return null;
  if (placeId.includes('/') || category.includes('/')) return null;
  if (placeId.length + category.length > 1000) return null;
  return { placeId, category };
}

/** Distinct place keys touched by a write (before and after), so a moved entry updates both. */
export function affectedPlaceKeys(
  before: Record<string, unknown> | undefined | null,
  after: Record<string, unknown> | undefined | null
): PlaceKey[] {
  const keys = new Map<string, PlaceKey>();
  for (const key of [placeKeyOf(before), placeKeyOf(after)]) {
    if (key) keys.set(placeStatId(key), key);
  }
  return [...keys.values()];
}

/**
 * Aggregates all ranked rows for one place: one score per user (their max, in case of duplicate
 * entries), ignoring non-finite / out-of-range scores. Returns null when nobody has ranked it.
 */
export function computePlaceStat(rows: RankedRow[]): PlaceStat | null {
  const bestByUser = new Map<string, number>();
  for (const { uid, magicScore } of rows) {
    if (typeof magicScore !== 'number' || !Number.isFinite(magicScore)) continue;
    if (magicScore < 0 || magicScore > 10) continue;
    const prev = bestByUser.get(uid);
    if (prev === undefined || magicScore > prev) bestByUser.set(uid, magicScore);
  }
  const count = bestByUser.size;
  if (count === 0) return null;
  let sum = 0;
  for (const score of bestByUser.values()) sum += score;
  return { sum, count, avg: sum / count };
}

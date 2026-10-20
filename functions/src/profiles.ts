/** Pure helpers to derive the public `profiles/{uid}` doc from a legacy `sharedLists` doc. */

export interface ProfileDoc {
  handle?: string;
  handleLower?: string;
  displayName?: string;
  nameLower?: string;
  photoURL?: string;
  followingIds: string[];
  rankedCount: number;
}

/** Same as `sanitizeHandle` in `src/lib/friendsService.ts`. */
export function sanitizeHandle(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_.-]/g, '')
    .slice(0, 30);
}

const isUid = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 150 && !v.includes('/');

/** The owner uid of a sharedLists doc (falls back to the doc ID, as the client does). */
export function sharedListOwner(docId: string, data: Record<string, unknown>): string | null {
  const uid = isUid(data.ownerUid) ? data.ownerUid : docId;
  return isUid(uid) ? uid : null;
}

/** Builds a profile that passes `isValidProfile` in firestore.rules (minus `updatedAt`). */
export function profileFromSharedList(
  uid: string,
  data: Record<string, unknown>,
  rankedCount: number
): ProfileDoc {
  const profile: ProfileDoc = {
    followingIds: [
      ...new Set((Array.isArray(data.followingIds) ? data.followingIds : []).filter(isUid)),
    ]
      .filter((id) => id !== uid)
      .slice(0, 2000),
    rankedCount: Math.max(0, Math.min(100000, Math.floor(rankedCount))),
  };
  const handle = typeof data.handle === 'string' ? sanitizeHandle(data.handle) : '';
  if (handle) {
    profile.handle = handle;
    profile.handleLower = handle;
  }
  const rawName = [data.displayName, data.ownerName].find(
    (v): v is string => typeof v === 'string' && v.trim().length > 0
  );
  if (rawName) {
    const displayName = rawName.trim().slice(0, 200);
    profile.displayName = displayName;
    profile.nameLower = displayName.toLowerCase();
  }
  if (typeof data.photoURL === 'string' && data.photoURL && data.photoURL.length <= 1000) {
    profile.photoURL = data.photoURL;
  }
  return profile;
}

/** Whether two `followingIds` values hold the same uids (order and duplicates ignored). */
export function sameIdSet(a: unknown, b: unknown): boolean {
  const toSet = (v: unknown) => new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const [sa, sb] = [toSet(a), toSet(b)];
  return sa.size === sb.size && [...sa].every((id) => sb.has(id));
}

import {
  collection,
  deleteDoc,
  doc,
  documentId,
  Firestore,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { SharedListPayload, SpotCategory } from '../types';
import { CommunityStat, sanitizeHandle } from './friendsService';

/**
 * Small public docs that replace reading everyone's `sharedLists`:
 * - `profiles/{uid}`: who someone is (friend search, follower lists)
 * - `profiles/{uid}/followers/{followerUid}`: follower edges, written by the follower
 * - `placeStats/{placeId}__{category}`: community averages, kept by a Cloud Function
 * Field rules live in `firestore.rules` (`isValidProfile`, `isValidFollower`).
 */

export interface ProfileDoc {
  handle?: string;
  handleLower?: string;
  displayName?: string;
  nameLower?: string;
  photoURL?: string;
  followingIds: string[];
  rankedCount: number;
}

const IN_QUERY_LIMIT = 30;

/**
 * Accent- and case-insensitive key for searching names by prefix ("zoe" finds "Zoë").
 * Stored as `profiles/{uid}.nameLower`; queries must use the same key.
 */
export function nameSearchKey(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** Builds `profiles/{uid}`; empty fields are omitted because the rules reject nulls. */
export function buildProfileDoc(input: {
  handle?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  followingIds: string[];
  rankedCount: number;
}): ProfileDoc {
  const profile: ProfileDoc = {
    followingIds: [...new Set(input.followingIds.filter(Boolean))].slice(0, 2000),
    rankedCount: Math.max(0, Math.min(100000, Math.floor(input.rankedCount))),
  };
  const handle = sanitizeHandle(input.handle || '');
  if (handle) {
    profile.handle = handle;
    profile.handleLower = handle;
  }
  const displayName = (input.displayName || '').trim().slice(0, 200);
  if (displayName) {
    profile.displayName = displayName;
    profile.nameLower = nameSearchKey(displayName).slice(0, 200);
  }
  if (input.photoURL && input.photoURL.length <= 1000) profile.photoURL = input.photoURL;
  return profile;
}

/**
 * A profile shown where the app expects a list (search results, follower lists). It carries no
 * spots (`profileOnly`); load `sharedLists/{uid}` before showing the list itself.
 */
export function profileToPayload(uid: string, data: any): SharedListPayload {
  const displayName =
    typeof data?.displayName === 'string' && data.displayName.trim() ? data.displayName.trim() : 'Friend';
  return {
    id: uid,
    ownerUid: uid,
    ownerName: displayName.split(' ')[0],
    displayName,
    handle: typeof data?.handle === 'string' && data.handle ? data.handle : undefined,
    photoURL: typeof data?.photoURL === 'string' && data.photoURL ? data.photoURL : undefined,
    followingIds: Array.isArray(data?.followingIds)
      ? data.followingIds.filter((id: unknown) => typeof id === 'string')
      : [],
    rankedCount: typeof data?.rankedCount === 'number' ? data.rankedCount : undefined,
    profileOnly: true,
    restaurants: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Profiles for `uids`, in the same order, skipping any that don't exist. */
export async function fetchProfiles(db: Firestore, uids: string[]): Promise<SharedListPayload[]> {
  const unique = [...new Set(uids.filter(Boolean))];
  const byUid = new Map<string, SharedListPayload>();
  await Promise.all(
    chunk(unique, IN_QUERY_LIMIT).map(async (ids) => {
      const snap = await getDocs(query(collection(db, 'profiles'), where(documentId(), 'in', ids)));
      snap.forEach((d) => byUid.set(d.id, profileToPayload(d.id, d.data())));
    })
  );
  return unique.map((uid) => byUid.get(uid)).filter((p): p is SharedListPayload => Boolean(p));
}

/** Upper bound for a prefix range query on a lowercase string field. */
export function prefixEnd(prefix: string): string {
  return prefix + '';
}

/** People whose handle or name starts with `rawQuery` (case-insensitive), handles first. */
export async function searchProfiles(
  db: Firestore,
  rawQuery: string,
  max = 10
): Promise<SharedListPayload[]> {
  const raw = rawQuery.trim().replace(/^@+/, '');
  const handleQuery = sanitizeHandle(raw);
  const nameQuery = nameSearchKey(raw);
  if (!handleQuery && !nameQuery) return [];
  const profiles = collection(db, 'profiles');
  const byField = async (field: string, q: string) =>
    q
      ? (await getDocs(query(profiles, orderBy(field), where(field, '>=', q), where(field, '<', prefixEnd(q)), limit(max)))).docs
      : [];
  const [byHandle, byName] = await Promise.all([
    byField('handleLower', handleQuery),
    byField('nameLower', nameQuery),
  ]);
  const results: SharedListPayload[] = [];
  const seen = new Set<string>();
  for (const d of [...byHandle, ...byName]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    results.push(profileToPayload(d.id, d.data()));
  }
  return results.slice(0, max);
}

export async function fetchFollowerUids(db: Firestore, uid: string): Promise<string[]> {
  const snap = await getDocs(collection(db, 'profiles', uid, 'followers'));
  return snap.docs.map((d) => d.id);
}

export interface FollowCounts {
  followers: number;
  following: number;
  followingIds: string[];
}

const followCountsCache = new Map<string, Promise<FollowCounts>>();

/** Follower and following counts for `uid` (cached for the session; `fresh` re-reads). */
export function fetchFollowCounts(db: Firestore, uid: string, fresh = false): Promise<FollowCounts> {
  const cached = followCountsCache.get(uid);
  if (cached && !fresh) return cached;
  const pending = Promise.all([
    getCountFromServer(collection(db, 'profiles', uid, 'followers')),
    getDoc(doc(db, 'profiles', uid)),
  ]).then(([count, profile]) => {
    const followingIds: string[] = Array.isArray(profile.data()?.followingIds)
      ? profile.data()!.followingIds
      : [];
    return { followers: count.data().count, following: followingIds.length, followingIds };
  });
  pending.catch(() => followCountsCache.delete(uid));
  followCountsCache.set(uid, pending);
  return pending;
}

export function invalidateFollowCounts(...uids: string[]): void {
  for (const uid of uids) followCountsCache.delete(uid);
}

/**
 * Adds or removes the edge `profiles/{targetUid}/followers/{myUid}`. Edges can't be updated,
 * so an existing one is left alone.
 */
export async function setFollowEdge(
  db: Firestore,
  myUid: string,
  targetUid: string,
  following: boolean
): Promise<void> {
  if (!myUid || !targetUid || myUid === targetUid) return;
  const ref = doc(db, 'profiles', targetUid, 'followers', myUid);
  if (!following) {
    await deleteDoc(ref);
  } else if (!(await getDoc(ref)).exists()) {
    await setDoc(ref, { createdAt: Date.now() });
  }
  invalidateFollowCounts(myUid, targetUid);
}

/** `placeStats` doc ID for a spot in one list, or null when it has no shared stats. */
export function placeStatKey(placeId: string | undefined, category: SpotCategory | undefined): string | null {
  if (!placeId || !category || placeId.startsWith('manual_') || placeId.includes('/')) return null;
  return `${placeId}__${category}`;
}

/** Reads `placeStats` docs by ID; missing ones map to null (nobody has ranked that spot). */
export async function fetchPlaceStats(
  db: Firestore,
  keys: string[]
): Promise<Record<string, CommunityStat | null>> {
  const result: Record<string, CommunityStat | null> = {};
  for (const key of keys) result[key] = null;
  await Promise.all(
    chunk([...new Set(keys)], IN_QUERY_LIMIT).map(async (ids) => {
      const snap = await getDocs(query(collection(db, 'placeStats'), where(documentId(), 'in', ids)));
      snap.forEach((d) => {
        const data = d.data();
        if (typeof data.sum === 'number' && typeof data.count === 'number') {
          result[d.id] = { sum: data.sum, count: data.count };
        }
      });
    })
  );
  return result;
}

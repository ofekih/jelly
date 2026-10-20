import { doc, Firestore, onSnapshot, setDoc, Unsubscribe } from 'firebase/firestore';
import { FriendProfile } from '../../types';
import { defaultStorage, readCacheOwner } from './localCache';

/** What `users/{uid}` holds that the app shows (the owner's private settings and follows). */
export interface CloudUserDoc {
  defaultCity?: string;
  linearRatingScale?: boolean;
  useCurrentLocation: boolean;
  handle?: string;
  seenFollowerIds?: string[];
  friends?: FriendProfile[];
}

export function parseUserDoc(data: Record<string, any>): CloudUserDoc {
  return {
    defaultCity: typeof data.defaultCity === 'string' ? data.defaultCity : undefined,
    linearRatingScale: typeof data.linearRatingScale === 'boolean' ? data.linearRatingScale : undefined,
    useCurrentLocation: typeof data.useCurrentLocation === 'boolean' ? data.useCurrentLocation : true,
    handle: typeof data.handle === 'string' && data.handle.trim() ? data.handle.trim() : undefined,
    seenFollowerIds: Array.isArray(data.seenFollowerIds)
      ? data.seenFollowerIds.filter((id: unknown): id is string => typeof id === 'string')
      : undefined,
    friends: Array.isArray(data.friends)
      ? data.friends.filter((f: any): f is FriendProfile => Boolean(f) && typeof f.uid === 'string')
      : undefined,
  };
}

/**
 * The friends list to show after the cloud copy changes. Once the device mirrors the account the
 * cloud list wins, so unfollows made on other devices stick; until then (signed-out follows not
 * yet in the account) local follows are merged in. Newest first.
 */
export function mergeCloudFriends(
  local: FriendProfile[],
  cloud: FriendProfile[],
  keepLocal: boolean
): FriendProfile[] {
  const byUid = new Map<string, FriendProfile>();
  if (keepLocal) for (const f of local) byUid.set(f.uid, f);
  for (const f of cloud) byUid.set(f.uid, f);
  return [...byUid.values()].sort((a, b) => b.addedAt - a.addedAt);
}

export function subscribeUserDoc(options: {
  db: Firestore;
  uid: string;
  /** `keepLocalFriends`: whether local follows should be merged in (see `mergeCloudFriends`) */
  onDoc: (userDoc: CloudUserDoc, keepLocalFriends: boolean) => void;
  storage?: Storage;
}): Unsubscribe {
  const { db, uid, onDoc, storage = defaultStorage() } = options;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) return;
      onDoc(parseUserDoc(snap.data()), readCacheOwner(storage) !== uid);
    },
    (err) => console.error('Firestore user doc subscription error:', err)
  );
}

/** Saves who `uid` follows (private `friends` with names, plus `followingIds`). */
export function saveFollows(db: Firestore, uid: string, friends: FriendProfile[]): Promise<void> {
  return setDoc(
    doc(db, 'users', uid),
    { friends, followingIds: friends.map((f) => f.uid), updatedAt: Date.now() },
    { merge: true }
  );
}

import { Firestore } from 'firebase/firestore';
import { FriendProfile } from '../../types';
import { setFollowEdge } from '../socialService';
import { defaultStorage, readSyncedFollowEdges, writeSyncedFollowEdges } from './localCache';
import { saveFollows } from './userDoc';

/**
 * Adds or removes `profiles/{friendUid}/followers/{uid}` and remembers on the device which edges
 * are known to exist (so `reconcileFollowEdges` doesn't re-check them).
 */
export async function syncFollowEdge(
  db: Firestore,
  uid: string,
  friendUid: string,
  following: boolean,
  storage: Storage = defaultStorage()
): Promise<void> {
  await setFollowEdge(db, uid, friendUid, following);
  const synced = readSyncedFollowEdges(storage);
  if (following) synced.add(friendUid);
  else synced.delete(friendUid);
  writeSyncedFollowEdges(synced, storage);
}

/**
 * Saves a follow or unfollow of `friendUid`: the private list in `users/{uid}` (`friends` is the
 * full list after the change) and the public follower edge.
 */
export async function saveFollowChange(
  db: Firestore,
  uid: string,
  friends: FriendProfile[],
  friendUid: string,
  following: boolean,
  storage: Storage = defaultStorage()
): Promise<void> {
  await Promise.all([
    saveFollows(db, uid, friends),
    syncFollowEdge(db, uid, friendUid, following, storage),
  ]);
}

/**
 * Creates the follower edge for any follow that doesn't have one yet on this device's record
 * (follows from before edges existed, or made on an older app version). Returns the UIDs synced.
 */
export async function reconcileFollowEdges(
  db: Firestore,
  uid: string,
  friendUids: string[],
  storage: Storage = defaultStorage()
): Promise<string[]> {
  const done = readSyncedFollowEdges(storage);
  const missing = [...new Set(friendUids)].filter((f) => f && f !== uid && !done.has(f));
  if (missing.length === 0) return [];
  const results = await Promise.all(
    missing.map((friendUid) =>
      setFollowEdge(db, uid, friendUid, true).then(
        () => friendUid,
        () => null
      )
    )
  );
  const synced = results.filter((f): f is string => f !== null);
  writeSyncedFollowEdges([...readSyncedFollowEdges(storage), ...synced], storage);
  return synced;
}

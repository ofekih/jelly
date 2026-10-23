import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { FriendProfile, SharedListPayload } from '../types';
import { fetchProfiles, parseSharedListDoc } from './socialService';

/** Live subscription to each followed friend's list (one doc each, only re-sent when it changes). */
export function useFriendListSubscriptions(
  friends: FriendProfile[],
  setFriendLists: Dispatch<SetStateAction<Record<string, SharedListPayload>>>
): void {
  const friendDocKey = friends
    .map((f) => `${f.uid}=${f.shareId || f.uid}`)
    .sort()
    .join('|');
  useEffect(() => {
    if (!friendDocKey) return;
    const unsubs = friendDocKey.split('|').map((pair) => {
      const [friendUid, shareDocId] = pair.split('=');
      return onSnapshot(
        doc(db, 'sharedLists', shareDocId),
        (snap) => {
          if (!snap.exists()) return;
          const parsed = parseSharedListDoc(snap.id, snap.data());
          setFriendLists((prev) => ({ ...prev, [friendUid]: parsed }));
        },
        () => {}
      );
    });
    return () => unsubs.forEach((unsub) => unsub());
  }, [friendDocKey, setFriendLists]);
}

/** People following `uid`: edges in profiles/{uid}/followers, shown with their public profiles. */
export function useFollowers(uid: string | undefined): SharedListPayload[] {
  const [followers, setFollowers] = useState<SharedListPayload[]>([]);
  useEffect(() => {
    setFollowers([]);
    if (!uid) return;
    let cancelled = false;
    const unsub = onSnapshot(
      collection(db, 'profiles', uid, 'followers'),
      (snapshot) => {
        const uids = snapshot.docs.map((d) => d.id);
        fetchProfiles(db, uids)
          .then((profiles) => {
            if (!cancelled) setFollowers(profiles);
          })
          .catch(() => {});
      },
      () => {}
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [uid]);
  return followers;
}

import { deleteField, doc, Firestore, setDoc } from 'firebase/firestore';
import { BookmarkEntry, FriendProfile, RestaurantEntry } from '../../types';
import { deriveDefaultHandle, sanitizeHandle } from '../friendsService';
import { buildPublicLists } from '../publicList';
import { buildProfileDoc } from '../socialService';

export interface PublishInput {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  handle: string;
  restaurants: RestaurantEntry[];
  bookmarks: BookmarkEntry[];
  friends: FriendProfile[];
}

/**
 * Writes the public docs friends read: `sharedLists/{uid}` (the list behind your link) and
 * `profiles/{uid}` (search, follower lists). The profile is only rewritten when it differs from
 * `lastProfileJson` (what this session last wrote); pass the returned `profileJson` next time.
 */
export async function publishPublicDocs(
  db: Firestore,
  input: PublishInput,
  lastProfileJson: string | null
): Promise<{ lists: ReturnType<typeof buildPublicLists>; profileJson: string }> {
  const { uid, displayName, email, photoURL } = input;
  const ownerName = displayName ? displayName.split(' ')[0] : 'Friend';
  const handle = sanitizeHandle(input.handle) || deriveDefaultHandle(displayName, email);
  const lists = buildPublicLists(input.restaurants, input.bookmarks);

  const payload: Record<string, unknown> = {
    id: uid,
    ownerUid: uid,
    ownerName,
    displayName: displayName || ownerName,
    handle,
    restaurants: lists.restaurants,
    bookmarks: lists.bookmarks,
    // Who you follow is public on profiles/{uid}; drop the old copy here
    followingIds: deleteField(),
    updatedAt: Date.now(),
  };
  if (photoURL) payload.photoURL = photoURL;

  const profile = buildProfileDoc({
    handle,
    displayName: displayName || ownerName,
    photoURL,
    followingIds: input.friends.map((f) => f.uid),
    rankedCount: input.restaurants.length,
  });
  const profileJson = JSON.stringify(profile);

  await Promise.all([
    setDoc(doc(db, 'sharedLists', uid), payload, { merge: true }),
    profileJson === lastProfileJson
      ? null
      : setDoc(doc(db, 'profiles', uid), { ...profile, updatedAt: Date.now() }),
  ]);
  return { lists, profileJson };
}

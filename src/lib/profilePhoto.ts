import { deleteField, doc, Firestore, setDoc } from 'firebase/firestore';

/**
 * Uploaded profile pictures. The file lives in Storage at `profilePhotos/{uid}/<name>.webp|jpg`
 * (storage.rules), its download URL in `users/{uid}.customPhotoURL` (firestore.rules), and the
 * picture you see everywhere is `displayPhotoURL`: the uploaded one, else the Google photo.
 * The Storage SDK is only loaded when someone uploads or removes a picture.
 */

/** The photo to show for an account: the uploaded picture, else the sign-in (Google) photo. */
export function displayPhotoURL(
  user: { photoURL?: string | null } | null | undefined,
  customPhotoURL?: string | null
): string | null {
  return customPhotoURL || user?.photoURL || null;
}

/** `profilePhotos/{uid}/…` from one of `uid`'s download URLs, or null for anything else. */
export function profilePhotoPath(url: string, uid: string): string | null {
  const match = /\/o\/([^?#]+)/.exec(url);
  if (!match) return null;
  let path: string;
  try {
    path = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const prefix = `profilePhotos/${uid}/`;
  return path.startsWith(prefix) && !path.slice(prefix.length).includes('/') ? path : null;
}

/** A fresh file name per upload, so browsers and CDNs never show a stale picture. */
export function newProfilePhotoName(type: string, now = Date.now()): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${now.toString(36)}-${random}.${type === 'image/webp' ? 'webp' : 'jpg'}`;
}

let emulatorConnected = false;

/** Storage for `db`'s app, loaded on first use (the Storage emulator under `npm run dev:emu`). */
async function storageApi(db: Firestore) {
  const storage = await import('firebase/storage');
  const instance = storage.getStorage(db.app);
  if (import.meta.env.MODE === 'emulator' && !emulatorConnected) {
    storage.connectStorageEmulator(instance, '127.0.0.1', 9199);
    emulatorConnected = true;
  }
  return { storage, instance };
}

async function deleteProfilePhotoFile(db: Firestore, uid: string, url: string | null | undefined): Promise<void> {
  const path = url ? profilePhotoPath(url, uid) : null;
  if (!path) return;
  const { storage, instance } = await storageApi(db);
  await storage.deleteObject(storage.ref(instance, path)).catch((err: unknown) => {
    // Already gone is fine; anything else only leaves an unused file behind
    console.warn('Could not delete the previous profile photo:', err);
  });
}

/**
 * Uploads `photo` (from `renderCroppedPhoto`), points `users/{uid}.customPhotoURL` at it, then
 * deletes `previousURL`'s file. Returns the new URL.
 */
export async function saveProfilePhoto(
  db: Firestore,
  uid: string,
  photo: Blob,
  previousURL?: string | null
): Promise<string> {
  const { storage, instance } = await storageApi(db);
  const fileRef = storage.ref(instance, `profilePhotos/${uid}/${newProfilePhotoName(photo.type)}`);
  await storage.uploadBytes(fileRef, photo, {
    contentType: photo.type,
    cacheControl: 'public, max-age=31536000, immutable',
  });
  const url = await storage.getDownloadURL(fileRef);
  await setDoc(doc(db, 'users', uid), { customPhotoURL: url, updatedAt: Date.now() }, { merge: true });
  if (previousURL && previousURL !== url) void deleteProfilePhotoFile(db, uid, previousURL);
  return url;
}

/** Back to the Google photo (or initials): clears `customPhotoURL` and deletes the file. */
export async function removeProfilePhoto(db: Firestore, uid: string, previousURL?: string | null): Promise<void> {
  await setDoc(doc(db, 'users', uid), { customPhotoURL: deleteField(), updatedAt: Date.now() }, { merge: true });
  await deleteProfilePhotoFile(db, uid, previousURL);
}

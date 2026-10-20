import { FieldValue, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import {
  buildCorpus,
  computeUserPredictions,
  toRankedDoc,
  toSpotDoc,
  type CorpusUser,
  type RankedDoc,
  type SpotDoc,
  type StoredPrediction,
} from './predictions';

/**
 * Keeps `users/{uid}/private/predictions` current:
 * - Writes to a user's spots mark `predictionJobs/{uid}` dirty (`markPredictionsDirty`).
 * - Every minute, jobs quiet for `QUIET_MS` (or dirty for `MAX_WAIT_MS`) are recomputed
 *   (`runPredictionJobs`), so a burst of re-ranks costs one recompute.
 * - Nightly, everyone is recomputed (`recomputeAllPredictions`) to pick up others' changes.
 */

export const QUIET_MS = 45 * 1000;
export const MAX_WAIT_MS = 5 * 60 * 1000;

export const predictionsDoc = (db: Firestore, uid: string) => db.doc(`users/${uid}/private/predictions`);
const jobDoc = (db: Firestore, uid: string) => db.doc(`predictionJobs/${uid}`);

export async function markPredictionsDirty(db: Firestore, uid: string, now = Date.now()): Promise<void> {
  await jobDoc(db, uid).set({ dirtyAt: now }, { merge: true });
}

/** Everyone's ranked spots, plus bookmarks and follows for the users being computed. */
async function loadCorpusUsers(db: Firestore, targets: string[] | 'all'): Promise<CorpusUser[]> {
  const users = new Map<string, CorpusUser>();
  const userFor = (uid: string) => {
    let user = users.get(uid);
    if (!user) users.set(uid, (user = { uid, entries: [] }));
    return user;
  };

  const ranked = await db
    .collectionGroup('restaurants')
    .select('placeId', 'name', 'city', 'neighborhood', 'lat', 'lng', 'category', 'cuisines', 'magicScore')
    .get();
  for (const d of ranked.docs) {
    // Only `users/{uid}/restaurants/{id}` counts
    if (d.ref.parent.parent?.parent.id !== 'users') continue;
    const entry: RankedDoc | null = toRankedDoc(d.data());
    if (entry) userFor(d.ref.parent.parent.id).entries.push(entry);
  }

  const targetUids = targets === 'all' ? [...users.keys()] : targets;
  await Promise.all(
    targetUids.map(async (uid) => {
      const snap = await db.collection(`users/${uid}/bookmarks`).select('placeId', 'name', 'city', 'neighborhood', 'lat', 'lng', 'category', 'cuisines').get();
      userFor(uid).bookmarks = snap.docs.map((d) => toSpotDoc(d.data())).filter((b): b is SpotDoc => b !== null);
    })
  );

  // Who the targets follow, and the names of those people (friends may be named in the basis)
  const profileRefs = (uids: Iterable<string>) => [...new Set(uids)].map((uid) => db.doc(`profiles/${uid}`));
  const readProfiles = async (uids: Iterable<string>) => {
    const refs = profileRefs(uids);
    return refs.length > 0 ? db.getAll(...refs) : [];
  };
  const followed = new Set<string>();
  for (const snap of await readProfiles(targetUids)) {
    const ids = snap.get('followingIds');
    const followingIds = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
    userFor(snap.id).followingIds = followingIds;
    followingIds.forEach((id) => users.has(id) && followed.add(id));
  }
  for (const snap of await readProfiles(followed)) {
    const name = snap.get('displayName') || snap.get('handle');
    if (typeof name === 'string' && name) users.get(snap.id)!.displayName = name;
  }
  return [...users.values()];
}

/** JSON with sorted keys, to tell whether a stored doc already says the same thing. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Writes the doc only when it changed (so the app's listener isn't woken up for nothing). */
async function writePredictions(db: Firestore, uid: string, spots: Record<string, StoredPrediction>): Promise<boolean> {
  const ref = predictionsDoc(db, uid);
  const existing = await ref.get();
  if (Object.keys(spots).length === 0) {
    if (!existing.exists) return false;
    await ref.delete();
    return true;
  }
  if (existing.exists && canonical(existing.get('spots')) === canonical(spots)) return false;
  await ref.set({ spots, updatedAt: FieldValue.serverTimestamp() });
  return true;
}

/** Recomputes and stores predictions for `uids` (or everyone with a ranked spot). */
export async function recomputePredictions(db: Firestore, uids: string[] | 'all'): Promise<{ users: number; written: number }> {
  const corpus = buildCorpus(await loadCorpusUsers(db, uids));
  const targets = uids === 'all' ? [...corpus.users.keys()] : uids;
  let written = 0;
  for (const uid of targets) {
    if (await writePredictions(db, uid, computeUserPredictions(corpus, uid))) written += 1;
  }
  return { users: targets.length, written };
}

export const recomputeAllPredictions = (db: Firestore) => recomputePredictions(db, 'all');

/** Recomputes every job that's ready, then clears it unless it was marked dirty again meanwhile. */
export async function runPredictionJobs(db: Firestore, now = Date.now()): Promise<string[]> {
  const jobs = await db.collection('predictionJobs').get();
  const ready = jobs.docs.filter((job: DocumentSnapshot) => {
    const dirtyAt = job.get('dirtyAt');
    return (
      (typeof dirtyAt === 'number' ? dirtyAt <= now - QUIET_MS : true) ||
      job.createTime!.toMillis() <= now - MAX_WAIT_MS
    );
  });
  if (ready.length === 0) return [];

  const uids = ready.map((job) => job.id);
  await recomputePredictions(db, uids);
  await Promise.all(
    ready.map((job) =>
      job.ref.delete({ lastUpdateTime: job.updateTime! }).catch((err) => {
        // Marked dirty again while computing: leave it for the next run
        logger.debug('prediction job still dirty', { uid: job.id, err: String(err) });
      })
    )
  );
  return uids;
}

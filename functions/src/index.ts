import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { affectedPlaceKeys, placeStatId } from './placeStats';
import { markPredictionsDirty, recomputeAllPredictions, runPredictionJobs } from './predictionJobs';
import { recomputePlaceStat } from './recompute';

initializeApp();

/**
 * Keeps the community average for a spot (`placeStats`) in sync with everyone's rankings, and
 * queues a recompute of the user's own taste predictions.
 */
export const onRestaurantWritten = onDocumentWritten(
  'users/{uid}/restaurants/{id}',
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    // Only placeId, category or magicScore changes affect the stats
    if (
      before && after &&
      before.placeId === after.placeId &&
      before.category === after.category &&
      before.magicScore === after.magicScore
    ) {
      return;
    }
    const keys = affectedPlaceKeys(before, after);
    const db = getFirestore();
    await Promise.all([
      ...keys.map((key) => recomputePlaceStat(db, key)),
      markPredictionsDirty(db, event.params.uid),
    ]);
    if (keys.length > 0) logger.debug('placeStats recomputed', { keys: keys.map(placeStatId) });
  }
);

/** Bookmarks get predictions too, so adding or moving one queues a recompute. */
export const onBookmarkWritten = onDocumentWritten('users/{uid}/bookmarks/{id}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (before && after && before.placeId === after.placeId && before.category === after.category) return;
  await markPredictionsDirty(getFirestore(), event.params.uid);
});

/** Recomputes the predictions of users whose spots changed (debounced via `predictionJobs`). */
export const processPredictionJobs = onSchedule(
  { schedule: 'every 1 minutes', timeoutSeconds: 300, memory: '512MiB', retryCount: 0 },
  async () => {
    const uids = await runPredictionJobs(getFirestore());
    if (uids.length > 0) logger.info('predictions recomputed', { users: uids.length });
  }
);

/** Recomputes everyone's predictions nightly, so other people's new rankings show up. */
export const nightlyPredictions = onSchedule(
  { schedule: 'every day 04:00', timeZone: 'America/Los_Angeles', timeoutSeconds: 540, memory: '1GiB' },
  async () => {
    const result = await recomputeAllPredictions(getFirestore());
    logger.info('nightly predictions', result);
  }
);

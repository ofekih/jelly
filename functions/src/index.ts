import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { affectedPlaceKeys, placeStatId } from './placeStats';
import { recomputePlaceStat } from './recompute';

initializeApp();

/** Keeps the community average for a spot (`placeStats`) in sync with everyone's rankings. */
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
    await Promise.all(keys.map((key) => recomputePlaceStat(db, key)));
    if (keys.length > 0) logger.debug('placeStats recomputed', { keys: keys.map(placeStatId) });
  }
);

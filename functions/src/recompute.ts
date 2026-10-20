import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { computePlaceStat, placeStatId, type PlaceKey } from './placeStats';

/**
 * Recomputes `placeStats/{placeId}__{category}` from scratch with a collection-group query, so
 * at-least-once / out-of-order trigger delivery always converges on the right value.
 * Deletes the stats doc when nobody has the place ranked any more.
 */
export async function recomputePlaceStat(db: Firestore, key: PlaceKey): Promise<void> {
  const query = db
    .collectionGroup('restaurants')
    .where('placeId', '==', key.placeId)
    .where('category', '==', key.category);
  const ref = db.collection('placeStats').doc(placeStatId(key));
  // In a transaction so overlapping triggers for the same place can't commit a stale read last
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(query);
    const rows = snap.docs
      // Only `users/{uid}/restaurants/{id}` counts; ignore any other `restaurants` collections
      .filter((d) => d.ref.parent.parent?.parent.id === 'users')
      .map((d) => ({ uid: d.ref.parent.parent!.id, magicScore: d.get('magicScore') }));
    const stat = computePlaceStat(rows);
    if (stat) tx.set(ref, { ...stat, updatedAt: FieldValue.serverTimestamp() });
    else tx.delete(ref);
  });
}

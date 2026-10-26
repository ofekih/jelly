import type { Firestore } from 'firebase-admin/firestore';
import { placeStatId, type PlaceKey } from './placeStats';

/**
 * Keeps public reviews (`placeReviews/{placeId}__{category}/reviews/{uid}`) in step with the
 * author's list: `score` follows their stored `magicScore` (which shifts whenever the list is
 * re-fitted), and the review goes when the spot leaves their list.
 */

export type ReviewSync = 'none' | 'delete' | { score: number };

/** What to do with an existing review, given the author's entry (undefined when it's gone). */
export function reviewSyncAction(entryScore: unknown, entryExists: boolean, reviewScore: unknown): ReviewSync {
  if (!entryExists || typeof entryScore !== 'number' || !Number.isFinite(entryScore)) return 'delete';
  return entryScore === reviewScore ? 'none' : { score: entryScore };
}

/**
 * Re-reads the review and the entry in a transaction, so an Undo that restores the entry between
 * the trigger and this write never loses the review. Only the review exists check runs outside it,
 * since most spots have none.
 */
export async function syncPlaceReview(db: Firestore, uid: string, key: PlaceKey): Promise<void> {
  const id = placeStatId(key);
  const reviewRef = db.doc(`placeReviews/${id}/reviews/${uid}`);
  if (!(await reviewRef.get()).exists) return;
  const entryRef = db.doc(`users/${uid}/restaurants/${id}`);
  await db.runTransaction(async (tx) => {
    const [review, entry] = await tx.getAll(reviewRef, entryRef);
    if (!review.exists) return;
    const action = reviewSyncAction(entry.get('magicScore'), entry.exists, review.get('score'));
    if (action === 'delete') tx.delete(reviewRef);
    else if (action !== 'none') tx.update(reviewRef, { score: action.score });
  });
}

/**
 * Recounts a review's thumbs up / down from its `votes` (a recount, not an increment, so retried
 * or concurrent triggers still land on the right numbers). Skipped once the review is gone.
 */
export async function recountReviewVotes(db: Firestore, placeKey: string, authorUid: string): Promise<void> {
  const reviewRef = db.doc(`placeReviews/${placeKey}/reviews/${authorUid}`);
  const votes = reviewRef.collection('votes');
  const [up, down] = await Promise.all([
    votes.where('value', '==', 1).count().get(),
    votes.where('value', '==', -1).count().get(),
  ]);
  try {
    await reviewRef.update({ up: up.data().count, down: down.data().count });
  } catch (err: any) {
    // NOT_FOUND: the review was deleted meanwhile
    if (err?.code !== 5) throw err;
  }
}

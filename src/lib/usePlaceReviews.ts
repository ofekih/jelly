import { useCallback, useEffect, useState } from 'react';
import { db } from '../firebase';
import {
  CachedReviews,
  getCachedAuthor,
  getCachedReviews,
  loadReviews,
  ReviewAuthor,
  subscribeReviewCache,
} from './reviews';

/**
 * A spot's public reviews from the session cache, loading them on first use. `reviews` is
 * undefined while loading; `failed` is set when the read failed (offline, etc.).
 */
export function usePlaceReviews(key: string | null, myUid?: string | null) {
  const [, setVersion] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => subscribeReviewCache(() => setVersion((v) => v + 1)), []);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setFailed(false);
    loadReviews(db, key, myUid).catch((err) => {
      console.error('Failed to load reviews:', err);
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [key, myUid]);

  const cached: CachedReviews | undefined = key ? getCachedReviews(key) : undefined;
  // A cache entry written only by your own post (at 0) hasn't loaded everyone else's yet
  const reviews = cached && cached.at > 0 ? cached.reviews : undefined;
  const author = useCallback((uid: string): ReviewAuthor | null | undefined => getCachedAuthor(uid), []);
  return { reviews, failed, author };
}

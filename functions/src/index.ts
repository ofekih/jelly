import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { affectedPlaceKeys, placeStatId } from './placeStats';
import { markPredictionsDirty, recomputeAllPredictions, runPredictionJobs } from './predictionJobs';
import { sameIdSet } from './profiles';
import { recomputePlaceStat } from './recompute';
import { cleanQuery, searchTitles } from './tmdb';
import { searchBooks } from './books';

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

/**
 * Following or unfollowing someone changes whose ratings weigh more, so it queues a recompute.
 * A new display name queues the followers too, since friends can be named in the basis.
 */
export const onProfileWritten = onDocumentWritten('profiles/{uid}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  const { uid } = event.params;
  const db = getFirestore();
  const jobs: Promise<void>[] = [];
  if (!sameIdSet(before?.followingIds, after?.followingIds)) jobs.push(markPredictionsDirty(db, uid));
  if (before && after && before.displayName !== after.displayName) {
    const followers = await db.collection(`profiles/${uid}/followers`).select().get();
    jobs.push(...followers.docs.map((d) => markPredictionsDirty(db, d.id)));
  }
  await Promise.all(jobs);
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

const tmdbReadToken = defineSecret('TMDB_READ_TOKEN');

/**
 * Movie & TV search for the Watch lists, served at `/api/tmdb/search?q=` through a Hosting
 * rewrite, so the CDN caches repeat searches and the TMDB token never reaches the browser.
 */
export const tmdb = onRequest(
  { secrets: [tmdbReadToken], memory: '256MiB', maxInstances: 5, timeoutSeconds: 20 },
  async (req, res) => {
    const query = cleanQuery(req.query.q);
    if (req.method !== 'GET' || !req.path.endsWith('/search') || !query) {
      res.status(400).json({ error: 'Expected GET /api/tmdb/search?q=<title>' });
      return;
    }
    try {
      const results = await searchTitles(query, tmdbReadToken.value());
      res.set('Cache-Control', 'public, max-age=3600, s-maxage=604800');
      res.json({ results });
    } catch (err) {
      logger.warn('TMDB search failed', { query, err: String(err) });
      res.set('Cache-Control', 'no-store');
      res.status(502).json({ error: 'Search is unavailable right now' });
    }
  }
);

const googleBooksKey = defineSecret('GOOGLE_BOOKS_API_KEY');

/** Book search for the Read lists, served at `/api/books/search?q=` like `tmdb` above. */
export const books = onRequest(
  { secrets: [googleBooksKey], memory: '256MiB', maxInstances: 5, timeoutSeconds: 20 },
  async (req, res) => {
    const query = cleanQuery(req.query.q);
    if (req.method !== 'GET' || !req.path.endsWith('/search') || !query) {
      res.status(400).json({ error: 'Expected GET /api/books/search?q=<title or author>' });
      return;
    }
    try {
      const results = await searchBooks(query, googleBooksKey.value());
      res.set('Cache-Control', 'public, max-age=3600, s-maxage=604800');
      res.json({ results });
    } catch (err) {
      logger.warn('Google Books search failed', { query, err: String(err) });
      res.set('Cache-Control', 'no-store');
      res.status(502).json({ error: 'Search is unavailable right now' });
    }
  }
);

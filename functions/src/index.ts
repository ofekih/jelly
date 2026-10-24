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
import { searchBoardGames, searchVideoGames } from './games';
import { appHtml, cardHeading, listPreview, parseSharePath, previewMeta, siteOrigin, withShareMeta } from './sharePage';

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

const bggToken = defineSecret('BGG_API_TOKEN');
const twitchClientId = defineSecret('TWITCH_CLIENT_ID');
const twitchClientSecret = defineSecret('TWITCH_CLIENT_SECRET');

/** One title search endpoint: validates `?q=`, caches successes on the CDN, hides upstream errors. */
function titleSearch(name: string, search: (query: string) => Promise<unknown[]>) {
  return async (req: { method: string; path: string; query: Record<string, unknown> }, res: any) => {
    const query = cleanQuery(req.query.q);
    if (req.method !== 'GET' || !req.path.endsWith('/search') || !query) {
      res.status(400).json({ error: `Expected GET /api/${name}/search?q=<name>` });
      return;
    }
    try {
      const results = await search(query);
      res.set('Cache-Control', 'public, max-age=3600, s-maxage=604800');
      res.json({ results });
    } catch (err) {
      logger.warn(`${name} search failed`, { query, err: String(err) });
      res.set('Cache-Control', 'no-store');
      res.status(502).json({ error: 'Search is unavailable right now' });
    }
  };
}

/** Board & card game search for the Play lists, served at `/api/bgg/search?q=` like `tmdb` above. */
export const bgg = onRequest(
  { secrets: [bggToken], memory: '256MiB', maxInstances: 5, timeoutSeconds: 30 },
  titleSearch('bgg', (q) => searchBoardGames(q, bggToken.value()))
);

/** Video game search for the Play lists, served at `/api/igdb/search?q=`. */
export const igdb = onRequest(
  { secrets: [twitchClientId, twitchClientSecret], memory: '256MiB', maxInstances: 5, timeoutSeconds: 20 },
  titleSearch('igdb', (q) => searchVideoGames(q, twitchClientId.value(), twitchClientSecret.value()))
);

/**
 * Share links, `/l/<uid>?c=<category>`: the app's page with that list's link preview (title, top
 * three, card image), and the card itself at `/l/<uid>/card.png`. See `sharePage.ts`.
 */
export const sharePage = onRequest(
  { memory: '512MiB', maxInstances: 10, timeoutSeconds: 20 },
  async (req, res) => {
    const target = parseSharePath(req.path);
    if (!target || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.redirect(302, '/');
      return;
    }
    const { shareId } = target;
    const snap = await getFirestore()
      .doc(`sharedLists/${shareId}`)
      .get()
      .catch((err) => {
        logger.warn('share preview: list read failed', { shareId, err: String(err) });
        return null;
      });
    const preview = snap?.exists ? listPreview(snap.data()!, req.query.c) : null;

    if (target.kind === 'card') {
      if (!preview) {
        res.set('Cache-Control', 'public, max-age=60').status(404).send('Not found');
        return;
      }
      const { renderCardPng } = await import('./shareCardImage');
      const png = await renderCardPng(cardHeading(preview), preview.spots);
      // Preview URLs carry the list's updatedAt, so a cached card is never stale for long
      res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400').type('png').send(png);
      return;
    }

    const origin = siteOrigin(req.get('x-forwarded-host'));
    const html = await appHtml(origin);
    const page = html && (preview ? withShareMeta(html, previewMeta(preview, shareId, origin)) : html);
    if (!page) {
      // The app opens the older link form too, just without the preview
      const c = typeof req.query.c === 'string' ? `&c=${encodeURIComponent(req.query.c)}` : '';
      res.redirect(302, `/?list=${shareId}${c}`);
      return;
    }
    res.set('Cache-Control', 'public, max-age=0, s-maxage=300').type('html').send(page);
  }
);

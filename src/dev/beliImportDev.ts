import type { Auth } from 'firebase/auth';
import { collection, Firestore, getDocs } from 'firebase/firestore';
import type { SpotCategory } from '../types';
import { loadBookmarks, loadRestaurants } from '../lib/categoryLists';
import {
  alreadyImported,
  answerBoundaryQuestion,
  bucketOf,
  buildImportPlan,
  buildMatchQueries,
  createImportBatchId,
  importBatches,
  matchPlaces,
  mergedOrder,
  nextBoundaryQuestion,
  persistListChange,
  readBeliFiles,
  startBoundaryMerge,
  suggestAnchors,
  undoImport,
  type MatchDecision,
  type ScoredList,
} from '../lib/beliImport';
import { syntheticBeliZip, syntheticPlacesSearch } from '../lib/beliImport/fixtures';
import { memoryStore } from '../lib/beliImport/store';
import { LOCAL_BOOKMARKS_KEY, LOCAL_STORAGE_KEY, readStoredArray } from '../lib/sync/localCache';

/**
 * Emulator only (`npm run dev:emu`): drives a whole Beli import of the synthetic export from the
 * console, with canned Places answers, so the engine can be checked end to end before any UI
 * exists. `await jellyDevBeliImport.run()` then `jellyDevBeliImport.undo()`.
 */
async function currentLists(db: Firestore, auth: Auth) {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    return {
      uid: null,
      restaurants: loadRestaurants(readStoredArray(LOCAL_STORAGE_KEY) ?? []),
      bookmarks: loadBookmarks(readStoredArray(LOCAL_BOOKMARKS_KEY) ?? []),
    };
  }
  const [r, b] = await Promise.all([
    getDocs(collection(db, 'users', uid, 'restaurants')),
    getDocs(collection(db, 'users', uid, 'bookmarks')),
  ]);
  return { uid, restaurants: loadRestaurants(r.docs.map((d) => d.data())), bookmarks: loadBookmarks(b.docs.map((d) => d.data())) };
}

export function installBeliImportDev(db: Firestore, auth: Auth): void {
  const api = {
    async run(options: { restaurants?: number; linear?: boolean } = {}) {
      const zip = syntheticBeliZip({ restaurants: options.restaurants ?? 40 });
      const file = new File([zip], 'synthetic_beli_export.zip', { type: 'application/zip' });
      const exp = await readBeliFiles([file]);
      const before = await currentLists(db, auth);
      const queries = buildMatchQueries(exp, alreadyImported(before.restaurants, before.bookmarks));
      const run = await matchPlaces(queries, { search: syntheticPlacesSearch, store: memoryStore() });
      // Reviews: take the best guess; not found: add as custom spots
      const decisions: Record<string, MatchDecision> = {};
      for (const r of Object.values(run.results)) {
        if (r.status === 'review' && r.best) decisions[r.key] = { kind: 'place', candidate: r.best };
        if (r.status === 'not_found') decisions[r.key] = { kind: 'manual' };
      }
      const lists: ScoredList[] = (Object.keys(exp.lists) as SpotCategory[]).map((category) => {
        const keys = exp.lists[category]!.map((r) => r.key);
        // The user says the bottom quarter was "fine"; answer the boundary as if the best fine spot beat one liked spot
        let merge = startBoundaryMerge(keys, { firstFine: Math.ceil(keys.length * 0.75) });
        let first = true;
        for (let q = nextBoundaryQuestion(merge); q; q = nextBoundaryQuestion(merge)) {
          merge = answerBoundaryQuestion(merge, first ? 'lower' : 'upper');
          first = false;
        }
        const order = mergedOrder(merge);
        const buckets = bucketOf(merge);
        const picks = suggestAnchors(order, 'quick', buckets);
        const ratings = [9.4, 7.2, 4.8];
        const anchors = picks.map((key, i) => ({ key, rating: ratings[Math.min(i, ratings.length - 1)], source: 'user' as const }));
        return { category, order, anchors, buckets, answers: merge.answers };
      });
      const plan = buildImportPlan({
        exp,
        lists,
        matches: run.results,
        decisions,
        restaurants: before.restaurants,
        bookmarks: before.bookmarks,
        linear: options.linear,
        batch: createImportBatchId(),
      });
      const t0 = performance.now();
      const writes = await persistListChange(
        { prevRestaurants: before.restaurants, nextRestaurants: plan.restaurants, prevBookmarks: before.bookmarks, nextBookmarks: plan.bookmarks },
        { db, uid: before.uid }
      );
      return { batch: plan.batch, progress: run.progress, summary: plan.summary, writes, ms: Math.round(performance.now() - t0), report: exp.report };
    },
    async batches() {
      const { restaurants, bookmarks } = await currentLists(db, auth);
      return importBatches(restaurants, bookmarks);
    },
    async undo(batch?: string) {
      const before = await currentLists(db, auth);
      const target = batch ?? importBatches(before.restaurants, before.bookmarks)[0]?.batch;
      if (!target) return null;
      const undone = undoImport(before.restaurants, before.bookmarks, target);
      const writes = await persistListChange(
        { prevRestaurants: before.restaurants, nextRestaurants: undone.restaurants, prevBookmarks: before.bookmarks, nextBookmarks: undone.bookmarks },
        { db, uid: before.uid }
      );
      return { batch: target, removed: undone.removedSpotIds.length + undone.removedBookmarkIds.length, writes };
    },
  };
  (window as unknown as { jellyDevBeliImport: typeof api }).jellyDevBeliImport = api;
}

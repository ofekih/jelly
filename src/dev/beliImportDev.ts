import type { Auth } from 'firebase/auth';
import { collection, Firestore, getDocs } from 'firebase/firestore';
import type { SpotCategory } from '../types';
import { loadBookmarks, loadRestaurants } from '../lib/categoryLists';
import {
  answerMergeQuestion,
  buildImportPlan,
  buildMatchQueries,
  createImportBatchId,
  estimateScores,
  importBatches,
  jellyMergeEstimates,
  matchPlaces,
  mergeOrder,
  nextMergeQuestion,
  persistListChange,
  readBeliFiles,
  sharedSpots,
  startBucketMerge,
  startJellyMerge,
  undoImport,
  type MatchDecision,
  type MergeState,
  type ScoredList,
} from '../lib/beliImport';
import { syntheticBeliZip, syntheticPlacesSearch } from '../lib/beliImport/fixtures';
import { memoryStore } from '../lib/beliImport/store';
import { LOCAL_BOOKMARKS_KEY, LOCAL_STORAGE_KEY, readStoredArray } from '../lib/sync/localCache';

/**
 * Emulator only (`npm run dev:emu`): drives a whole Beli import of the synthetic export from the
 * console, with canned Places answers and a simulated user (hidden true scores: the bottom
 * quarter is Beli's "fine" bucket and overlaps the bottom of "liked"; gut ratings are the truth
 * plus noise; side-by-sides answered from the truth), so the engine can be checked end to end
 * before any UI exists. `await jellyDevBeliImport.run({ rate: 0.5 })` then `jellyDevBeliImport.undo()`.
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
    async run(options: { restaurants?: number; rate?: number } = {}) {
      const rate = options.rate ?? 1; // Share of spots the simulated user gives a gut rating
      const zip = syntheticBeliZip({ restaurants: options.restaurants ?? 40 });
      const file = new File([zip], 'synthetic_beli_export.zip', { type: 'application/zip' });
      const exp = await readBeliFiles([file]);
      const before = await currentLists(db, auth);
      const run = await matchPlaces(buildMatchQueries(exp), { search: syntheticPlacesSearch, store: memoryStore() });
      // Reviews: take the best guess; not found: add as custom spots
      const decisions: Record<string, MatchDecision> = {};
      for (const r of Object.values(run.results)) {
        if (r.status === 'review' && r.best) decisions[r.key] = { kind: 'place', candidate: r.best };
        if (r.status === 'not_found') decisions[r.key] = { kind: 'manual' };
      }
      let questions = 0;
      const answerAll = (state: MergeState, truth: Record<string, number>) => {
        let s = state;
        for (let q = nextMergeQuestion(s); q; q = nextMergeQuestion(s)) {
          s = answerMergeQuestion(s, truth[q.candidate] > truth[q.other] ? 'candidate' : 'other');
          questions++;
        }
        return s;
      };
      const lists: ScoredList[] = (Object.keys(exp.lists) as SpotCategory[]).map((category) => {
        const keys = exp.lists[category]!.map((r) => r.key);
        const firstFine = Math.ceil(keys.length * 0.75);
        // Hidden truth: liked 9.5→6.0, fine 7.0→4.0 (overlapping, as Beli's buckets do)
        const truth: Record<string, number> = Object.fromEntries(
          keys.map((k, i) => [k, i < firstFine ? 9.5 - (3.5 * i) / Math.max(1, firstFine - 1) : 7.0 - (3 * (i - firstFine)) / Math.max(1, keys.length - firstFine - 1)])
        );
        const guts: Record<string, number> = {};
        keys.forEach((k, i) => {
          if ((i * 0.618) % 1 < rate) guts[k] = Math.round(Math.min(10, Math.max(1, truth[k] + Math.sin(i * 12.9898) * 0.6)) * 10) / 10;
        });
        const bucketMerge = answerAll(startBucketMerge(keys, { firstFine }, estimateScores(keys, guts)), truth);
        const beliOrder = mergeOrder(bucketMerge);
        const jelly = before.restaurants.filter((r) => r.category === category).sort((a, b) => a.rankIndex - b.rankIndex);
        let order = beliOrder;
        let answers = bucketMerge.answers;
        if (jelly.length > 0) {
          const shared = sharedSpots(exp.lists[category]!, category, before.restaurants, run.results, decisions);
          for (const r of jelly) truth[r.id] = r.magicScore;
          const jellyMerge = answerAll(startJellyMerge(beliOrder, jelly.map((r) => r.id), shared, jellyMergeEstimates(beliOrder, guts, jelly)), truth);
          order = mergeOrder(jellyMerge);
          answers = [...answers, ...jellyMerge.answers];
        }
        return { category, order, guts, answers };
      });
      const plan = buildImportPlan({
        exp,
        lists,
        matches: run.results,
        decisions,
        restaurants: before.restaurants,
        bookmarks: before.bookmarks,
        batch: createImportBatchId(),
      });
      const t0 = performance.now();
      const writes = await persistListChange(
        { prevRestaurants: before.restaurants, nextRestaurants: plan.restaurants, prevBookmarks: before.bookmarks, nextBookmarks: plan.bookmarks },
        { db, uid: before.uid }
      );
      return { batch: plan.batch, questions, progress: run.progress, summary: plan.summary, writes, ms: Math.round(performance.now() - t0), report: exp.report };
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

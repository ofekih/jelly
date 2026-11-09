# Beli import engine

A one-time "Import from Beli" for users switching apps. Everything here is pure and tested, with
no UI. The screens build on the API below (exported from `index.ts`, types in `types.ts`). Keep it
stable: add things, don't rename them.

Beli's CSV export has **no scores, no place IDs and no addresses**. The engine therefore:
1. parses it,
2. finds each place on Google,
3. rebuilds jelly scores from Beli's order plus a few answers from the user,
4. merges the result into the user's existing lists.

Never commit a real export: it holds the person's email and phone number. `*_data_export.zip` is
gitignored. Tests and the emulator use the synthetic export in `fixtures.ts`
(`scripts/emulator/beli-synthetic-export.zip`).

## Flow (what the UX does, in order)

This is a one-time import: re-imports aren't supported.

| Step | Call | Notes |
|---|---|---|
| 1. Pick file(s) | `readBeliFiles(files)` → `BeliExport` | Takes one `.zip` or loose CSVs. Only the five CSVs are opened; photos, devices, profile and the rest are listed by name only. Throws `BeliImportError` (`not_zip`, `no_rankings`, `not_beli`). Show `report`. |
| 2. Resume | `loadImportSession(exp.fingerprint)` | Earlier answers for this export. Save with `saveImportSession` after every answer. |
| 3. Find places (background) | `matchPlaces(buildMatchQueries(exp), { apiKey, signal, onProgress, onResult })` | Ranked spots and bookmarks of one place share a lookup. Cached on the device for 30 days. Cancel with an `AbortController`. `run.fatal` means Google refused the key. |
| 4. Bucket boundaries, per list | `BucketBounds` | "Tap the first spot Beli scores below ≈6.7, then below ≈3.4", read off the Beli app. Optional: without them the whole list counts as one run. |
| 5. Gut ratings, per list (can run during step 3) | `nextToRate(order, guts)`, `listAccuracy(order, guts)` | Ask in this order: #1, last, middle, then the middle of each gap. Show `typicalError` live. The user may stop at any point. A spot without a rating stays without one. |
| 6. Merge Beli's buckets | `startBucketMerge(keys, bounds, estimateScores(keys, guts))`, then `nextMergeQuestion` / `answerMergeQuestion(s, 'candidate' \| 'other' \| 'tie')` until it returns null | No cap. `q.remaining` drives a progress bar. `finishMerge` places what's left by estimate if the user stops. |
| 7. Review places | `MatchResult.status`: `matched` (auto), `review` (top 3 `candidates` + `reasons`), `not_found`, `error` (run step 3 again) | The decision per key is `MatchDecision`: `place`, `manual` (custom spot) or `skip`. |
| 8. Merge with the jelly list (only if that list has spots; needs step 7) | `startJellyMerge(mergeOrder(bucketMerge), jellyIds, sharedSpots(rows, category, restaurants, matches, decisions), jellyMergeEstimates(beliOrder, guts, jellyList))`, then the same question loop | The shorter list is inserted into the longer one. A place in both lists is one spot: no question, and it bounds its neighbours. |
| 9. Preview + write | `plan = buildImportPlan({ exp, lists, matches, decisions, restaurants, bookmarks, batch: createImportBatchId() })`, then `persistListChange({ prev…, next… }, { db, uid })` | `lists` holds one `{ category, order: mergeOrder(jellyMerge or bucketMerge), guts, answers: [...bucket.answers, ...jelly.answers] }` per list. Show `plan.summary`. Then set App state to `plan.restaurants` / `plan.bookmarks`, so App publishes `sharedLists` **once**. |
| Undo | `importBatches`, `undoImport(restaurants, bookmarks, batch)`, `persistListChange(…)` | Removes every spot and bookmark of the batch; the rest are refit back. `editedSinceImport` counts re-ranked ones for the `ConfirmModal`. `batchTime(batch)` gives the import time, for a 30-day window. |

A console version of the whole flow, with canned Places answers and a simulated user, runs under
`npm run dev:emu`: `await jellyDevBeliImport.run({ rate: 0.5 })`, `await jellyDevBeliImport.undo()`
(`src/dev/beliImportDev.ts`).

## Rebuilding the order: merge sort's merge, with the user as the comparison

Beli asks liked / fine / didn't like first. It compares spots only within that bucket and spreads
scores in thirds, so the export is **three sorted runs stacked**: the order inside a run is earned,
the order across a boundary is forced. The user's jelly list is a fourth sorted run. The true order
is their merge (`merge.ts`):
- fine into liked;
- didn't-like into that;
- then the shorter of Beli and jelly into the longer.

**How each spot is placed.** The search starts where the estimated scores put it. Fresh gut
ratings make that estimate close, so a right guess is confirmed in about 2 questions; a wrong one
gallops outward (1, 2, 4 places) and then bisects. A spot never lands above the one before it in
its run.

**Simulated cost** (realistic bucket mistakes: ~84 of a 300-spot list's "fine" spots truly beat
the worst "liked" one). Questions for an exact merge:

| List | Guided by gut ratings | Galloping from the bottom | Ranking every spot |
|---|---|---|---|
| 300 spots | ~210 | ~470 | ~2,500 |
| 100 spots | ~60 | ~110 | ~660 |
| 300 spots + 40 in jelly | ~430 | – | – |

Answers are stored on the imported entries as `comparisons`.

## Scores: gut ratings, never guessed

jelly's `magicScore` is gut ratings fitted to the order. A spot without a gut rating has **no**
`initialRating`: the fit (`fitScoresToOrder`, which now takes `null`) treats it as unknown, and its
score comes from the order and the rated spots around it. `fitScoresWithSpread` also returns each
score's posterior spread, which is what `listAccuracy` reports.

Simulated error (RMS, score points) by how many spots are rated:

| List | 3 rated | 20 rated | 60 rated | all rated |
|---|---|---|---|---|
| 300 spots | 1.0 | 0.33 | 0.25 | 0.13 |
| 100 spots | 0.8 | 0.34 | 0.21 | 0.19 |

Rating every spot matches a list ranked in jelly. Picking which spots to rate adaptively barely
beats the even spread of `ratingOrder`.

**Older app versions.** Before this change, a loaded spot without `initialRating` defaulted to 8.
An old cached app on another device would score unrated imports as 8s, and its load-time refresh
would write those scores back until that device updates. Ship the reading side (this branch's
`rankingEngine` / `categoryLists`) before the import UI, and let devices update.

## Lists that already have spots

- **A place in both lists** keeps its jelly entry untouched, notes included (`summary.duplicates`).
- **The jelly merge** (step 8) settles the order exactly.
- **If it was skipped**, `buildImportPlan` falls back: the longest run of shared spots that both
  orders agree on pins the two orders together, and new spots are woven in by estimated score
  between those pins (`mergeIntoList`). Shared spots the orders disagree on are reported in
  `summary.orderConflicts`.
- **Beli bookmarks** go to Want to try in the mapped list. They are skipped when already saved (any
  list) or already ranked in that list.

## Fields and privacy

| Beli | jelly | Public? |
|---|---|---|
| Rank (per list) | order → `rankIndex`, `magicScore` (recomputed) | yes |
| Notes | `notes` (several joined by a blank line) | yes |
| Favorite Dishes | `favoriteDishes` (bookmarks: appended to `notes`) | yes |
| Private Notes | `privateNotes` | **no**: `toSharedEntry` / `toSharedBookmark` strip it |
| Created Date | `createdAt`, one `rankedHistory` event (no `initialRating` if unrated) | yes |
| (import) | `imported: { source: 'beli', batch, key }` | **no**: stripped |
| Visit Dates, labels | dropped (labels by decision; both parsed and counted) | – |
| follows.csv | `exp.follows`, returned only, never stored | – |

`comparisonsCount` is the number of merge answers the spot carries.
`placeSpot` carries `privateNotes` and `imported` through a re-rank or a move.

## Cost (Google Places)

- One **Text Search Pro** call per distinct (name, city), with `IMPORT_FIELD_MASK` in
  `placesService.ts`: no Enterprise fields, so no `priceLevel` / `priceRange` / `serves*`.
  `usePriceBackfill` fills prices later, when a spot's sheet opens.
- A typical export (~380 ranked + ~210 bookmarks) is about 600 calls.
- Text Search Pro gives 5,000 free calls a month, then costs $32 per 1,000. That's about 8 free
  imports a month, then about $19 per import.
- It is a separate SKU from normal search (Enterprise + Atmosphere), so imports don't use up
  search's free calls.

**Guards**
- Device cache: 30 days, Google's limit for caching place content.
- Concurrency of 4.
- On 429 or 5xx, all workers back off together (exponential with jitter, up to 30 s, 5 retries).
- A refused key (403/400) stops the run at once.
- A hard cap of 1.1 × queries + 5 calls per run.
- Cancel.

## Writes and server load

**Signed in**
- `persistListChange` writes only new, changed and removed docs, in batches of up to 500.
- The batches aren't atomic together. Re-running the same change writes only what is missing,
  so an interrupted write is resumed by re-running it.
- **Signed out:** the local copy only. Today that copy is uploaded only into an *empty* account on
  first sign-in, so a signed-out import followed by signing in to an account that already has
  spots never reaches the cloud. The UX should say so, or require sign-in.

**Server load** (an import of about 600 docs)
- About 600 `onRestaurantWritten` / `onBookmarkWritten` runs, plus the existing spots of touched
  lists, whose scores were refit.
- Each run recomputes that spot's `placeStats`.
- Predictions are debounced: every write runs `markPredictionsDirty`, which sets `predictionJobs/{uid}.dirtyAt`, and the
  every-minute job waits until it has been quiet for `QUIET_MS` (45 s; at most `MAX_WAIT_MS`, 5 min). So one import recomputes
  predictions about once. That is also ~600 quick writes to one doc: some may hit contention, which is harmless because the last one wins.

## Files

- `parse.ts`, `csv.ts`: zip/CSV reading, joins, report.
- `match.ts`, `store.ts`: lookups, scoring, cache.
- `merge.ts`: merging sorted runs with questions.
- `scores.ts`: rating order, estimates, accuracy.
- `plan.ts`: building entries, merging, bookmarks, undo.
- `session.ts`: saved answers.
- `fixtures.ts`: the synthetic export and fake Places search.
- `../sync/importWrite.ts`: persisting.

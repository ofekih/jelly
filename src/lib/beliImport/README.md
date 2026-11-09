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

| Step | Call | Notes |
|---|---|---|
| 1. Pick file(s) | `readBeliFiles(files)` → `BeliExport` | Takes one `.zip` or loose CSVs. Only the five CSVs are opened; photos, devices, profile and the rest are listed by name only. Throws `BeliImportError` (`not_zip`, `no_rankings`, `not_beli`). Show `report` (unknown list codes, bad rows, trimmed notes). |
| 2. Resume | `loadImportSession(exp.fingerprint)` | Earlier answers for this export (`ImportSession`). Save with `saveImportSession` after every answer. |
| 3. Find places (background) | `buildMatchQueries(exp, alreadyImported(restaurants, bookmarks))`, then `matchPlaces(queries, { apiKey, signal, onProgress, onResult })` | Ranked spots and bookmarks of one place share a lookup. Re-imports skip rows already imported. Cached on the device for 30 days, so a reload or a second try is free. Cancel with an `AbortController`. Show `progress` (`apiCalls`, `fromCache`, `backingOff`). `run.fatal` means Google refused the key: stop and say so. |
| 4. Fix Beli's buckets, per list (can run during step 3) | `startBoundaryMerge(keys, bounds)`, then `nextBoundaryQuestion` / `answerBoundaryQuestion` | See **Scores** below. `bounds` comes from "tap the first spot Beli scores below ≈6.7 / ≈3.4" (optional). Each answer is `'lower' \| 'upper' \| 'tie' \| 'skip'`. When `state.paused`, ask "keep going?" and call `continueBoundary`. `mergedOrder(state)` is always valid. |
| 5. Gut ratings, per list | `suggestAnchors(order, 'quick' \| 'more', bucketOf(state))` | Rate these on the normal spectrum. The user may add any other spot. Skipping uses `presetAnchors`. Ratings are `{ key, rating, source: 'user' }`. |
| 6. Review places | `MatchResult.status`: `matched` (auto), `review` (show `candidates`, top 3, and `reasons`), `not_found`, `error` (retry by running step 3 again) | The decision per key is `MatchDecision`: `{ kind: 'place', candidate }`, `{ kind: 'manual' }` (custom spot) or `{ kind: 'skip' }`. A place found through normal search is passed as `place`. |
| 7. Preview + write | `plan = buildImportPlan({ exp, lists, matches, decisions, restaurants, bookmarks, linear, batch: createImportBatchId() })`, then `persistListChange({ prev…, next… }, { db, uid })` | `lists` holds one `ScoredList` per list to import: `{ category, order: mergedOrder(s), anchors, buckets: bucketOf(s), answers: s.answers }`. Show `plan.summary`. Then set App state (`restaurantsRef`, `setRestaurants`, `setBookmarks`) to `plan.restaurants` / `plan.bookmarks`, so App's debounced publish writes `sharedLists` **once**. Store `committedBatch` in the session. |
| Undo | `importBatches(restaurants, bookmarks)`, `undoImport(restaurants, bookmarks, batch)`, `persistListChange(…)` | Removes every spot and bookmark of that batch, re-ranked ones included (`editedSinceImport` counts them for the `ConfirmModal`). The other spots are refit back to their old scores. |

A console version of the whole flow, with canned Places answers, runs under `npm run dev:emu`:
`await jellyDevBeliImport.run()`, `await jellyDevBeliImport.undo()` (`src/dev/beliImportDev.ts`).

## Scores

Beli asks liked / fine / didn't like first. It compares spots only within that bucket and spreads
scores evenly in thirds (>6.7, 3.4–6.7, <3.4). So the export is **three sorted runs stacked**: the
order inside a run is earned, the order across a boundary is forced. Often the top of "fine" beats
the bottom of "liked".

**Boundary merge** (`boundaryMerge.ts`)
- The true order is a merge of the runs. First the best "fine" spot is compared with the worst
  "liked" one. If it loses, Beli was right: **one question per boundary**.
- If it wins, the search gallops up (2, 4, 8 places), then binary-searches. The next spot starts
  where the previous one landed.
- There is a soft cap of 6 questions per boundary, then "keep going?". Anything unanswered keeps
  Beli's order.
- Answers are stored as `comparisons` on the entries.

**Anchors** (`scores.ts`)
- **Quick:** #1, the last "liked" spot (or the median) and the last spot. Lists of 3 or fewer: every spot.
- **More:** adds the quartiles and the bucket edges.
- Spots already in that jelly list are **free anchors**, using their jelly score.
- Anchors keep the rating the user gave. Every other spot is interpolated by position in
  spectrum-% space (the same on the linear and the non-linear scale), on the anchors made
  non-increasing first.
- Then the usual `recomputeMagicScores`.
- The preset, used for skipped lists and past the user's last anchor: liked 9.2→6.0,
  fine 5.9→4.0, didn't like 3.9→1.5 (with buckets), else 9.0 / 7.0 / 4.5.

## Merging into lists that already have spots

- **A place already in that jelly list** keeps its jelly entry untouched, notes included
  (`summary.duplicates`). It is a free anchor.
- **Shared spots pin the two orders together.** The longest run of shared spots that Beli and
  jelly order the same way become fixed points. Each new spot lands between the fixed points
  around it in Beli's order. Between two fixed points, new and existing spots are woven by score,
  as a merge of two sorted runs, so both orders survive.
- **Shared spots the orders disagree on** stay where jelly has them and pin nothing
  (`summary.orderConflicts`).
- **Existing spots' scores move a little**, because the whole list is refit: in simulations,
  median 0.1 and at most 0.6 when 300 Beli spots land on a 15-spot list. Their order never changes.
- **A re-import of a newer export** skips rows already imported (`imported.key` = Beli list +
  name|city, so a spot moved to another jelly list is still recognised). Earlier imports pin the
  order for the new ones.
- **Beli bookmarks** go to Want to try in the mapped list. They are skipped when already saved
  (any list) or already ranked in that list.

## Fields and privacy

| Beli | jelly | Public? |
|---|---|---|
| Rank (per list) | order → `rankIndex`, `magicScore` (recomputed) | yes |
| Notes | `notes` (several joined by a blank line) | yes |
| Favorite Dishes | `favoriteDishes` (bookmarks: appended to `notes`) | yes |
| Private Notes | `privateNotes` | **no**: `toSharedEntry` / `toSharedBookmark` strip it |
| Created Date | `createdAt`, one `rankedHistory` event | yes |
| (import) | `imported: { source: 'beli', batch, key }` | **no**: stripped |
| Visit Dates, labels | dropped (labels by decision; both parsed and counted) | – |
| follows.csv | `exp.follows`, returned only, never stored | – |

`comparisonsCount` is the number of boundary answers the spot carries (0 for most).
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
- `boundaryMerge.ts`, `scores.ts`: rebuilding scores.
- `plan.ts`: building entries, merging, bookmarks, undo.
- `session.ts`: saved answers.
- `fixtures.ts`: the synthetic export and fake Places search.
- `../sync/importWrite.ts`: persisting.

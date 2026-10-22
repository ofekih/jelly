# jelly — agent guide

jelly (always lowercase, including the app/web-app name) is a personal ranking web app for
restaurants, places, movies and TV shows. Live at https://eatwithjelly.com.

- Firebase project: `ofek-beli-ranker` (Hosting, Auth with Google sign-in, Firestore, Analytics)
- GitHub: `git@github.com:ofekih/jelly.git`, branch `main`
- Stack: React 19 + TypeScript + Vite 6 + Tailwind v4, `@dnd-kit` for drag-to-rerank,
  Google Places API (New) + Maps JS API, TMDB (movies & shows, via the `tmdb` function), Vitest for tests.
- Note: `package.json` name is still `palate-ranker` (legacy name); the product is jelly.

## Commands
- `npm run dev` – local dev server
- `npm test` – Vitest (`src/**/*.test.ts`)
- `npm run test:emulator` – sync tests (`src/**/*.emu.test.ts`) against the Firestore emulator with the real `firestore.rules`; run after touching `src/lib/sync/` or the rules. Functions have their own: `cd functions && npm run test:emulator`
- `npm run build` – `tsc -b && vite build` (must pass with zero TS errors)
- Deploy: `npx -y firebase-tools@latest deploy --only hosting --project ofek-beli-ranker`
- Firestore rules deploy: `npx -y firebase-tools@latest deploy --only firestore:rules --project ofek-beli-ranker`
- Commit: `git -c commit.gpgsign=false commit -m "..."` (global gpgsign is on and will hang/fail)
- Full ship flow: see `.agents/skills/jelly-ship/SKILL.md`

## Code map
| Path | Role |
|------|------|
| `src/App.tsx` (~2.7k lines) | App shell, all top-level state, auth, Firestore/localStorage sync, header, filters, settings |
| `src/types.ts` | Core types: `RestaurantEntry`, `BookmarkEntry`, `PlaceCandidate`, `SharedListPayload`, `FriendProfile`, `SpotCategory` (+ `CATEGORY_LABEL`/`CATEGORY_EMOJI`) |
| `src/firebase.ts` | Firebase init, `trackEvent` (Analytics), `DEFAULT_PLACES_API_KEY` |
| `src/lib/ratingTiers.ts` | Rating tiers (Skip…Incredible) and their gut-feeling labels; source of the spectrum's tier boundaries |
| `src/lib/rankingEngine.ts` | Rating ⇄ Elo, non-linear spectrum mapping (`pctToSpectrumRating` / `spectrumRatingToPct`), side-by-side (SxS) binary-insertion search, `recomputeMagicScores` |
| `src/lib/tasteModel.ts` | Pure, dependency-free taste model shared with `functions/`: `isSameSpot`, similarity (Pearson+Kendall+z), `predictTaste` with the privacy guard (non-followed raters only when ≥3 are positively correlated; never named) |
| `src/lib/friendsService.ts` | Friend matching, group blend ("Eat Together"), social metrics (friends avg + all-jelly avg from `placeStats`; prediction from followed friends or the stronger server prediction) |
| `src/lib/predictions.ts`, `usePredictions.ts` | Parse + one `onSnapshot` of `users/{uid}/private/predictions`, looked up per spot by `placeId__category` |
| `src/lib/socialService.ts` | Firestore reads/writes for `profiles` (build, prefix search), follower edges, follow counts, `placeStats` fetch; `usePlaceStats.ts` caches stats for components |
| `src/lib/publicList.ts` | Builds the public `sharedLists` payload under the 500-item / ~1 MiB limits (drops notes before spots) |
| `src/lib/sync/` | Account sync, kept out of `App.tsx` and tested against the emulator (`sync.emu.test.ts`): `accountLists` (both lists ⇄ cloud + local copy: server-confirmed seeding, stored-score refresh, migrations), `userDoc` (settings + friends merge), `follows` (follow list + follower edges), `publish` (`sharedLists` + `profiles`), `localCache` (local keys + which account the copy mirrors; only signed-out data is ever uploaded) |
| `functions/` | Cloud Functions: `tmdb` (title search proxy, CDN-cached), `onRestaurantWritten` (recomputes `placeStats`, marks `predictionJobs/{uid}` dirty), `onBookmarkWritten`, `processPredictionJobs` (every minute, debounced), `nightlyPredictions`; one-time `scripts/backfill.ts`; emulator tests (`npm run test:emulator`). Compiles `src/lib/tasteModel.ts` + `src/types.ts` too (rootDir `..`, main `lib/functions/src/index.js`) |
| `src/lib/placesService.ts` | Google Places search + autocomplete, name-match ranking (`computeNameMatchScore`), manual candidates |
| `src/lib/media.ts` | Watch lists: TMDB title search via `/api/tmdb/search` (Hosting rewrite → `tmdb` function in `functions/src/tmdb.ts`, token in the `TMDB_READ_TOKEN` secret; dev proxies to production), poster URLs, `spotLink` (TMDB vs Maps), `spotPlaceLabel` (year · director vs neighborhood) |
| `src/lib/categorizer.ts` | Maps Google place types → spot categories (best match first) + tags (cuisines, sight subtypes, country/continent) |
| `src/lib/categoryLists.ts` | Per-category list helpers (`getCategoryList`, `replaceCategoryList`, `recomputeAllCategoryScores`), entry IDs, one-time legacy meal → category migration (`loadRestaurants`) |
| `src/lib/geo.ts` | Distances, city fallback coords |
| `src/lib/changelog.ts` | User-facing release notes (newest first = app version, synced with `package.json`); shown in Settings → What's new (`WhatsNewModal`), dot on Settings for unseen major/minor releases |
| `src/components/AddAndRateModal.tsx` | Search → gut-feeling spectrum bar (labels from `ratingTiers`) → SxS |
| `src/components/SxSArenaModal.tsx` | Pairwise comparisons; prefers same-cuisine opponents |
| `src/components/RestaurantList.tsx` | Ranked list, drag-to-rerank, swipe actions |
| `src/components/RestaurantMapView.tsx` | Google Map with custom score pins (light/dark styles) |
| `src/components/FriendsModal.tsx`, `ShareModal.tsx`, `EatTogetherModal.tsx`, `BookmarkList.tsx`, `SpotDetailModal.tsx`, `ConfirmModal.tsx` | Feature modals |
| `firestore.rules` | Security rules with per-field validators (`isValidUserDoc`, `isValidSharedList`, …) |
| `public/` | `jelly-icon-512/192.png` + `apple-touch-icon.png` (original artwork), `favicon.png` (crop), `jelly-logo.png` (transparent crop used by `JellyBeanIcon`) |

## Data model (Firestore)
- `users/{uid}` – settings/profile (`customPlacesApiKey`, `seenFollowerIds`, `linearRatingScale`, …)
- `users/{uid}/restaurants/{id}` – `RestaurantEntry` (ranked spots: `category`, `initialRating`, `rankIndex`/`magicScore` within its category, cuisines, notes…; ID = `${placeId}__${category}`). Movies & shows use `placeId` `tmdb:movie:<id>` / `tmdb:tv:<id>`, a `media` map (`year`, `poster`, `creator`) and their "year · director" in `formattedAddress`; titles match only by ID (`isMediaPlaceId`)
- `users/{uid}/bookmarks/{id}` – `BookmarkEntry` (want-to-try)
- `sharedLists/{uid}` – public `SharedListPayload` snapshot of a user's list, read one doc at a time (share link, friends' lists). Never list or query the collection. No count limit; `publicList.ts` trims by bytes (1 MiB doc limit).
- `profiles/{uid}` – small public profile (handle, name, photo, `followingIds`, `rankedCount`) for search and follower lists; rules reject unknown fields and nulls
- `profiles/{uid}/followers/{followerUid}` – follower edge `{createdAt}`, created/deleted only by the follower
- `placeStats/{placeId}__{category}` – community `{sum, count, avg}` per spot per list, written only by the Cloud Function from stored `magicScore`s
- `users/{uid}/private/predictions` – `{spots: {[placeId__category]: {score, confidence, basis, raters}}, updatedAt}`, owner-read only, written only by the prediction functions
- `predictionJobs/{uid}` – `{dirtyAt}` debounce marker for prediction recomputes (server-only)
- Signed-out users persist to `localStorage` (keys defined at top of `App.tsx`); signed-in users sync to Firestore.

## Conventions & gotchas
- **Completely separate lists in four groups** (`SpotCategory`, grouped by `SpotGroup` via
  `GROUP_CATEGORIES`/`CATEGORY_GROUP` in `types.ts`): Eat (Restaurants, Brunch, Dessert, Bakeries,
  Coffee & Tea, Bars), Explore (Museums & Galleries, Theme Parks, Zoos & Aquariums, Parks & Nature),
  Travel (Cities, Getaways, Countries), Watch (Movies, TV Shows; whole shows, not seasons). Every
  entry belongs to exactly one list; ranks, magic scores, SxS opponents, drag-reorder,
  friend/community score matching and Eat/Visit/Travel/Watch Together never cross lists. The same place may appear in several lists as separate entries. The header switcher
  picks the group; the main screen shows one list of it at a time (tabs). Per-group wording, tag
  options, rating-label tweaks and `hasLocation` (false for Watch: no map, Near Me, cities or Maps
  links) live in `src/lib/groups.ts`; the emerald accent is remapped per group in `index.css`
  (scores use the fixed `jade` copy). `cuisines` holds each group's tags
  (cuisine / museum type / country + continent + vibe).
- **New categories need a guard period**: docs with an unknown category are skipped untouched
  (`isFromNewerVersion`), but older cached app versions without that guard would migrate them. Make
  sure family devices have updated before adding entries in a brand-new category.
- **TMDB attribution is required** wherever title data shows up in bulk (`TmdbCredit` under search
  results, About footer).
- **Adding a field to any Firestore doc requires updating `firestore.rules` validators**,
  otherwise writes fail (fire-and-forget writes only log via `logWriteError` in the console). Delegate rules edits to the
  `firestore-rules-author` subagent, then deploy rules.
- **Rating scale is non-linear by default**: tiers Skip/Mid/Good/Great/Incredible (≈1–3.9 / 4–5.9 /
  6–7.4 / 7.5–8.7 / 8.8–10) fill 16/21/24/27/12% of the bar (`barShare` in `ratingTiers.ts`): roughly how
  often people feel each way (MovieLens/Letterboxd/BeerAdvocate, 75%) plus a plain-line floor (25%).
  Piecewise linear within tiers, 5.0 in the middle of Mid. A settings toggle
  (`linearRatingScale`) reverts to linear. Keep gradient + labels consistent with both modes.
- **Spectrum labels are deliberately calibrated low**: "Loved it" sits near the Great/Incredible
  boundary (~8.2–8.7), and "Flawless · Literally nothing could be improved" is only 9.8–10. The words
  before "·" climb strictly (X → Really X); the text after must never sound weaker than the row
  below, must fit every group (meal, coffee, museum, country) and must not be a near-synonym of a
  neighbour. Tiers, labels and Travel's and Watch's few overrides live in `src/lib/ratingTiers.ts`. Don't
  inflate them; the goal is to push users to use the whole scale.
- **Mobile is first-class**: verify touch drag (dnd-kit sensors), autocomplete scroll position,
  Web Share API (`navigator.share`) and layout on iOS/Android, not just desktop.
- **Destructive actions** (delete spot/bookmark/friend) always go through `ConfirmModal`.
- **Brand assets**: the jelly beans logo comes from `public/jelly-icon-512.png`; the beans are not tilted.
- **Copy style**: em-dash without spaces (`word—word`), spaced en-dash for clauses (`a – b`),
  unspaced en-dash for ranges (`1–10`).
- API keys in `src/firebase.ts` are browser keys (restricted by referrer in GCP); don't move them
  to secrets or rotate them without asking.

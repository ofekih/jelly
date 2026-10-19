# jelly — agent guide

jelly (always lowercase, including the app/web-app name) is a personal restaurant
ranking web app. Live at https://eatwithjelly.com.

- Firebase project: `ofek-beli-ranker` (Hosting, Auth with Google sign-in, Firestore, Analytics)
- GitHub: `git@github.com:ofekih/jelly.git`, branch `main`
- Stack: React 19 + TypeScript + Vite 6 + Tailwind v4, `@dnd-kit` for drag-to-rerank,
  Google Places API (New) + Maps JS API, Vitest for tests.
- Note: `package.json` name is still `palate-ranker` (legacy name); the product is jelly.

## Commands
- `npm run dev` – local dev server
- `npm test` – Vitest (`src/lib/*.test.ts`)
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
| `src/lib/friendsService.ts` | Friend matching (`isSameSpot`), group blend ("Eat Together"), taste similarity / predicted rating, social metrics (friends + all-jelly averages) |
| `src/lib/placesService.ts` | Google Places search + autocomplete, name-match ranking (`computeNameMatchScore`), manual candidates |
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
- `users/{uid}/restaurants/{id}` – `RestaurantEntry` (ranked spots: `category`, `initialRating`, `rankIndex`/`magicScore` within its category, cuisines, notes…; ID = `${placeId}__${category}`)
- `users/{uid}/bookmarks/{id}` – `BookmarkEntry` (want-to-try)
- `sharedLists/{shareId}` – public `SharedListPayload` snapshot of a user's list (used by friends, follower notifications via `followingIds`, community averages)
- Signed-out users persist to `localStorage` (keys defined at top of `App.tsx`); signed-in users sync to Firestore.

## Conventions & gotchas
- **Completely separate lists in three groups** (`SpotCategory`, grouped by `SpotGroup` via
  `GROUP_CATEGORIES`/`CATEGORY_GROUP` in `types.ts`): Eat (Restaurants, Brunch, Dessert, Bakeries,
  Coffee & Tea, Bars), Explore (Museums & Galleries, Theme Parks, Zoos & Aquariums, Parks & Nature),
  Travel (Cities, Getaways, Countries). Every entry belongs to exactly one list; ranks, magic scores,
  SxS opponents, drag-reorder, friend/community score matching and Eat/Visit/Travel Together never
  cross lists. The same place may appear in several lists as separate entries. The header switcher
  picks the group; the main screen shows one list of it at a time (tabs). Per-group wording, tag
  options and rating-label tweaks live in `src/lib/groups.ts`; the emerald accent is remapped per
  group in `index.css` (scores use the fixed `jade` copy). `cuisines` holds each group's tags
  (cuisine / museum type / country + continent + vibe).
- **New categories need a guard period**: docs with an unknown category are skipped untouched
  (`isFromNewerVersion`), but older cached app versions without that guard would migrate them. Make
  sure family devices have updated before adding entries in a brand-new category.
- **Adding a field to any Firestore doc requires updating `firestore.rules` validators**,
  otherwise writes fail (fire-and-forget writes only log via `logWriteError` in the console). Delegate rules edits to the
  `firestore-rules-author` subagent, then deploy rules.
- **Rating scale is non-linear by default**: 5 equal visual divisions Skip/Mid/Good/Great/Incredible
  (≈1–3.9 / 4–5.9 / 6–7.4 / 7.5–8.7 / 8.8–10), with 5.0 in the middle of Mid. A settings toggle
  (`linearRatingScale`) reverts to linear. Keep gradient + labels consistent with both modes.
- **Spectrum labels are deliberately calibrated low**: "Loved it" sits near the Great/Incredible
  boundary (~8.2–8.7), and "Flawless · Literally nothing could be improved" is only 9.8–10. The words
  before "·" climb strictly (X → Really X); the text after must never sound weaker than the row
  below, must fit every group (meal, coffee, museum, country) and must not be a near-synonym of a
  neighbour. Tiers, labels and Travel's few overrides live in `src/lib/ratingTiers.ts`. Don't
  inflate them; the goal is to push users to use the whole scale.
- **Mobile is first-class**: verify touch drag (dnd-kit sensors), autocomplete scroll position,
  Web Share API (`navigator.share`) and layout on iOS/Android, not just desktop.
- **Destructive actions** (delete spot/bookmark/friend) always go through `ConfirmModal`.
- **Brand assets**: the jelly beans logo comes from `public/jelly-icon-512.png`; the beans are not tilted.
- **Copy style**: em-dash without spaces (`word—word`), spaced en-dash for clauses (`a – b`),
  unspaced en-dash for ranges (`1–10`).
- API keys in `src/firebase.ts` are browser keys (restricted by referrer in GCP); don't move them
  to secrets or rotate them without asking.

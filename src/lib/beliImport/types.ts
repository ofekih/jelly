import type { BookmarkEntry, PlaceCandidate, RestaurantEntry, SpotCategory } from '../../types';

/**
 * Public types of the Beli import engine. The UX builds on these; keep them stable (add fields,
 * don't rename or repurpose them). See README.md in this folder for the flow.
 */

/** Beli's list codes and the jelly list each one goes into. Anything else is reported, never guessed. */
export const BELI_CATEGORY_MAP = {
  RES: 'restaurants',
  BAK: 'bakeries',
  COF: 'coffee_tea',
  DES: 'dessert',
  BAR: 'bars',
} as const satisfies Record<string, SpotCategory>;

export type BeliCategoryCode = keyof typeof BELI_CATEGORY_MAP;

/** The files the engine reads. Every other file in the export is listed by name only, never opened. */
export const BELI_FILES = ['rankings.csv', 'bookmarks.csv', 'notes_dishes.csv', 'labels.csv', 'follows.csv'] as const;
export type BeliFileName = (typeof BELI_FILES)[number];

/** Text attached to a spot from `notes_dishes.csv` (several of one kind are joined by a blank line). */
export interface BeliSpotText {
  notes?: string; // "Notes": public in jelly, like every note
  favoriteDishes?: string; // "Favorite Dishes"
  privateNotes?: string; // "Private Notes": stored as `privateNotes`, never published
}

/** One row of `rankings.csv`, with its notes joined in. */
export interface BeliRankedRow extends BeliSpotText {
  /** `beliPlaceKey(name, city)`: what notes are joined on and what re-imports recognise */
  key: string;
  name: string;
  city: string;
  category: SpotCategory;
  /** 1-based, as in the export; `lists[category]` is sorted by it */
  rank: number;
  createdAt?: number; // ms
  visitDates: string[]; // ISO dates (YYYY-MM-DD); not imported, kept for the UI
  labelCount: number; // Beli labels on this place (dropped by decision; counted only)
}

/** One row of `bookmarks.csv`, with its notes joined in. */
export interface BeliBookmarkRow extends BeliSpotText {
  key: string;
  name: string;
  city: string;
  category: SpotCategory;
  createdAt?: number;
}

/** A Beli account the user follows (`follows.csv`). Parsed for a later friend-finding step; never stored. */
export interface BeliFollow {
  username: string;
  requestedAt?: number;
  acceptedAt?: number;
}

export interface BeliParseReport {
  /** Files found in the export, by base name (including the ones never opened) */
  files: string[];
  /** Files present but deliberately not read (photos, preferences, devices, profile, …) */
  ignoredFiles: string[];
  /** Expected files that were missing (rankings.csv missing makes the export unusable) */
  missingFiles: BeliFileName[];
  /** Rows skipped because their list code is unknown: code → count */
  unknownCategories: Record<string, number>;
  /** Rows that could not be read, with the reason (bad rank, missing name, …) */
  badRows: Array<{ file: BeliFileName; line: number; reason: string }>;
  /** Lists whose ranks are not exactly 1..N (they are still imported in rank order) */
  rankIssues: Array<{ category: SpotCategory; reason: string }>;
  /** Same place twice in one list or in bookmarks: later copies dropped */
  duplicateRows: number;
  /** Notes / dishes / private notes whose (name, city) matches no ranked spot or bookmark */
  unmatchedNotes: number;
  /** Text cut to fit jelly's limits (notes 5,000, dishes 2,000 characters) */
  truncatedTexts: number;
  /** Beli labels found (dropped by decision) */
  labelsDropped: number;
}

export interface BeliExport {
  /** Each Beli list in rank order (#1 first). Only lists present in the export appear. */
  lists: Partial<Record<SpotCategory, BeliRankedRow[]>>;
  bookmarks: BeliBookmarkRow[];
  follows: BeliFollow[];
  report: BeliParseReport;
  /** Stable hash of the parsed content: keys saved import sessions (answers, choices) */
  fingerprint: string;
}

// ---------------------------------------------------------------------------
// Matching to Google places
// ---------------------------------------------------------------------------

/** One place to find. Ranked rows and bookmarks for the same (name, city) share one lookup. */
export interface MatchQuery {
  key: string; // beliPlaceKey
  name: string;
  city: string;
  /** Lists this place is imported into (decides which Google types fit) */
  categories: SpotCategory[];
}

/**
 * - matched: confident (name and city agree, a fitting type, no same-name branch nearby): auto-accepted
 * - review: plausible but unsure (chain branches, a different name or city): `candidates` holds the top 3
 * - not_found: Google returned nothing that fits (`candidates` may still hold loose hits)
 * - error: the lookup failed (offline, cancelled, call cap reached); running again retries it
 */
export type MatchStatus = 'matched' | 'review' | 'not_found' | 'error';

export interface MatchResult {
  key: string;
  status: MatchStatus;
  /** The pick for `matched` (and the best guess for `review`) */
  best?: PlaceCandidate;
  /** Up to 3 candidates, best first */
  candidates: PlaceCandidate[];
  /** Why it is not `matched`, for the review screen: 'chain', 'name', 'city', 'type', 'closed', … */
  reasons: MatchReason[];
  /** The text sent to Google ("name, city") */
  query: string;
  fromCache: boolean;
}

export type MatchReason = 'chain' | 'name' | 'city' | 'type' | 'closed' | 'no_results' | 'failed' | 'cancelled' | 'cap';

export interface MatchProgress {
  total: number;
  done: number;
  matched: number;
  review: number;
  notFound: number;
  errors: number;
  /** Answered from the device cache (free) */
  fromCache: number;
  /** Billable Text Search calls made by this run */
  apiCalls: number;
  /** Waiting out a rate limit right now */
  backingOff: boolean;
}

/** What the user decided for a place (a matched place needs no decision). */
export type MatchDecision =
  | { kind: 'place'; candidate: PlaceCandidate } // Picked a candidate, or found it with normal search
  | { kind: 'manual' } // Add as a custom spot (no Google place: no map pin precision, no community stats)
  | { kind: 'skip' }; // Leave it out of the import

// ---------------------------------------------------------------------------
// Rebuilding scores
// ---------------------------------------------------------------------------

/** Beli's first question for every spot. Its list is these three runs stacked, each sorted. */
export type BeliBucket = 'liked' | 'fine' | 'disliked';

/**
 * Where the buckets start in a Beli list (0-based positions in rank order). The export has no
 * scores, so the user points at the first spot Beli scores below ≈6.7 (`firstFine`) and below
 * ≈3.4 (`firstDisliked`). `undefined` = not given (the whole rest counts as the bucket above);
 * the list's length = that bucket is empty.
 */
export interface BucketBounds {
  firstFine?: number;
  firstDisliked?: number;
}

/** A side-by-side question at a bucket boundary: is `lower` (from the bucket below) better than `upper`? */
export interface BoundaryQuestion {
  lower: string; // row key
  upper: string; // row key
  /** 1 = liked/fine boundary, 2 = (liked+fine)/disliked boundary */
  boundary: 1 | 2;
  /** Questions answered so far at this boundary, and its soft cap */
  asked: number;
  cap: number;
}

/** 'lower' / 'upper' = that one is better; 'tie' = too close (lower goes just below upper); 'skip' = stop this boundary */
export type BoundaryAnswer = 'lower' | 'upper' | 'tie' | 'skip';

/** One recorded answer, kept so the entries get them as `comparisons` */
export interface BoundaryAnswerRecord {
  lower: string;
  upper: string;
  /** Result for `lower`: 1 = preferred, 0 = not, 0.5 = too close */
  result: 0 | 0.5 | 1;
  at: number;
}

/**
 * The interactive merge at the bucket boundaries, as a plain serialisable value (save it to
 * resume). Use `nextBoundaryQuestion` / `answerBoundaryQuestion` / `mergedOrder`.
 */
export interface BoundaryMergeState {
  /** Row keys in Beli order and each one's bucket */
  keys: string[];
  buckets: BeliBucket[];
  /** The merged order so far: everything above the run being merged in */
  merged: string[];
  /** Runs still to merge, in order (fine, then disliked), each best first */
  pending: Array<{ boundary: 1 | 2; keys: string[] }>;
  /** Search for `pending[0].keys[0]`: its gap in `merged` lies in [lo, hi] */
  lo: number;
  hi: number;
  /** Next probe distance from `hi` while galloping (0 = binary search phase) */
  step: number;
  /** Gap the previous spot of this run landed in (later ones can't land above it) */
  floor: number;
  asked: Record<1 | 2, number>;
  cap: number;
  /** Paused at the cap: `continueBoundary` lifts it by another `cap` */
  paused: boolean;
  answers: BoundaryAnswerRecord[];
}

/** A gut rating the user gave (or that comes for free from a spot already in the jelly list). */
export interface Anchor {
  key: string; // row key
  rating: number; // 1–10, as the spectrum gives it
  source: 'user' | 'existing' | 'preset';
}

/** How many anchor questions to ask: 'quick' (2–3 per list) or 'more' (adds quartiles, bucket edges) */
export type AnchorLevel = 'quick' | 'more';

// ---------------------------------------------------------------------------
// Building and merging entries
// ---------------------------------------------------------------------------

/** One list, ready to build: its final order, the user's anchors and the boundary answers */
export interface ScoredList {
  category: SpotCategory;
  /** Row keys, best first (`mergedOrder` after the boundary merge, or Beli's order) */
  order: string[];
  /** Gut ratings the user gave (`source: 'user'`); spots already in the jelly list are added as free anchors when building */
  anchors: Anchor[];
  /** Each row's Beli bucket, if the user gave the bounds (shapes the preset) */
  buckets?: Record<string, BeliBucket>;
  /** Boundary answers, stored on the entries as comparisons */
  answers: BoundaryAnswerRecord[];
}

export interface ImportPlan {
  batch: string;
  /** All ranked entries after the import (every list), ready to persist */
  restaurants: RestaurantEntry[];
  bookmarks: BookmarkEntry[];
  summary: ImportSummary;
}

export interface ImportSummary {
  /** New ranked spots per list */
  added: Partial<Record<SpotCategory, number>>;
  addedBookmarks: number;
  /** Already in that jelly list: the jelly entry was kept as it is */
  duplicates: Array<{ key: string; category: SpotCategory; entryId: string }>;
  /** Spots in both lists that Beli and jelly order differently: jelly's order is kept, and they pin nothing */
  orderConflicts: Array<{ category: SpotCategory; entryId: string }>;
  /** Already imported by an earlier run (recognised by Beli key; no lookup needed) */
  alreadyImported: number;
  /** Bookmarks skipped: already saved, or already ranked in that list */
  skippedBookmarks: number;
  /** Rows left out: not found / skipped by the user */
  skipped: number;
  /** Custom (manual) spots added */
  manual: number;
}

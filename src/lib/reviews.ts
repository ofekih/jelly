import {
  collection,
  deleteDoc,
  doc,
  DocumentData,
  Firestore,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { RestaurantEntry, SpotCategory } from '../types';
import { fetchProfiles, placeStatKey } from './socialService';

/**
 * Public reviews: `placeReviews/{placeId}__{category}/reviews/{uid}`, one per person per spot per
 * list (the same key as `placeStats` and the author's own `users/{uid}/restaurants/{id}`).
 *
 * A review holds only `text`, `score` (the author's current score for the spot) and timestamps.
 * Who wrote it comes from `profiles/{uid}` when it's read, so a new name or photo shows on every
 * review at once. The rules only accept a review for a spot the author has ranked, with its
 * current score; the `onRestaurantWritten` function keeps `score` in step as the list shifts and
 * deletes the review when the spot leaves their list.
 *
 * Anyone signed in can give someone else's review a thumbs up or down: one private doc per voter
 * at `…/reviews/{author}/votes/{voterUid}`; the `onReviewVoteWritten` function recounts the
 * review's `up` / `down` from them.
 */

export const REVIEW_MAX_LENGTH = 2000;
/** Reviews read per spot (newest first); your own is always fetched on top of these. */
export const REVIEW_PAGE_SIZE = 20;

export interface PlaceReview {
  uid: string;
  text: string;
  score: number;
  createdAt: number;
  updatedAt: number;
  /** Thumbs up / down counts (kept by the server) */
  up: number;
  down: number;
}

/** 1 = thumbs up, -1 = thumbs down, 0 = no vote */
export type ReviewVote = 1 | -1 | 0;

export interface ReviewAuthor {
  name: string;
  handle?: string;
  photoURL?: string;
}

/** The review doc key for a spot, or null when it can't have public reviews (manual spots). */
export function reviewKey(placeId: string | undefined, category: SpotCategory | undefined): string | null {
  return placeStatKey(placeId, category);
}

/**
 * The key for one of your own entries, only when the entry lives at that key too (the rules
 * check `users/{uid}/restaurants/{key}` exists).
 */
export function reviewKeyForEntry(entry: Pick<RestaurantEntry, 'id' | 'placeId' | 'category'>): string | null {
  const key = reviewKey(entry.placeId, entry.category);
  return key && key === entry.id ? key : null;
}

/** Trims, and rejects empty or over-long text. */
export function cleanReviewText(text: string): string | null {
  const clean = text.trim();
  return clean.length >= 1 && clean.length <= REVIEW_MAX_LENGTH ? clean : null;
}

const toCount = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'number') return value;
  return Date.now();
}

export function parseReview(uid: string, data: DocumentData | undefined): PlaceReview | null {
  if (!data || typeof data.text !== 'string' || !data.text.trim() || typeof data.score !== 'number') return null;
  return {
    uid,
    text: data.text,
    score: data.score,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
    up: toCount(data.up),
    down: toCount(data.down),
  };
}

/**
 * Your review first, then friends', then everyone else's; newest first within each.
 */
export function sortReviews(reviews: PlaceReview[], myUid: string | null | undefined, friendIds: Set<string>): PlaceReview[] {
  const rank = (r: PlaceReview) => (r.uid === myUid ? 0 : friendIds.has(r.uid) ? 1 : 2);
  return [...reviews].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
}

const DAY = 86_400_000;

/** "Today", "Yesterday", "3 days ago", "2 weeks ago", "Sep 12", "Sep 2025". */
export function formatReviewDate(ts: number, now = Date.now()): string {
  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 28) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  }
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  try {
    return new Intl.DateTimeFormat('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' }).format(
      new Date(ts)
    );
  } catch {
    return '';
  }
}

const reviewsCol = (db: Firestore, key: string) => collection(db, 'placeReviews', key, 'reviews');
const reviewRef = (db: Firestore, key: string, uid: string) => doc(db, 'placeReviews', key, 'reviews', uid);

export async function fetchMyReview(db: Firestore, key: string, uid: string): Promise<PlaceReview | null> {
  const snap = await getDoc(reviewRef(db, key, uid));
  return snap.exists() ? parseReview(uid, snap.data({ serverTimestamps: 'estimate' })) : null;
}

/** The newest reviews of a spot, plus yours (even when it's older than the page). */
export async function fetchPlaceReviews(
  db: Firestore,
  key: string,
  myUid?: string | null
): Promise<PlaceReview[]> {
  const [snap, mine] = await Promise.all([
    getDocs(query(reviewsCol(db, key), orderBy('updatedAt', 'desc'), limit(REVIEW_PAGE_SIZE))),
    myUid ? fetchMyReview(db, key, myUid).catch(() => null) : Promise.resolve(null),
  ]);
  const reviews = snap.docs
    .map((d) => parseReview(d.id, d.data({ serverTimestamps: 'estimate' })))
    .filter((r): r is PlaceReview => Boolean(r));
  if (mine && !reviews.some((r) => r.uid === mine.uid)) reviews.push(mine);
  return reviews;
}

/** Names and photos for review authors, from their public profiles. */
export async function fetchReviewAuthors(db: Firestore, uids: string[]): Promise<Record<string, ReviewAuthor>> {
  const profiles = await fetchProfiles(db, uids);
  const out: Record<string, ReviewAuthor> = {};
  for (const p of profiles) {
    out[p.ownerUid || p.id] = { name: p.displayName || p.ownerName, handle: p.handle, photoURL: p.photoURL };
  }
  return out;
}

/**
 * Creates or edits your review. `score` must be your stored score for the spot (rules check it).
 * Returns the saved review (timestamps estimated locally).
 */
export async function saveMyReview(
  db: Firestore,
  key: string,
  uid: string,
  text: string,
  score: number,
  exists: boolean
): Promise<PlaceReview> {
  const clean = cleanReviewText(text);
  if (!clean) throw new Error('Review text must be 1–2000 characters');
  const ref = reviewRef(db, key, uid);
  const create = () => setDoc(ref, { text: clean, score, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  const update = () => updateDoc(ref, { text: clean, score, updatedAt: serverTimestamp() });
  if (exists) {
    try {
      await update();
    } catch (err: any) {
      // Deleted meanwhile (another device, or the spot left the list and came back)
      if (err?.code !== 'not-found') throw err;
      await create();
    }
  } else {
    try {
      await create();
    } catch (err: any) {
      // Already written from another device: its createdAt must stay, so edit it instead
      if (err?.code !== 'permission-denied') throw err;
      await update();
    }
  }
  const now = Date.now();
  return { uid, text: clean, score, createdAt: now, updatedAt: now, up: 0, down: 0 };
}

const voteRef = (db: Firestore, key: string, authorUid: string, voterUid: string) =>
  doc(db, 'placeReviews', key, 'reviews', authorUid, 'votes', voterUid);

/** Your votes on the given reviews (only your own vote docs are readable). */
export async function fetchMyVotes(
  db: Firestore,
  key: string,
  authorUids: string[],
  voterUid: string
): Promise<Record<string, ReviewVote>> {
  const out: Record<string, ReviewVote> = {};
  await Promise.all(
    authorUids
      .filter((author) => author !== voterUid)
      .map(async (author) => {
        const snap = await getDoc(voteRef(db, key, author, voterUid)).catch(() => null);
        const value = snap?.exists() ? snap.get('value') : 0;
        if (value === 1 || value === -1) out[author] = value;
      })
  );
  return out;
}

/** Sets (or with 0, removes) your vote on someone else's review. */
export async function saveMyVote(db: Firestore, key: string, authorUid: string, voterUid: string, vote: ReviewVote): Promise<void> {
  const ref = voteRef(db, key, authorUid, voterUid);
  if (vote === 0) await deleteDoc(ref);
  else await setDoc(ref, { value: vote, updatedAt: serverTimestamp() });
}

/** A review's counts after your vote changes from `from` to `to` (shown before the server recounts). */
export function applyVote(review: PlaceReview, from: ReviewVote, to: ReviewVote): PlaceReview {
  const up = review.up - (from === 1 ? 1 : 0) + (to === 1 ? 1 : 0);
  const down = review.down - (from === -1 ? 1 : 0) + (to === -1 ? 1 : 0);
  return { ...review, up: Math.max(0, up), down: Math.max(0, down) };
}

export async function deleteMyReview(db: Firestore, key: string, uid: string): Promise<void> {
  await deleteDoc(reviewRef(db, key, uid));
}

// ---------------------------------------------------------------------------
// Session cache shared by every `PlaceReviews` (spot sheet, place page) and the review step
// ---------------------------------------------------------------------------

export interface CachedReviews {
  reviews: PlaceReview[];
  at: number;
  /** The viewer's votes, by review author */
  myVotes: Record<string, ReviewVote>;
}

const STALE_MS = 3 * 60 * 1000;
const reviewCache = new Map<string, CachedReviews>();
const authorCache = new Map<string, ReviewAuthor | null>();
const listeners = new Set<() => void>();

export function subscribeReviewCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function getCachedReviews(key: string): CachedReviews | undefined {
  return reviewCache.get(key);
}

export function getCachedAuthor(uid: string): ReviewAuthor | null | undefined {
  return authorCache.get(uid);
}

/** Loads a spot's reviews and their authors into the cache (skipped while fresh). */
export async function loadReviews(db: Firestore, key: string, myUid?: string | null, force = false): Promise<void> {
  const cached = reviewCache.get(key);
  if (!force && cached && Date.now() - cached.at < STALE_MS) return;
  const reviews = await fetchPlaceReviews(db, key, myUid);
  const myVotes = myUid && reviews.length > 0 ? await fetchMyVotes(db, key, reviews.map((r) => r.uid), myUid) : {};
  const missing = reviews.map((r) => r.uid).filter((uid) => !authorCache.has(uid));
  if (missing.length > 0) {
    const authors = await fetchReviewAuthors(db, missing).catch(() => ({}) as Record<string, ReviewAuthor>);
    for (const uid of missing) authorCache.set(uid, authors[uid] ?? null);
  }
  reviewCache.set(key, { reviews, at: Date.now(), myVotes });
  notify();
}

/** Puts (or with `null`, removes) your own review in the cache after a write; an edit keeps its vote counts. */
export function setCachedMyReview(key: string, uid: string, review: PlaceReview | null, author?: ReviewAuthor): void {
  const cached = reviewCache.get(key);
  const prev = cached?.reviews.find((r) => r.uid === uid);
  const others = (cached?.reviews ?? []).filter((r) => r.uid !== uid);
  // An edit keeps the votes the review already had
  const next = review && prev ? { ...review, up: prev.up, down: prev.down } : review;
  reviewCache.set(key, { reviews: next ? [next, ...others] : others, at: cached?.at ?? 0, myVotes: cached?.myVotes ?? {} });
  if (author) authorCache.set(uid, author);
  notify();
}

/**
 * Votes on a review: updates the cache at once (your vote and the counts), then saves; on failure
 * puts both back and rethrows.
 */
export async function voteOnReview(db: Firestore, key: string, authorUid: string, voterUid: string, vote: ReviewVote): Promise<void> {
  const cached = reviewCache.get(key);
  if (!cached || authorUid === voterUid) return;
  const from = cached.myVotes[authorUid] ?? 0;
  if (from === vote) return;
  const setVote = (prev: ReviewVote, next: ReviewVote) => {
    const current = reviewCache.get(key);
    if (!current) return;
    const myVotes = { ...current.myVotes };
    if (next === 0) delete myVotes[authorUid];
    else myVotes[authorUid] = next;
    const reviews = current.reviews.map((r) => (r.uid === authorUid ? applyVote(r, prev, next) : r));
    reviewCache.set(key, { ...current, reviews, myVotes });
    notify();
  };
  setVote(from, vote);
  try {
    await saveMyVote(db, key, authorUid, voterUid, vote);
  } catch (err) {
    setVote(vote, from);
    throw err;
  }
}

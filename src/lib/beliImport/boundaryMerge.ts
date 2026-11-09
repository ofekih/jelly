import type {
  BeliBucket,
  BoundaryAnswer,
  BoundaryMergeState,
  BoundaryQuestion,
  BucketBounds,
} from './types';

/**
 * Beli asks "liked it / it was fine / didn't like it" first and only compares spots within that
 * bucket, so its list is three sorted runs stacked: the order inside a run is earned, the order
 * across a boundary is forced (the best "fine" spot often beats the worst "liked" one). The true
 * order is a merge of the runs, so only the overlap needs asking:
 *
 * - The best spot of the lower run is compared with the worst of the merged list above. If it
 *   loses, the boundary was right: one question, and the rest of the run stays below.
 * - If it wins, the search gallops up (2, 4, 8… places), then binary-searches, and the next spot of
 *   the run starts where this one landed (it can't be better than it).
 *
 * Each boundary has a soft cap of questions (`cap`); at the cap the merge pauses until
 * `continueBoundary`. Whatever is unanswered keeps Beli's order, so `mergedOrder` is always valid.
 */

export const DEFAULT_BOUNDARY_CAP = 6;

/** Which bucket each position falls in, from the bounds the user gave */
export function bucketsFor(length: number, bounds: BucketBounds): BeliBucket[] {
  const firstDisliked = clampIndex(bounds.firstDisliked ?? length, length);
  const firstFine = Math.min(clampIndex(bounds.firstFine ?? firstDisliked, length), firstDisliked);
  return Array.from({ length }, (_, i) => (i < firstFine ? 'liked' : i < firstDisliked ? 'fine' : 'disliked'));
}

function clampIndex(i: number, length: number): number {
  return Math.max(0, Math.min(length, Math.floor(i)));
}

export function startBoundaryMerge(keys: string[], bounds: BucketBounds, options: { cap?: number } = {}): BoundaryMergeState {
  const buckets = bucketsFor(keys.length, bounds);
  const run = (b: BeliBucket) => keys.filter((_, i) => buckets[i] === b);
  const runs: Array<{ boundary: 1 | 2; keys: string[] }> = [
    { boundary: 1 as const, keys: run('fine') },
    { boundary: 2 as const, keys: run('disliked') },
  ].filter((r) => r.keys.length > 0);
  let merged = run('liked');
  // Nothing liked: the first non-empty run is the top of the list
  if (merged.length === 0 && runs.length > 0) merged = runs.shift()!.keys;
  const cap = options.cap ?? DEFAULT_BOUNDARY_CAP;
  return {
    keys: [...keys],
    buckets,
    merged,
    pending: runs,
    lo: 0,
    hi: merged.length,
    step: 1,
    floor: 0,
    asked: { 1: 0, 2: 0 },
    cap,
    paused: false,
    answers: [],
  };
}

/** The spot of `merged` the current candidate is compared with next */
function probeIndex(s: BoundaryMergeState): number {
  if (s.step > 0) return Math.max(s.lo, s.hi - s.step);
  return s.lo + ((s.hi - s.lo) >> 1);
}

export function nextBoundaryQuestion(s: BoundaryMergeState): BoundaryQuestion | null {
  if (s.paused || s.pending.length === 0) return null;
  const run = s.pending[0];
  return {
    lower: run.keys[0],
    upper: s.merged[probeIndex(s)],
    boundary: run.boundary,
    asked: s.asked[run.boundary],
    cap: s.cap * Math.ceil((s.asked[run.boundary] + 1) / s.cap),
  };
}

/** Puts the current candidate at `gap` and moves on (to the next spot of the run, or the next run). */
function place(s: BoundaryMergeState, gap: number): BoundaryMergeState {
  const [run, ...rest] = s.pending;
  const [candidate, ...remaining] = run.keys;
  const merged = [...s.merged];
  merged.splice(gap, 0, candidate);
  // Lost to the very bottom (so every worse spot of its run goes below too), or the run is done
  if (gap === s.merged.length || remaining.length === 0) {
    merged.push(...remaining);
    return { ...s, merged, pending: rest, floor: 0, lo: 0, hi: merged.length, step: 1 };
  }
  const floor = gap + 1;
  return { ...s, merged, pending: [{ ...run, keys: remaining }, ...rest], floor, lo: floor, hi: merged.length, step: 1 };
}

export function answerBoundaryQuestion(s: BoundaryMergeState, answer: BoundaryAnswer, now = Date.now()): BoundaryMergeState {
  const q = nextBoundaryQuestion(s);
  if (!q) return s;
  if (answer === 'skip') return finishBoundary(s);
  const i = probeIndex(s);
  const result = answer === 'lower' ? 1 : answer === 'upper' ? 0 : 0.5;
  let next: BoundaryMergeState = {
    ...s,
    asked: { ...s.asked, [q.boundary]: s.asked[q.boundary] + 1 },
    answers: [...s.answers, { lower: q.lower, upper: q.upper, result, at: now }],
  };
  if (answer === 'tie') {
    next = place(next, i + 1); // Too close to call: just below the one it was compared with
  } else {
    next = answer === 'lower' ? { ...next, hi: i, step: next.step > 0 ? next.step * 2 : 0 } : { ...next, lo: i + 1, step: 0 };
    if (next.lo >= next.hi) next = place(next, next.lo);
  }
  const nextQ = nextBoundaryQuestion(next);
  if (nextQ && nextQ.boundary === q.boundary && next.asked[q.boundary] % s.cap === 0) next = { ...next, paused: true };
  return next;
}

/** Lifts the pause at the cap for another `cap` questions */
export function continueBoundary(s: BoundaryMergeState): BoundaryMergeState {
  return { ...s, paused: false };
}

/**
 * Stops asking at the current boundary: the spot being placed goes where the answers so far allow
 * nearest Beli's order (just above the last spot it beat), the rest of its run below everything,
 * and the next boundary (if any) starts.
 */
export function finishBoundary(s: BoundaryMergeState): BoundaryMergeState {
  if (s.pending.length === 0) return { ...s, paused: false };
  const [run, ...rest] = s.pending;
  const [candidate, ...remaining] = run.keys;
  const merged = [...s.merged];
  merged.splice(s.hi, 0, candidate);
  merged.push(...remaining);
  return { ...s, merged, pending: rest, floor: 0, lo: 0, hi: merged.length, step: 1, paused: false };
}

/** The order as far as answered; unanswered boundaries keep Beli's order. */
export function mergedOrder(s: BoundaryMergeState): string[] {
  let state = s;
  while (state.pending.length > 0) state = finishBoundary(state);
  return state.merged;
}

/** True once nothing is left to ask (all boundaries merged or stopped) */
export function boundaryMergeDone(s: BoundaryMergeState): boolean {
  return s.pending.length === 0;
}

/** Each key's Beli bucket */
export function bucketOf(s: BoundaryMergeState): Record<string, BeliBucket> {
  return Object.fromEntries(s.keys.map((k, i) => [k, s.buckets[i]]));
}

import type { BeliBucket, BucketBounds, MergeAnswer, MergeQuestion, MergeStage, MergeState } from './types';

/**
 * Merging sorted runs with side-by-side questions: the merge step of merge sort, with the user
 * as the comparison.
 *
 * Beli asks liked / fine / didn't like first and only compares spots within that bucket, so a
 * Beli list is three sorted runs stacked: the order inside a run is earned, the order across a
 * boundary is forced. The user's jelly list (if any) is a fourth sorted run. The true order is
 * their merge: fine into liked, then didn't-like into that, then the shorter of (Beli, jelly) into
 * the longer.
 *
 * Each spot of the run being merged in is placed by a search that starts where the estimated
 * scores say it belongs (fresh gut ratings make this close), confirms with ~2 questions when the
 * guess is right and gallops outward (1, 2, 4… places) then bisects when it is not. A spot can't
 * land above the one before it in its run, and a spot already in the other run (the same place in
 * both lists) is placed with no question and bounds the spots around it. Simulated on 300-spot Beli
 * lists with realistic bucket mistakes: ~200 questions for an exact merge, against ~470 galloping
 * from the bottom and ~2,500 ranking every spot from scratch.
 *
 * The state is plain JSON (save it to resume). No cap: `finishMerge` places whatever is left at
 * its estimated spot if the user stops.
 */

/** Which bucket each position falls in, from the bounds the user gave */
export function bucketsFor(length: number, bounds: BucketBounds): BeliBucket[] {
  const clampIndex = (i: number) => Math.max(0, Math.min(length, Math.floor(i)));
  const firstDisliked = clampIndex(bounds.firstDisliked ?? length);
  const firstFine = Math.min(clampIndex(bounds.firstFine ?? firstDisliked), firstDisliked);
  return Array.from({ length }, (_, i) => (i < firstFine ? 'liked' : i < firstDisliked ? 'fine' : 'disliked'));
}

/** Starts a merge of `base` (sorted) with `runs` merged in one after another. `estimates` guide where each search starts. */
export function startMerge(base: string[], runs: Array<{ stage: MergeStage; keys: string[] }>, estimates: Record<string, number>): MergeState {
  const pending = runs.filter((r) => r.keys.length > 0).map((r) => ({ ...r, keys: [...r.keys] }));
  let merged = [...base];
  if (merged.length === 0 && pending.length > 0) merged = pending.shift()!.keys;
  return prepare({ merged, pending, estimates, floor: 0, lo: 0, hi: 0, guess: 0, phase: 'start', step: 1, asked: 0, answers: [] });
}

/** The Beli list's own merge: "fine" into "liked", then "didn't like" into that. */
export function startBucketMerge(keys: string[], bounds: BucketBounds, estimates: Record<string, number>): MergeState {
  const buckets = bucketsFor(keys.length, bounds);
  const run = (b: BeliBucket) => keys.filter((_, i) => buckets[i] === b);
  return startMerge(run('liked'), [
    { stage: 'fine', keys: run('fine') },
    { stage: 'disliked', keys: run('disliked') },
  ], estimates);
}

/**
 * The finished Beli order merged with the existing jelly list (entry IDs, best first). `shared`
 * maps a Beli row key to the jelly entry it turned out to be: that spot is one item, known to both.
 * The shorter list is inserted into the longer one.
 */
export function startJellyMerge(
  beliOrder: string[],
  jellyIds: string[],
  shared: Record<string, string>,
  estimates: Record<string, number>
): MergeState {
  const beli = beliOrder.map((k) => shared[k] ?? k);
  const [longer, shorter] = beli.length >= jellyIds.length ? [beli, jellyIds] : [jellyIds, beli];
  return startMerge(longer, [{ stage: 'jelly', keys: shorter }], estimates);
}

const est = (s: MergeState, key: string) => s.estimates[key] ?? 5;

/**
 * Sets up the search for the next spot to place: places shared spots straight away, works out
 * the range it can land in and the estimated spot to start from.
 */
function prepare(s: MergeState): MergeState {
  let state = s;
  for (;;) {
    const run = state.pending[0];
    if (!run) return { ...state, lo: 0, hi: state.merged.length };
    const [key, ...rest] = run.keys;
    const at = state.merged.indexOf(key);
    if (at !== -1) {
      // Known to both lists: no question; later spots of the run go below it (if the orders agree)
      state = advance(state, rest, at >= state.floor ? at + 1 : state.floor, null);
      continue;
    }
    // Can't land below the next shared spot of its run (if that one sits below the floor)
    const nextShared = rest.map((k) => state.merged.indexOf(k)).find((i) => i !== -1);
    const hi = nextShared !== undefined && nextShared >= state.floor ? nextShared : state.merged.length;
    const lo = Math.min(state.floor, hi);
    let guess = lo;
    while (guess < hi && est(state, state.merged[guess]) >= est(state, key)) guess++;
    if (lo >= hi) {
      state = advance(state, rest, lo + 1, { key, at: lo });
      continue;
    }
    return { ...state, lo, hi, guess, phase: guess < hi ? 'start' : 'up', step: 1 };
  }
}

/** Moves on from the current spot (inserting it at `place.at` if given), with the next spot's floor */
function advance(s: MergeState, rest: string[], floor: number, place: { key: string; at: number } | null): MergeState {
  const merged = [...s.merged];
  if (place) merged.splice(place.at, 0, place.key);
  const [run, ...others] = s.pending;
  const pending = rest.length > 0 ? [{ ...run, keys: rest }, ...others] : others;
  // A new run starts from the top
  return { ...s, merged, pending, floor: rest.length > 0 ? floor : 0 };
}

function probeIndex(s: MergeState): number {
  switch (s.phase) {
    case 'start':
      return s.guess;
    case 'up':
      return Math.max(s.lo, s.hi - s.step);
    case 'down':
      return Math.min(s.hi - 1, s.lo + s.step - 1);
    default:
      return s.lo + ((s.hi - s.lo) >> 1);
  }
}

export function nextMergeQuestion(s: MergeState): MergeQuestion | null {
  const run = s.pending[0];
  if (!run || s.lo >= s.hi) return null;
  return { candidate: run.keys[0], other: s.merged[probeIndex(s)], stage: run.stage, asked: s.asked, remaining: s.pending.reduce((n, r) => n + r.keys.length, 0) };
}

/** 'candidate' / 'other' = that one is better; 'tie' = too close to call (the candidate goes just below) */
export function answerMergeQuestion(s: MergeState, answer: MergeAnswer, now = Date.now()): MergeState {
  const q = nextMergeQuestion(s);
  if (!q) return s;
  const i = probeIndex(s);
  const result = answer === 'candidate' ? 1 : answer === 'other' ? 0 : 0.5;
  const base: MergeState = { ...s, asked: s.asked + 1, answers: [...s.answers, { candidate: q.candidate, other: q.other, result, at: now }] };
  const rest = s.pending[0].keys.slice(1);
  if (answer === 'tie') return prepare(advance(base, rest, i + 2, { key: q.candidate, at: i + 1 }));

  const wins = answer === 'candidate';
  let next: MergeState;
  if (s.phase === 'start') next = wins ? { ...base, hi: i, phase: 'up', step: 1 } : { ...base, lo: i + 1, phase: 'down', step: 1 };
  else if (s.phase === 'up') next = wins ? { ...base, hi: i, step: s.step * 2 } : { ...base, lo: i + 1, phase: 'binary' };
  else if (s.phase === 'down') next = wins ? { ...base, hi: i, phase: 'binary' } : { ...base, lo: i + 1, step: s.step * 2 };
  else next = wins ? { ...base, hi: i } : { ...base, lo: i + 1 };

  if (next.lo >= next.hi) return prepare(advance(next, rest, next.lo + 1, { key: q.candidate, at: next.lo }));
  return next;
}

/** Places every spot not yet placed at its estimated spot (within what the answers allow): for when the user stops early. */
export function finishMerge(s: MergeState): MergeState {
  let state = s;
  while (state.pending.length > 0) {
    const key = state.pending[0].keys[0];
    // Within [lo, hi]: nearest the estimate
    let at = state.lo;
    while (at < state.hi && est(state, state.merged[at]) >= est(state, key)) at++;
    state = prepare(advance(state, state.pending[0].keys.slice(1), at + 1, { key, at }));
  }
  return state;
}

export function mergeDone(s: MergeState): boolean {
  return s.pending.length === 0;
}

/** The order so far; spots not placed yet go at their estimated spot */
export function mergeOrder(s: MergeState): string[] {
  return finishMerge(s).merged;
}

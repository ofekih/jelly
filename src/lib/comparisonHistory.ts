import { RestaurantEntry, StoredComparison } from '../types';

/*
 * Every side-by-side answer is kept (on one of the two entries), so evidence keeps piling up as a
 * list grows: placing a new spot between two older ones also says something about those two. A
 * Bradley-Terry fit over all answers, anchored to the current order, spots places that the
 * answers say are out of order; jelly then asks about them instead of moving anything silently.
 * Only the latest answer about a pair counts, and answers older than a spot's last re-rank are
 * ignored (you changed your mind about it).
 */
const MAX_STORED = 300; // Per entry; oldest answers are dropped first
const RANK_STEP = 0.01; // Same line as the side-by-side search: score, plus a little per rank
const ANCHOR_SPREAD = 0.5; // How far the fit may drift from the current order without evidence
const PREFERENCE_NOISE = 0.3; // How blurry a preference is, in score points (as in the search)
const LAPSE_RATE = 0.03; // Chance of a slip however far apart the two are
const CONFLICT_MARGIN = 0.25; // How far the fit must put a lower spot above a higher one to flag it
export const PROMPT_MARGIN = 0.35; // Only offer a check unprompted when a conflict is at least this strong
const FIT_ITERATIONS = 150;

export interface Judgment {
  a: string; // Entry ids
  b: string;
  result: number; // a's result against b: 1, 0.5 or 0
  at: number;
}

export interface OrderConflict {
  above: RestaurantEntry; // Currently ranked higher…
  below: RestaurantEntry; // …but the answers say this one is better
  margin: number; // How strongly, in score points
}

export type CheckOutcome = 'below_wins' | 'above_wins' | 'tie';

function lastRankedAt(entry: RestaurantEntry): number {
  let t = entry.createdAt || 0;
  for (const h of entry.rankedHistory || []) t = Math.max(t, h.timestamp || 0);
  return t;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Adds answers to an entry, keeping only the latest per opponent and the newest MAX_STORED */
export function appendComparisons(
  entry: RestaurantEntry,
  added: StoredComparison[]
): RestaurantEntry {
  if (added.length === 0) return entry;
  const latest = new Map<string, StoredComparison>();
  for (const c of [...(entry.comparisons || []), ...added]) {
    const prev = latest.get(c.opponentId);
    if (!prev || c.at >= prev.at) latest.set(c.opponentId, c);
  }
  const comparisons = [...latest.values()].sort((x, y) => x.at - y.at).slice(-MAX_STORED);
  return { ...entry, comparisons };
}

/** The latest valid answer for every pair of spots within one rank-ordered category list */
export function collectJudgments(list: RestaurantEntry[]): Judgment[] {
  const byId = new Map(list.map((e) => [e.id, e]));
  const latest = new Map<string, Judgment>();
  for (const owner of list) {
    const ownerRankedAt = lastRankedAt(owner);
    for (const c of owner.comparisons || []) {
      const opponent = byId.get(c.opponentId);
      if (!opponent || opponent.id === owner.id) continue;
      if (c.at < ownerRankedAt || c.at < lastRankedAt(opponent)) continue;
      const key = pairKey(owner.id, opponent.id);
      const prev = latest.get(key);
      if (!prev || c.at >= prev.at) {
        latest.set(key, { a: owner.id, b: opponent.id, result: c.result, at: c.at });
      }
    }
  }
  return [...latest.values()];
}

/** Where each spot sits on the line today (higher = better), in list order */
function anchorPositions(list: RestaurantEntry[]): number[] {
  const anchors: number[] = [];
  list.forEach((e, i) => {
    const pos = (e.magicScore ?? e.initialRating) - RANK_STEP * i;
    anchors.push(i === 0 ? pos : Math.min(pos, anchors[i - 1] - RANK_STEP));
  });
  return anchors;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

interface FitPair {
  i: number;
  k: number;
  r: number;
}

/** Log posterior of `theta`: the answers' likelihood plus the pull toward the current order */
function logPosterior(theta: number[], anchors: number[], pairs: FitPair[]): number {
  const scale = PREFERENCE_NOISE / 1.702;
  let total = 0;
  for (let i = 0; i < theta.length; i++) {
    total -= (theta[i] - anchors[i]) ** 2 / (2 * ANCHOR_SPREAD * ANCHOR_SPREAD);
  }
  for (const { i, k, r } of pairs) {
    const p = LAPSE_RATE + (1 - 2 * LAPSE_RATE) * sigmoid((theta[i] - theta[k]) / scale);
    total += r * Math.log(p) + (1 - r) * Math.log(1 - p);
  }
  return total;
}

/** Preconditioned gradient ascent from `start`; `lapse` = 0 gives the plain (concave) fit */
function ascend(start: number[], anchors: number[], pairs: FitPair[], lapse: number): number[] {
  const theta = [...start];
  const scale = PREFERENCE_NOISE / 1.702; // Logistic stand-in for the normal CDF
  const priorPrecision = 1 / (ANCHOR_SPREAD * ANCHOR_SPREAD);
  const curvature = new Array<number>(theta.length).fill(priorPrecision);
  for (const p of pairs) {
    curvature[p.i] += 0.25 / (scale * scale);
    curvature[p.k] += 0.25 / (scale * scale);
  }
  const grad = new Array<number>(theta.length);
  for (let iter = 0; iter < FIT_ITERATIONS; iter++) {
    for (let i = 0; i < theta.length; i++) grad[i] = -(theta[i] - anchors[i]) * priorPrecision;
    for (const { i, k, r } of pairs) {
      const s = sigmoid((theta[i] - theta[k]) / scale);
      const p = lapse + (1 - 2 * lapse) * s; // P(i preferred over k)
      const dp = ((1 - 2 * lapse) * s * (1 - s)) / scale;
      const g = (r / p - (1 - r) / (1 - p)) * dp;
      grad[i] += g;
      grad[k] -= g;
    }
    for (let i = 0; i < theta.length; i++) theta[i] += (0.8 * grad[i]) / curvature[i];
  }
  return theta;
}

/**
 * Bradley-Terry strengths (one per spot, in list order, on the score line), anchored to the
 * current order by a Gaussian prior. Allowing for slips makes the fit non-concave: started from
 * the current order it can get stuck calling several consistent answers "slips", so it's also
 * started from the slip-free fit, and whichever explains the answers better wins.
 */
export function fitStrengths(list: RestaurantEntry[], judgments: Judgment[]): number[] {
  const anchors = anchorPositions(list);
  const index = new Map(list.map((e, i) => [e.id, i]));
  const pairs = judgments
    .map((j) => ({ i: index.get(j.a), k: index.get(j.b), r: j.result }))
    .filter((p): p is FitPair => p.i !== undefined && p.k !== undefined);
  if (pairs.length === 0) return anchors;

  const fromOrder = ascend(anchors, anchors, pairs, LAPSE_RATE);
  const fromPlain = ascend(ascend(anchors, anchors, pairs, 0), anchors, pairs, LAPSE_RATE);
  return logPosterior(fromPlain, anchors, pairs) > logPosterior(fromOrder, anchors, pairs) ? fromPlain : fromOrder;
}

/**
 * Pairs the answers say are out of order, strongest first (list must be rank-ordered). A pair you
 * answered directly is never flagged if that answer agrees with the order or was too close to
 * call: your own latest word on a pair beats any chain of other answers.
 */
export function findOrderConflicts(list: RestaurantEntry[]): OrderConflict[] {
  const judgments = collectJudgments(list);
  if (judgments.length === 0) return [];
  const theta = fitStrengths(list, judgments);
  const direct = new Map(judgments.map((j) => [pairKey(j.a, j.b), j]));
  const conflicts: OrderConflict[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let k = i + 1; k < list.length; k++) {
      const margin = theta[k] - theta[i];
      if (margin <= CONFLICT_MARGIN) continue;
      const answered = direct.get(pairKey(list[i].id, list[k].id));
      const lowerWon = answered && (answered.a === list[k].id ? answered.result : 1 - answered.result) === 1;
      if (answered && !lowerWon) continue;
      conflicts.push({ above: list[i], below: list[k], margin });
    }
  }
  return conflicts.sort((x, y) => y.margin - x.margin);
}

/**
 * The next pair to ask about. The strongest conflict points at a spot that is out of place (too
 * low, or too high); of all the spots it's flagged against, ask about the middle one, so a spot
 * that belongs ten places higher gets there in a few questions instead of one place at a time.
 */
export function pickCheck(conflicts: OrderConflict[]): OrderConflict | undefined {
  const top = conflicts[0];
  if (!top) return undefined;
  const tooLow = conflicts.filter((c) => c.below.id === top.below.id);
  const tooHigh = conflicts.filter((c) => c.above.id === top.above.id);
  const group = (tooLow.length >= tooHigh.length ? tooLow : tooHigh).sort(
    (x, y) => x.above.rankIndex - y.above.rankIndex || x.below.rankIndex - y.below.rankIndex
  );
  return group[Math.floor((group.length - 1) / 2)];
}

/** Roughly how many spots need a look: conflicts picked greedily so no spot counts twice */
export function countSpotsToCheck(conflicts: OrderConflict[]): number {
  const used = new Set<string>();
  let count = 0;
  for (const c of conflicts) {
    if (used.has(c.above.id) || used.has(c.below.id)) continue;
    used.add(c.above.id);
    used.add(c.below.id);
    count++;
  }
  return count;
}

/** Moves `list[from]` to `to` (as a drag does) */
export function moveSpot<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Total amount by which an order disagrees with the fitted strengths */
function disagreement(order: RestaurantEntry[], strength: Map<string, number>): number {
  let total = 0;
  for (let i = 0; i < order.length; i++) {
    const si = strength.get(order[i].id)!;
    for (let k = i + 1; k < order.length; k++) {
      total += Math.max(0, strength.get(order[k].id)! - si);
    }
  }
  return total;
}

/**
 * Records your answer to an order check and, if it confirms the conflict, fixes the order with
 * the smaller of two moves (the lower spot up to just above, or the higher spot down to just
 * below), whichever agrees better with everything else you've said.
 */
export function applyCheckAnswer(
  list: RestaurantEntry[],
  conflict: OrderConflict,
  outcome: CheckOutcome,
  now: number
): RestaurantEntry[] {
  const result = outcome === 'below_wins' ? 1 : outcome === 'above_wins' ? 0 : 0.5;
  const withAnswer = list.map((e) =>
    e.id === conflict.below.id
      ? appendComparisons(e, [{ opponentId: conflict.above.id, result, at: now }])
      : e
  );
  if (outcome !== 'below_wins') return withAnswer;

  const from = withAnswer.findIndex((e) => e.id === conflict.below.id);
  const target = withAnswer.findIndex((e) => e.id === conflict.above.id);
  if (from === -1 || target === -1 || from < target) return withAnswer;

  const theta = fitStrengths(withAnswer, collectJudgments(withAnswer));
  const strength = new Map(withAnswer.map((e, i) => [e.id, theta[i]]));
  const raiseLower = moveSpot(withAnswer, from, target);
  const dropHigher = moveSpot(withAnswer, target, from);
  return disagreement(dropHigher, strength) < disagreement(raiseLower, strength) ? dropHigher : raiseLower;
}

/**
 * Answers implied by dragging `list[from]` to `to`: it now beats its new lower neighbour and loses
 * to its new upper one, and it overrides any earlier answer against the spots it was dragged past
 * (so a deliberate drag never gets flagged as a conflict).
 */
export function dragComparisons(
  list: RestaurantEntry[],
  from: number,
  to: number,
  now: number
): StoredComparison[] {
  if (from === to) return [];
  const moved = list[from];
  const answered = new Set(
    collectJudgments(list)
      .filter((j) => j.a === moved.id || j.b === moved.id)
      .map((j) => (j.a === moved.id ? j.b : j.a))
  );
  const records: StoredComparison[] = [];
  const passed = from > to ? list.slice(to, from) : list.slice(from + 1, to + 1);
  for (const p of passed) {
    if (answered.has(p.id)) records.push({ opponentId: p.id, result: from > to ? 1 : 0, at: now });
  }
  const rest = list.filter((e) => e.id !== moved.id);
  const above = rest[to - 1];
  const below = rest[to];
  if (above && !records.some((r) => r.opponentId === above.id)) records.push({ opponentId: above.id, result: 0, at: now });
  if (below && !records.some((r) => r.opponentId === below.id)) records.push({ opponentId: below.id, result: 1, at: now });
  return records;
}

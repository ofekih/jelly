import { RestaurantEntry } from '../types';
import { RATING_TIERS } from './ratingTiers';

export type SxSOutcome = 'new_wins' | 'opponent_wins' | 'tie' | 'skip';

interface SxSHistoryStep {
  opponentId: string;
  opponentName: string;
  opponentIndex: number;
  outcome: SxSOutcome;
  weightsBefore: number[];
  candidateEloBefore: number;
  eloFloorBefore: number;
  eloCeilingBefore: number;
  opponentEloAdjustmentsBefore: Record<string, number>;
}

export interface SxSSearchState {
  slotWeights: number[]; // Belief over gaps 0..N (gap k = just above spot k; gap N = bottom)
  gapPositions: number[]; // Length N + 1: where each gap sits on the list's line (see listPositions)
  spotPositions: number[]; // Length N: where each existing spot sits on the same line
  sameTagSpots: boolean[]; // Length N: spot shares a cuisine/type tag with the candidate
  initialExpectedError: number; // Expected placement error before any answer (for progress)
  comparedIndices: number[];
  skippedIndices: number[];
  completedComparisons: number;
  maxComparisons: number; // Safety cap; the search normally stops well before it
  initialRating: number;
  candidateElo: number;
  eloFloor: number;
  eloCeiling: number;
  opponentEloAdjustments: Record<string, number>; // id -> delta Elo from matches
  candidateCuisines: string[];
  history: SxSHistoryStep[];
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

export function ratingToBaseElo(initialRating: number): number {
  return Math.round(950 + clamp(initialRating, 1, 10) * 100);
}

/**
 * One stop per tier boundary, each tier filling its `barShare` of the bar:
 * Skip 1.0 (0%), Mid 4.0 (16%), Good 6.0 (37%), Great 7.5 (61%), Incredible 8.8 (88%)..10.0 (100%)
 */
const BALANCED_SPECTRUM_STOPS: Array<{ pct: number; rating: number }> = [
  ...RATING_TIERS.map((tier, i) => ({
    pct: RATING_TIERS.slice(0, i).reduce((sum, t) => sum + t.barShare, 0) / 100,
    rating: tier.from,
  })),
  { pct: 1.0, rating: 10.0 },
];

/** Spectrum colours anchored to ratings, so the gradient lines up with the tiers in either mode */
const SPECTRUM_COLOR_STOPS: Array<{ rating: number; color: string }> = [
  { rating: 1.0, color: '#f43f5e' },
  { rating: 3.4, color: '#fb7185' },
  { rating: 5.0, color: '#f59e0b' },
  { rating: 6.5, color: '#06b6d4' },
  { rating: 7.7, color: '#14b8a6' },
  { rating: 8.8, color: '#10b981' },
  { rating: 10.0, color: '#047857' },
];

export function spectrumGradient(linear = false): string {
  const stops = SPECTRUM_COLOR_STOPS.map(
    (s) => `${s.color} ${spectrumRatingToPct(s.rating, linear).toFixed(1)}%`
  );
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export function pctToSpectrumRating(pct: number, linear = false): number {
  const p = clamp(pct, 0, 1);
  if (linear) {
    return round1(clamp(1.0 + p * 9.0, 1.0, 10.0));
  }
  for (let i = 0; i < BALANCED_SPECTRUM_STOPS.length - 1; i++) {
    const s0 = BALANCED_SPECTRUM_STOPS[i];
    const s1 = BALANCED_SPECTRUM_STOPS[i + 1];
    if (p <= s1.pct || i === BALANCED_SPECTRUM_STOPS.length - 2) {
      const localT = (p - s0.pct) / (s1.pct - s0.pct);
      const val = s0.rating + localT * (s1.rating - s0.rating);
      return round1(clamp(val, 1.0, 10.0));
    }
  }
  return 10.0;
}

export function spectrumRatingToPct(rating: number, linear = false): number {
  const r = clamp(rating, 1.0, 10.0);
  if (linear) {
    return ((r - 1.0) / 9.0) * 100;
  }
  for (let i = 0; i < BALANCED_SPECTRUM_STOPS.length - 1; i++) {
    const s0 = BALANCED_SPECTRUM_STOPS[i];
    const s1 = BALANCED_SPECTRUM_STOPS[i + 1];
    if (r <= s1.rating || i === BALANCED_SPECTRUM_STOPS.length - 2) {
      const localT = (r - s0.rating) / (s1.rating - s0.rating);
      const pct = s0.pct + localT * (s1.pct - s0.pct);
      return clamp(pct * 100, 0, 100);
    }
  }
  return 100;
}

function expectedEloWinProbability(eloA: number, eloB: number): number {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

function normalizeWeights(weights: number[]): number[] {
  const sum = weights.reduce((acc, w) => acc + w, 0);
  if (sum <= 0) {
    const uniform = 1 / weights.length;
    return weights.map(() => uniform);
  }
  return weights.map((w) => w / sum);
}

/*
 * Scores from order + gut ratings. Each spot has a true score; the list order says true scores never
 * rise down the list, and each gut rating is a noisy reading of one. The score shown is the expected
 * true score given all the gut ratings and the order, computed exactly on a grid with one pass down
 * the list and one back up. So a 7 ranked above an 8 ends up just above it instead of both being
 * pinned at 7.5, and a gut the order clearly overrules is mostly ignored (heavy-tailed noise).
 *
 * Two things are unknown and averaged over, each setting weighted by how well it explains this
 * list's gut ratings given its order:
 * - how noisy the gut ratings are. Re-rating studies put this at about ±1 point on a 1–10 scale
 *   (Amatriain et al. 2009; Hill et al. 1995), so that's the starting belief; a list whose guts keep
 *   agreeing with its order shows they're more precise, and then scores stay close to them.
 * - how spread out the list's true scores are around its median gut rating, so a long list of
 *   places that all felt amazing isn't stretched down the scale.
 * Tuned by simulating noisy users against the earlier isotonic fit and against fixed settings.
 */
const GUT_NOISE_DOF = 4; // Student-t: heavy tails, so a clear overrule is mostly ignored
const GUT_NOISE_DEFAULT = 0.75; // t scale; ≈ ±1 point typical spread
const GUT_NOISE_PRIOR_LOG_SD = 0.35; // How far a list's own evidence can pull the noise from the default
const GUT_NOISE_OPTIONS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9, 1.1, 1.3, 1.6];
const SPREAD_OPTIONS = [0.3, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const GRID_STEP = 0.1;
const SCORE_GRID: number[] = Array.from({ length: Math.round(9 / GRID_STEP) + 1 }, (_, k) => 1 + k * GRID_STEP);
const ELO_STEP = 2; // Fixed Elo gap kept between neighbours (Elo no longer feeds the scores)

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
}

const K = SCORE_GRID.length;
const NEGLIGIBLE_WEIGHT = 1e-4; // Settings this much less likely than the best are left out

function normalizedPrior(center: number, spread: number): Float64Array {
  const prior = new Float64Array(K);
  let sum = 0;
  for (let k = 0; k < K; k++) {
    prior[k] = Math.exp(-0.5 * ((SCORE_GRID[k] - center) / spread) ** 2);
    sum += prior[k];
  }
  for (let k = 0; k < K; k++) prior[k] /= sum;
  return prior;
}

/**
 * Forward pass down the list (the spot above sits at the same grid point or higher), each row
 * normalised in place into `rows` (n·K); returns log P(evidence, order). `evidence` is n·K too.
 */
function forwardPass(n: number, evidence: Float64Array, rows: Float64Array): number {
  let logZ = 0;
  for (let i = 0; i < n; i++) {
    const at = i * K;
    let atOrAbove = 0;
    let sum = 0;
    for (let k = K - 1; k >= 0; k--) {
      if (i === 0) {
        rows[k] = evidence[k];
      } else {
        atOrAbove += rows[at - K + k];
        rows[at + k] = evidence[at + k] * atOrAbove;
      }
      sum += rows[at + k];
    }
    logZ += Math.log(sum);
    for (let k = 0; k < K; k++) rows[at + k] /= sum;
  }
  return logZ;
}

/** Adds weight × each spot's expected grid value to `out`, via a backward pass up the list */
function addPosteriorMeans(n: number, evidence: Float64Array, rows: Float64Array, weight: number, out: number[]): void {
  let backward = new Float64Array(K).fill(1); // ∝ P(guts below spot i | spot i at grid k)
  let next = new Float64Array(K);
  for (let i = n - 1; i >= 0; i--) {
    const at = i * K;
    let total = 0;
    let weighted = 0;
    for (let k = 0; k < K; k++) {
      const p = rows[at + k] * backward[k];
      total += p;
      weighted += p * SCORE_GRID[k];
    }
    out[i] += (weight * weighted) / total;
    if (i > 0) {
      let atOrBelow = 0;
      for (let k = 0; k < K; k++) {
        atOrBelow += evidence[at + k] * backward[k];
        next[k] = atOrBelow;
      }
      for (let k = 0; k < K; k++) next[k] /= atOrBelow;
      [backward, next] = [next, backward];
    }
  }
}

/**
 * Expected true scores for spots in list order, given their gut ratings: never increasing down the
 * list, each pulled towards its gut rating, its neighbours' and the list's median.
 */
export function fitScoresToOrder(guts: number[]): number[] {
  const n = guts.length;
  if (n === 0) return [];
  const center = median(guts);

  // Gut-rating likelihoods per noise level (Student-t; the constant cancels except for 1/noise)
  const likelihoods = GUT_NOISE_OPTIONS.map((noise) => {
    const lik = new Float64Array(n * K);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < K; k++) {
        const r = (guts[i] - SCORE_GRID[k]) / noise;
        lik[i * K + k] = Math.pow(1 + (r * r) / GUT_NOISE_DOF, -(GUT_NOISE_DOF + 1) / 2) / noise;
      }
    }
    return lik;
  });

  // How well each (noise, spread) explains the guts given the order. Dividing by P(order) on the
  // same grid keeps a narrow spread from winning just by letting spots tie on one grid point.
  const rows = new Float64Array(n * K);
  const settings: Array<{ noise: number; prior: Float64Array; logWeight: number }> = [];
  for (const spread of SPREAD_OPTIONS) {
    const prior = normalizedPrior(center, spread);
    const priorOnly = new Float64Array(n * K);
    for (let i = 0; i < n; i++) priorOnly.set(prior, i * K);
    const orderOnly = forwardPass(n, priorOnly, rows);
    GUT_NOISE_OPTIONS.forEach((noise, j) => {
      const evidence = withPrior(likelihoods[j], prior, n);
      const noisePrior = -0.5 * (Math.log(noise / GUT_NOISE_DEFAULT) / GUT_NOISE_PRIOR_LOG_SD) ** 2;
      settings.push({ noise, prior, logWeight: forwardPass(n, evidence, rows) - orderOnly + noisePrior });
    });
  }

  const top = Math.max(...settings.map((s) => s.logWeight));
  const scores = new Array<number>(n).fill(0);
  let total = 0;
  for (const s of settings) {
    const weight = Math.exp(s.logWeight - top);
    if (weight < NEGLIGIBLE_WEIGHT) continue;
    const evidence = withPrior(likelihoods[GUT_NOISE_OPTIONS.indexOf(s.noise)], s.prior, n);
    forwardPass(n, evidence, rows);
    addPosteriorMeans(n, evidence, rows, weight, scores);
    total += weight;
  }
  return scores.map((s) => s / total);
}

function withPrior(likelihood: Float64Array, prior: Float64Array, n: number): Float64Array {
  const evidence = new Float64Array(n * K);
  for (let i = 0; i < n; i++) for (let k = 0; k < K; k++) evidence[i * K + k] = likelihood[i * K + k] * prior[k];
  return evidence;
}

/**
 * Turns an ordered category list into 1.0–10.0 scores: the expected true score of each spot given
 * its position and everyone's gut ratings, so scores stay on the gut-label scale and never rise
 * down the list.
 * Elo is kept only for compatibility: it tracks the score and steps down by at least ELO_STEP.
 */
export function recomputeMagicScores(orderedList: RestaurantEntry[]): RestaurantEntry[] {
  const n = orderedList.length;
  if (n === 0) return [];

  const guts = orderedList.map((r) => {
    if (Number.isFinite(r.initialRating)) return clamp(r.initialRating, 1.0, 10.0);
    return Number.isFinite(r.magicScore) ? clamp(r.magicScore, 1.0, 10.0) : 5.0;
  });
  const scores = fitScoresToOrder(guts).map((s) => round1(clamp(s, 1.0, 10.0)));

  const elos = new Array<number>(n);
  for (let k = 0; k < n; k++) {
    const base = ratingToBaseElo(scores[k]);
    elos[k] = clamp(k === 0 ? base : Math.min(base, elos[k - 1] - ELO_STEP), 0, 5000);
  }

  return orderedList.map((item, idx) => ({
    ...item,
    elo: elos[idx],
    rankIndex: idx,
    magicScore: scores[idx],
  }));
}

/**
 * Seeds a starting ELO for a restaurant given its 1–10 gut rating and existing ranked spots.
 */
function seedEloFromRating(
  existingRanked: RestaurantEntry[],
  initialRating: number
): number {
  const baseElo = ratingToBaseElo(initialRating);
  if (existingRanked.length === 0) return baseElo;

  // Find existing slot where magicScore / initialRating is closest to initialRating
  let closestIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < existingRanked.length; i++) {
    const refScore = 0.7 * existingRanked[i].magicScore + 0.3 * existingRanked[i].initialRating;
    const diff = Math.abs(initialRating - refScore);
    if (diff < minDiff) {
      minDiff = diff;
      closestIdx = i;
    }
  }

  const empiricalElo = existingRanked[closestIdx].elo || ratingToBaseElo(existingRanked[closestIdx].initialRating);
  return Math.round(0.5 * baseElo + 0.5 * empiricalElo);
}

/*
 * Side-by-side placement as a noisy binary search (probabilistic bisection).
 *
 * The existing list is laid out on a line: each spot sits at -score plus a tiny step per rank, so
 * distances mean "how differently you feel about these" and a run of equal scores still keeps its
 * order. The new spot belongs in one of the N + 1 gaps; we keep a belief over those gaps, ask the
 * question expected to shrink the placement error the most, and stop once the expected error is
 * small enough or no remaining question would really help. Tuned by simulating noisy users on
 * lists of 5–300 spots (see src/lib/sxsSimulation.test.ts). Answers are never treated as certain:
 * preferring A over B is more likely to be a slip the closer A and B sit on the line.
 */
const PRIOR_SIGMA = 1.5; // Spread of the gut-feeling prior, in score points
const PRIOR_FLOOR = 0.03; // No gap is ever ruled out by the gut feeling alone
const END_MARGIN = 0.35; // The gaps above #1 and below the last spot sit this far past them
const RANK_STEP = 0.01; // Each position adds this much distance, so equal scores stay ordered
const PREFERENCE_NOISE = 0.3; // How blurry a preference is, in score points
const SAME_TAG_NOISE = 0.75; // Like vs. like (ramen vs. ramen) is easier to judge
const LAPSE_RATE = 0.03; // Chance of a slip (misclick, misread) however far apart the two are
const TIE_WIDTH = 0.3; // "Too tough to call" points at gaps within about this distance
const TIE_FLOOR = 0.1;
const INDIFFERENCE = 0.1; // Being off by less than this many points doesn't count as an error
const TARGET_EXPECTED_ERROR = 0.02; // Stop once the expected error is below this many points…
const MIN_EXPECTED_GAIN = 0.005; // …or once no question would cut it by at least this much
const MAX_QUESTIONS = 12; // Safety cap against fatigue
const SAME_TAG_BONUS = 1.25; // Prefer a like-vs-like question when it's nearly as useful
const SAME_TAG_CHECK = 0.03; // Before finishing, ask about the nearest same-tag spots unless ≥97% sure

/** Positions of the existing spots and of the gaps between them on the search line */
function listPositions(existingRanked: RestaurantEntry[]): {
  spotPositions: number[];
  gapPositions: number[];
} {
  const n = existingRanked.length;
  const spotPositions: number[] = [];
  for (let i = 0; i < n; i++) {
    const score = existingRanked[i].magicScore ?? existingRanked[i].initialRating;
    const pos = -score + RANK_STEP * i;
    spotPositions.push(i === 0 ? pos : Math.max(pos, spotPositions[i - 1] + RANK_STEP));
  }
  if (n === 0) return { spotPositions, gapPositions: [0] };
  const gapPositions = [spotPositions[0] - END_MARGIN];
  for (let k = 1; k < n; k++) gapPositions.push(0.5 * (spotPositions[k - 1] + spotPositions[k]));
  gapPositions.push(spotPositions[n - 1] + END_MARGIN);
  return { spotPositions, gapPositions };
}

/**
 * Best gap (weighted median) and the expected placement error: how far the true gap is from it on
 * the line, ignoring the first INDIFFERENCE points (places that close are a coin flip anyway)
 */
function expectedError(weights: number[], positions: number[]): { median: number; error: number } {
  const total = weights.reduce((a, w) => a + w, 0);
  if (total <= 0) return { median: 0, error: 0 };
  let cumulative = 0;
  let median = weights.length - 1;
  for (let k = 0; k < weights.length; k++) {
    cumulative += weights[k];
    if (cumulative >= total / 2) {
      median = k;
      break;
    }
  }
  let error = 0;
  for (let k = 0; k < weights.length; k++) {
    error += weights[k] * Math.max(0, Math.abs(positions[k] - positions[median]) - INDIFFERENCE);
  }
  return { median, error: error / total };
}

/** P(you prefer the new spot over spot i | the new spot truly belongs in gap k) */
function newWinsLikelihood(state: SxSSearchState, k: number, i: number): number {
  const d = state.gapPositions[k] - state.spotPositions[i]; // < 0: gap k is above spot i
  const noise = PREFERENCE_NOISE * (state.sameTagSpots[i] ? SAME_TAG_NOISE : 1);
  const sure = 1 / (1 + Math.exp((-1.702 * Math.abs(d)) / noise));
  const consistent = LAPSE_RATE + (1 - 2 * LAPSE_RATE) * sure;
  return d < 0 ? consistent : 1 - consistent;
}

function outcomeLikelihood(
  state: SxSSearchState,
  k: number,
  i: number,
  outcome: 'new_wins' | 'opponent_wins' | 'tie'
): number {
  if (outcome === 'new_wins') return newWinsLikelihood(state, k, i);
  if (outcome === 'opponent_wins') return 1 - newWinsLikelihood(state, k, i);
  const d = (state.gapPositions[k] - state.spotPositions[i]) / TIE_WIDTH;
  return TIE_FLOOR + Math.exp(-0.5 * d * d);
}

/** How much asking about spot i is expected to cut the placement error */
function questionGain(state: SxSSearchState, i: number, currentError: number): number {
  const w = state.slotWeights;
  const ifWins = new Array<number>(w.length);
  const ifLoses = new Array<number>(w.length);
  let pWins = 0;
  for (let k = 0; k < w.length; k++) {
    const p = newWinsLikelihood(state, k, i);
    ifWins[k] = w[k] * p;
    ifLoses[k] = w[k] * (1 - p);
    pWins += ifWins[k];
  }
  const after =
    pWins * expectedError(ifWins, state.gapPositions).error +
    (1 - pWins) * expectedError(ifLoses, state.gapPositions).error;
  return currentError - after;
}

/**
 * Initializes the noisy binary search for a newly rated spot.
 * `existingRanked` must be the rank-ordered list of the candidate's own category only;
 * spots are never compared across category lists.
 */
export function initSxSSearch(
  existingRanked: RestaurantEntry[],
  initialRating: number,
  candidateCuisines: string[] = []
): SxSSearchState {
  const n = existingRanked.length;
  const candidateElo = seedEloFromRating(existingRanked, initialRating);
  const { spotPositions, gapPositions } = listPositions(existingRanked);

  const rawWeights = new Array<number>(n + 1);
  for (let k = 0; k <= n && n > 0; k++) {
    let slotRefScore: number;
    if (k === 0) {
      slotRefScore = Math.min(10.0, existingRanked[0].magicScore + END_MARGIN);
    } else if (k === n) {
      slotRefScore = Math.max(1.0, existingRanked[n - 1].magicScore - END_MARGIN);
    } else {
      slotRefScore = 0.5 * (existingRanked[k - 1].magicScore + existingRanked[k].magicScore);
    }
    const diff = initialRating - slotRefScore;
    rawWeights[k] = Math.exp(-(diff * diff) / (2 * PRIOR_SIGMA * PRIOR_SIGMA)) + PRIOR_FLOOR;
  }
  const slotWeights = n === 0 ? [1] : normalizeWeights(rawWeights);

  const topElo = n > 0 ? existingRanked[0].elo || ratingToBaseElo(existingRanked[0].initialRating) : 950;
  const bottomElo =
    n > 0 ? existingRanked[n - 1].elo || ratingToBaseElo(existingRanked[n - 1].initialRating) : 950;

  return {
    slotWeights,
    gapPositions,
    spotPositions,
    sameTagSpots: existingRanked.map((r) => sharesTagWithCandidate(r, candidateCuisines)),
    initialExpectedError: expectedError(slotWeights, gapPositions).error,
    comparedIndices: [],
    skippedIndices: [],
    completedComparisons: 0,
    maxComparisons: Math.min(n, MAX_QUESTIONS),
    initialRating,
    candidateElo,
    eloFloor: n > 0 ? bottomElo - 150 : 800,
    eloCeiling: n > 0 ? topElo + 150 : 2400,
    opponentEloAdjustments: {},
    candidateCuisines,
    history: [],
  };
}

/**
 * Current best insertion slot (0..N): the weighted median of the belief, which minimizes the
 * expected distance to the true gap. `confidence` is the probability (0–100) of that exact gap.
 */
export function getBestInsertionIndex(state: SxSSearchState): {
  insertIndex: number;
  confidence: number;
} {
  if (state.slotWeights.length <= 1) {
    return { insertIndex: 0, confidence: 100 };
  }
  const { median } = expectedError(state.slotWeights, state.gapPositions);
  return {
    insertIndex: median,
    confidence: Math.round(clamp(state.slotWeights[median] * 100, 1, 99)),
  };
}

/** 0–1: how far the expected error has fallen from its starting value towards the target (log scale) */
export function getSearchProgress(state: SxSSearchState): number {
  const { error } = expectedError(state.slotWeights, state.gapPositions);
  const start = state.initialExpectedError;
  if (start <= TARGET_EXPECTED_ERROR || error <= 0) return 1;
  return clamp(Math.log(start / error) / Math.log(start / TARGET_EXPECTED_ERROR), 0, 1);
}

/**
 * The candidate's Elo for its final slot: its tracked Elo if that already sits between its new
 * neighbours (with this search's adjustments), otherwise squeezed in between them, so a slip the
 * search overruled can't drag the neighbours' scores along.
 */
export function getPlacementElo(
  state: SxSSearchState,
  existingRanked: RestaurantEntry[],
  insertIndex: number
): number {
  const eloOf = (r: RestaurantEntry) =>
    (r.elo || ratingToBaseElo(r.initialRating)) + (state.opponentEloAdjustments[r.id] || 0);
  const above = insertIndex > 0 ? existingRanked[insertIndex - 1] : undefined;
  const below = insertIndex < existingRanked.length ? existingRanked[insertIndex] : undefined;
  const hi = above ? eloOf(above) : Infinity;
  const lo = below ? eloOf(below) : -Infinity;
  const elo = state.candidateElo;
  if (elo < hi && elo > lo) return elo;
  if (above && below) return Math.round(0.5 * (hi + lo));
  return above ? hi - 16 : below ? lo + 16 : elo;
}

function sharesTagWithCandidate(
  entry: RestaurantEntry,
  candidateCuisines: string[]
): boolean {
  if (!candidateCuisines || candidateCuisines.length === 0) return false;
  const candSet = new Set(
    candidateCuisines.map((c) => c.trim().toLowerCase()).filter(Boolean)
  );
  if (candSet.size === 0) return false;
  for (const c of entry.cuisines || []) {
    if (candSet.has(c.trim().toLowerCase())) return true;
  }
  if (entry.primaryTypeDisplay && candSet.has(entry.primaryTypeDisplay.trim().toLowerCase())) {
    return true;
  }
  return false;
}

/**
 * The nearest same-tag spot (e.g. the closest Japanese place) directly above or below the best gap
 * that hasn't been compared yet, if there's still at least a 3% chance the new spot is on its other
 * side; -1 if none. Keeps each cuisine's own sub-ranking right.
 */
function pendingSameTagCheck(state: SxSSearchState, median: number): number {
  const w = state.slotWeights;
  const n = state.spotPositions.length;
  const skipped = new Set(state.skippedIndices);
  const compared = new Set(state.comparedIndices);
  let best = -1;
  let bestRisk = SAME_TAG_CHECK;

  for (let i = median - 1; i >= 0; i--) {
    if (!state.sameTagSpots[i] || skipped.has(i)) continue;
    if (!compared.has(i)) {
      const risk = w.slice(0, i + 1).reduce((a, x) => a + x, 0); // P(new spot is above it)
      if (risk >= bestRisk) {
        best = i;
        bestRisk = risk;
      }
    }
    break;
  }
  for (let i = median; i < n; i++) {
    if (!state.sameTagSpots[i] || skipped.has(i)) continue;
    if (!compared.has(i)) {
      const risk = w.slice(i + 1).reduce((a, x) => a + x, 0); // P(new spot is below it)
      if (risk >= bestRisk) best = i;
    }
    break;
  }
  return best;
}

/**
 * Picks the next spot to compare against: the question expected to cut the placement error the
 * most (a like-vs-like question wins when it's nearly as useful). Returns null once the expected
 * error is below target, no question would help enough, or the safety cap is reached, after first
 * checking the nearest uncompared same-tag spots above and below.
 */
export function pickNextOpponent(
  state: SxSSearchState,
  existingRanked: RestaurantEntry[]
): { opponentIndex: number; opponent: RestaurantEntry } | null {
  const n = existingRanked.length;
  if (n === 0 || state.completedComparisons >= state.maxComparisons) return null;

  const used = new Set([...state.comparedIndices, ...state.skippedIndices]);
  const { median, error } = expectedError(state.slotWeights, state.gapPositions);

  let bestIdx = -1;
  let bestScore = -Infinity;
  let maxGain = 0;
  if (error > TARGET_EXPECTED_ERROR) {
    for (let i = 0; i < n; i++) {
      if (used.has(i)) continue;
      const gain = questionGain(state, i, error);
      const score = gain * (state.sameTagSpots[i] ? SAME_TAG_BONUS : 1);
      maxGain = Math.max(maxGain, gain);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
  }

  const idx = bestIdx !== -1 && maxGain >= MIN_EXPECTED_GAIN ? bestIdx : pendingSameTagCheck(state, median);
  return idx === -1 ? null : { opponentIndex: idx, opponent: existingRanked[idx] };
}

/**
 * Updates both the ELO rating and the search belief after a comparison answer.
 */
export function recordSxSComparison(
  state: SxSSearchState,
  opponentIndex: number,
  opponent: RestaurantEntry,
  outcome: SxSOutcome
): SxSSearchState {
  const historyStep: SxSHistoryStep = {
    opponentId: opponent.id,
    opponentName: opponent.name,
    opponentIndex,
    outcome,
    weightsBefore: state.slotWeights,
    candidateEloBefore: state.candidateElo,
    eloFloorBefore: state.eloFloor,
    eloCeilingBefore: state.eloCeiling,
    opponentEloAdjustmentsBefore: state.opponentEloAdjustments,
  };

  if (outcome === 'skip') {
    return {
      ...state,
      skippedIndices: [...state.skippedIndices, opponentIndex],
      history: [...state.history, historyStep],
    };
  }

  const oppElo =
    (opponent.elo || ratingToBaseElo(opponent.initialRating)) +
    (state.opponentEloAdjustments[opponent.id] || 0);
  const pWin = expectedEloWinProbability(state.candidateElo, oppElo);
  const actualScore = outcome === 'new_wins' ? 1.0 : outcome === 'opponent_wins' ? 0.0 : 0.5;

  // Placement K-factor = 64 for the candidate, gentle K = 14 for established opponent
  const kCandidate = 64;
  const kOpponent = 14;

  let nextCandidateElo = Math.round(state.candidateElo + kCandidate * (actualScore - pWin));
  const oppDelta = Math.round(kOpponent * (1 - actualScore - (1 - pWin)));

  let nextFloor = state.eloFloor;
  let nextCeiling = state.eloCeiling;

  if (outcome === 'new_wins') {
    nextFloor = Math.max(nextFloor, oppElo + oppDelta + 10);
    if (nextCeiling < nextFloor) nextCeiling = nextFloor + 24;
    nextCandidateElo = clamp(Math.max(nextCandidateElo, oppElo + 16), nextFloor, nextCeiling);
  } else if (outcome === 'opponent_wins') {
    nextCeiling = Math.min(nextCeiling, oppElo + oppDelta - 10);
    if (nextFloor > nextCeiling) nextFloor = nextCeiling - 24;
    nextCandidateElo = clamp(Math.min(nextCandidateElo, oppElo - 16), nextFloor, nextCeiling);
  } else {
    nextCandidateElo = Math.round(0.5 * (state.candidateElo + oppElo));
  }

  const nextWeights = state.slotWeights.map(
    (w, k) => w * outcomeLikelihood(state, k, opponentIndex, outcome)
  );

  return {
    ...state,
    slotWeights: normalizeWeights(nextWeights),
    comparedIndices: [...state.comparedIndices, opponentIndex],
    completedComparisons: state.completedComparisons + 1,
    candidateElo: nextCandidateElo,
    eloFloor: nextFloor,
    eloCeiling: nextCeiling,
    opponentEloAdjustments: {
      ...state.opponentEloAdjustments,
      [opponent.id]: (state.opponentEloAdjustments[opponent.id] || 0) + oppDelta,
    },
    history: [...state.history, historyStep],
  };
}

/**
 * Undo the last comparison step in SxS arena.
 */
export function undoLastSxSStep(state: SxSSearchState): SxSSearchState {
  if (state.history.length === 0) return state;
  const lastStep = state.history[state.history.length - 1];
  const nextHistory = state.history.slice(0, -1);

  if (lastStep.outcome === 'skip') {
    return {
      ...state,
      skippedIndices: state.skippedIndices.filter((i) => i !== lastStep.opponentIndex),
      history: nextHistory,
    };
  }

  return {
    ...state,
    slotWeights: lastStep.weightsBefore,
    comparedIndices: state.comparedIndices.filter((i) => i !== lastStep.opponentIndex),
    completedComparisons: Math.max(0, state.completedComparisons - 1),
    candidateElo: lastStep.candidateEloBefore,
    eloFloor: lastStep.eloFloorBefore,
    eloCeiling: lastStep.eloCeilingBefore,
    opponentEloAdjustments: lastStep.opponentEloAdjustmentsBefore,
    history: nextHistory,
  };
}

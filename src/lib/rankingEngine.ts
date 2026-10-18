import { MealCategory, RestaurantEntry } from '../types';

export interface SxSHistoryStep {
  opponentId: string;
  opponentName: string;
  opponentIndex: number;
  outcome: 'new_wins' | 'opponent_wins' | 'tie' | 'skip';
  weightsBefore: number[];
  minValidSlotBefore: number;
  maxValidSlotBefore: number;
  candidateEloBefore: number;
  eloFloorBefore: number;
  eloCeilingBefore: number;
  opponentEloAdjustmentsBefore: Record<string, number>;
}

export interface SxSSearchState {
  slotWeights: number[]; // Length N + 1 (slots 0..N)
  minValidSlot: number; // Inclusive lower slot bound (0..N)
  maxValidSlot: number; // Inclusive upper slot bound (0..N)
  comparedIndices: number[];
  skippedIndices: number[];
  completedComparisons: number;
  maxComparisons: number;
  initialRating: number;
  candidateElo: number;
  eloFloor: number;
  eloCeiling: number;
  opponentEloAdjustments: Record<string, number>; // id -> delta Elo from matches
  candidateMeal: MealCategory;
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
 * 5 Equal Visual Divisions (20% each):
 * - 0.00..0.20: Skip (1.0..4.0)
 * - 0.20..0.40: Mid (4.0..6.0) -> 5.0 is at 0.30 (exact middle of Mid)
 * - 0.40..0.60: Good (6.0..7.5)
 * - 0.60..0.80: Great (7.5..8.8)
 * - 0.80..1.00: Incredible (8.8..10.0)
 */
const BALANCED_SPECTRUM_STOPS: Array<{ pct: number; rating: number }> = [
  { pct: 0.0, rating: 1.0 },
  { pct: 0.2, rating: 4.0 },
  { pct: 0.4, rating: 6.0 },
  { pct: 0.6, rating: 7.5 },
  { pct: 0.8, rating: 8.8 },
  { pct: 1.0, rating: 10.0 },
];

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

export function expectedEloWinProbability(eloA: number, eloB: number): number {
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

/**
 * Pool-Adjacent-Violators (PAV) algorithm for monotonically non-increasing sequence:
 * Finds z_0 >= z_1 >= ... >= z_{n-1} minimizing sum (z_i - y_i)^2.
 */
function isotonicDecreasing(y: number[]): number[] {
  interface Block {
    sum: number;
    count: number;
    start: number;
    end: number;
  }

  const blocks: Block[] = [];
  for (let i = 0; i < y.length; i++) {
    blocks.push({ sum: y[i], count: 1, start: i, end: i });
    while (blocks.length >= 2) {
      const last = blocks[blocks.length - 1];
      const prev = blocks[blocks.length - 2];
      const prevMean = prev.sum / prev.count;
      const lastMean = last.sum / last.count;
      if (prevMean < lastMean) {
        prev.sum += last.sum;
        prev.count += last.count;
        prev.end = last.end;
        blocks.pop();
      } else {
        break;
      }
    }
  }

  const result = new Array<number>(y.length);
  for (const b of blocks) {
    const mean = b.sum / b.count;
    for (let i = b.start; i <= b.end; i++) {
      result[i] = mean;
    }
  }
  return result;
}

/**
 * Ensures every entry has a valid ELO that strictly decreases down the ordered list,
 * and converts those ELO scores into 1.0–10.0 displayed scores loosely calibrated by
 * the user's 1–10 gut ratings.
 */
export function recomputeMagicScores(orderedList: RestaurantEntry[]): RestaurantEntry[] {
  const n = orderedList.length;
  if (n === 0) return [];

  if (n === 1) {
    const single = orderedList[0];
    const elo = typeof single.elo === 'number' && !Number.isNaN(single.elo)
      ? Math.round(single.elo)
      : ratingToBaseElo(single.initialRating);
    return [
      {
        ...single,
        elo,
        rankIndex: 0,
        magicScore: clamp(round1(single.initialRating), 1.0, 10.0),
      },
    ];
  }

  // 1. Ensure each item has an ELO and enforce monotonic decreasing ELO along orderedList
  const rawElos = orderedList.map((r) =>
    typeof r.elo === 'number' && !Number.isNaN(r.elo)
      ? r.elo
      : ratingToBaseElo(r.initialRating)
  );

  const minEloStep = 12;
  const shiftedElos = rawElos.map((e, k) => e + k * minEloStep);
  const monotonicShiftedElos = isotonicDecreasing(shiftedElos);
  const cleanElos = monotonicShiftedElos.map((z, k) =>
    Math.round(clamp(z - k * minEloStep, 800, 2600))
  );

  // 2. Convert ELOs to 1.0–10.0 scale, loosely calibrated by the user's 1–10 gut ratings
  const ratings = orderedList.map((r) => clamp(r.initialRating, 1.0, 10.0));
  const meanRating = ratings.reduce((a, b) => a + b, 0) / n;
  const ratingVar = ratings.reduce((a, r) => a + (r - meanRating) ** 2, 0) / n;
  const stdRating = Math.max(0.65, Math.sqrt(ratingVar));

  const meanElo = cleanElos.reduce((a, b) => a + b, 0) / n;
  const eloVar = cleanElos.reduce((a, e) => a + (e - meanElo) ** 2, 0) / n;
  const stdElo = Math.max(85, Math.sqrt(eloVar));

  const rawScores = new Array<number>(n);
  for (let k = 0; k < n; k++) {
    const elo = cleanElos[k];
    // Standardized ELO mapped onto the user's personal rating mean & spread
    const calibratedEloScore = meanRating + ((elo - meanElo) / stdElo) * stdRating;
    // Absolute ELO anchor (where 1050 = 1.0 and 1950 = 10.0)
    const absoluteEloScore = (elo - 950) / 100;
    const pureElo10 = 0.60 * calibratedEloScore + 0.40 * absoluteEloScore;

    // 85% ELO-derived score + 15% individual initial 1-10 gut rating
    rawScores[k] = 0.85 * pureElo10 + 0.15 * ratings[k];
  }

  const maxRating = Math.max(...ratings);
  const minRating = Math.min(...ratings);
  const spread = Math.max(0.5, maxRating - minRating + 0.4);
  const minScoreStep = Math.min(0.08, spread / (2 * (n - 1)));

  const shiftedScores = rawScores.map((s, k) => s + k * minScoreStep);
  const monotonicShiftedScores = isotonicDecreasing(shiftedScores);
  const finalScores = monotonicShiftedScores.map((z, k) =>
    round1(clamp(z - k * minScoreStep, 1.0, 10.0))
  );

  for (let k = 1; k < n; k++) {
    if (finalScores[k] > finalScores[k - 1]) {
      finalScores[k] = finalScores[k - 1];
    }
  }

  return orderedList.map((item, idx) => ({
    ...item,
    elo: cleanElos[idx],
    rankIndex: idx,
    magicScore: finalScores[idx],
  }));
}

/**
 * Seeds a starting ELO for a restaurant given its 1–10 gut rating and existing ranked spots.
 */
export function seedEloFromRating(
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

/**
 * Initializes the ELO + Noisy Binary Search state for a newly rated restaurant.
 */
export function initSxSSearch(
  existingRanked: RestaurantEntry[],
  initialRating: number,
  candidateMeal: MealCategory = 'Dinner',
  candidateCuisines: string[] = []
): SxSSearchState {
  const n = existingRanked.length;
  const numSlots = n + 1;
  const candidateElo = seedEloFromRating(existingRanked, initialRating);

  if (n === 0) {
    return {
      slotWeights: [1],
      minValidSlot: 0,
      maxValidSlot: 0,
      comparedIndices: [],
      skippedIndices: [],
      completedComparisons: 0,
      maxComparisons: 0,
      initialRating,
      candidateElo,
      eloFloor: 800,
      eloCeiling: 2400,
      opponentEloAdjustments: {},
      candidateMeal,
      candidateCuisines,
      history: [],
    };
  }

  const sigma = 1.5;
  const rawWeights = new Array<number>(numSlots);

  for (let k = 0; k < numSlots; k++) {
    let slotRefScore: number;
    if (k === 0) {
      slotRefScore = Math.min(10.0, existingRanked[0].magicScore + 0.35);
    } else if (k === n) {
      slotRefScore = Math.max(1.0, existingRanked[n - 1].magicScore - 0.35);
    } else {
      slotRefScore = 0.5 * (existingRanked[k - 1].magicScore + existingRanked[k].magicScore);
    }
    const diff = initialRating - slotRefScore;
    rawWeights[k] = Math.exp(-(diff * diff) / (2 * sigma * sigma)) + 0.03;
  }

  const slotWeights = normalizeWeights(rawWeights);
  const maxComparisons = Math.min(5, Math.max(1, Math.ceil(Math.log2(n + 1))));

  const topElo = existingRanked[0].elo || ratingToBaseElo(existingRanked[0].initialRating);
  const bottomElo =
    existingRanked[n - 1].elo || ratingToBaseElo(existingRanked[n - 1].initialRating);

  return {
    slotWeights,
    minValidSlot: 0,
    maxValidSlot: n,
    comparedIndices: [],
    skippedIndices: [],
    completedComparisons: 0,
    maxComparisons,
    initialRating,
    candidateElo,
    eloFloor: bottomElo - 150,
    eloCeiling: topElo + 150,
    opponentEloAdjustments: {},
    candidateMeal,
    candidateCuisines,
    history: [],
  };
}

/**
 * Computes the current best insertion slot (0..N), final calibrated ELO, and 0-100 confidence,
 * respecting the active [minValidSlot, maxValidSlot] bounds from direct comparisons.
 */
export function getBestInsertionIndex(state: SxSSearchState): {
  insertIndex: number;
  confidence: number;
} {
  const weights = state.slotWeights;
  const numSlots = weights.length;
  if (numSlots <= 1) {
    return { insertIndex: 0, confidence: 100 };
  }

  const lo = clamp(state.minValidSlot ?? 0, 0, numSlots - 1);
  const hi = clamp(state.maxValidSlot ?? numSlots - 1, lo, numSlots - 1);

  let bestSlot = lo;
  let bestWeight = -1;
  for (let i = lo; i <= hi; i++) {
    if (weights[i] > bestWeight) {
      bestWeight = weights[i];
      bestSlot = i;
    }
  }

  let localMass = weights[bestSlot];
  if (bestSlot > 0) localMass += weights[bestSlot - 1] * 0.65;
  if (bestSlot < numSlots - 1) localMass += weights[bestSlot + 1] * 0.65;

  const progressRatio =
    state.maxComparisons > 0 ? state.completedComparisons / state.maxComparisons : 1;
  const confidence = Math.round(clamp((localMass * 0.65 + progressRatio * 0.35) * 100, 20, 99));

  return { insertIndex: bestSlot, confidence };
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
 * Checks whether there is an uncompared spot sharing a cuisine/category tag (e.g. Japanese)
 * immediately above (`index < insertIndex`) or immediately below (`index >= insertIndex`)
 * the candidate's current projected insertion slot.
 */
function getMissingSameCuisineNeighbors(
  state: SxSSearchState,
  existingRanked: RestaurantEntry[],
  insertIndex: number
): { missingCuisineAbove: number; missingCuisineBelow: number } {
  if (!state.candidateCuisines || state.candidateCuisines.length === 0) {
    return { missingCuisineAbove: -1, missingCuisineBelow: -1 };
  }
  const n = existingRanked.length;
  const comparedSet = new Set(state.comparedIndices);
  const skippedSet = new Set(state.skippedIndices);

  let nearestSameCuisineAbove = -1;
  for (let i = Math.min(n - 1, insertIndex - 1); i >= 0; i--) {
    if (skippedSet.has(i)) continue;
    if (sharesTagWithCandidate(existingRanked[i], state.candidateCuisines)) {
      nearestSameCuisineAbove = i;
      break;
    }
  }

  let nearestSameCuisineBelow = -1;
  for (let i = Math.max(0, insertIndex); i < n; i++) {
    if (skippedSet.has(i)) continue;
    if (sharesTagWithCandidate(existingRanked[i], state.candidateCuisines)) {
      nearestSameCuisineBelow = i;
      break;
    }
  }

  const missingCuisineAbove =
    nearestSameCuisineAbove !== -1 && !comparedSet.has(nearestSameCuisineAbove)
      ? nearestSameCuisineAbove
      : -1;
  const missingCuisineBelow =
    nearestSameCuisineBelow !== -1 && !comparedSet.has(nearestSameCuisineBelow)
      ? nearestSameCuisineBelow
      : -1;

  return { missingCuisineAbove, missingCuisineBelow };
}

/**
 * Checks whether there is an uncompared spot of the same meal immediately above
 * (`index < insertIndex`) or immediately below (`index >= insertIndex`) the candidate's
 * current projected insertion slot.
 */
function getMissingSameMealNeighbors(
  state: SxSSearchState,
  existingRanked: RestaurantEntry[],
  insertIndex: number
): { missingAbove: number; missingBelow: number } {
  const n = existingRanked.length;
  const comparedSet = new Set(state.comparedIndices);
  const skippedSet = new Set(state.skippedIndices);

  let nearestSameMealAbove = -1;
  for (let i = Math.min(n - 1, insertIndex - 1); i >= 0; i--) {
    if (skippedSet.has(i)) continue;
    if (existingRanked[i].meal === state.candidateMeal) {
      nearestSameMealAbove = i;
      break;
    }
  }

  let nearestSameMealBelow = -1;
  for (let i = Math.max(0, insertIndex); i < n; i++) {
    if (skippedSet.has(i)) continue;
    if (existingRanked[i].meal === state.candidateMeal) {
      nearestSameMealBelow = i;
      break;
    }
  }

  const missingAbove =
    nearestSameMealAbove !== -1 && !comparedSet.has(nearestSameMealAbove)
      ? nearestSameMealAbove
      : -1;
  const missingBelow =
    nearestSameMealBelow !== -1 && !comparedSet.has(nearestSameMealBelow)
      ? nearestSameMealBelow
      : -1;

  return { missingAbove, missingBelow };
}

/**
 * Picks the next restaurant opponent for a side-by-side comparison,
 * prioritizing spots with the same cuisine/category tags (e.g. Japanese) and meal,
 * and guaranteeing that adjacent same-cuisine and same-meal neighbors above/below
 * the candidate's position are compared before concluding.
 */
export function pickNextOpponent(
  state: SxSSearchState,
  existingRanked: RestaurantEntry[]
): { opponentIndex: number; opponent: RestaurantEntry } | null {
  const n = existingRanked.length;
  if (n === 0) return null;

  const usedSet = new Set([...state.comparedIndices, ...state.skippedIndices]);
  if (usedSet.size >= n) return null;

  const { insertIndex } = getBestInsertionIndex(state);
  const { missingCuisineAbove, missingCuisineBelow } = getMissingSameCuisineNeighbors(
    state,
    existingRanked,
    insertIndex
  );
  const { missingAbove, missingBelow } = getMissingSameMealNeighbors(
    state,
    existingRanked,
    insertIndex
  );
  const hasMissingSameCuisineNeighbor =
    missingCuisineAbove !== -1 || missingCuisineBelow !== -1;
  const hasMissingSameMealNeighbor = missingAbove !== -1 || missingBelow !== -1;

  // Allow up to 2 extra comparisons beyond base maxComparisons if needed to verify same-tag / same-meal neighbors
  const hardMaxComparisons = Math.min(n, state.maxComparisons + 2);
  if (state.completedComparisons >= hardMaxComparisons) return null;

  const maxWeight = Math.max(...state.slotWeights);
  const baseConverged =
    state.completedComparisons >= state.maxComparisons ||
    state.minValidSlot >= state.maxValidSlot ||
    (maxWeight >= 0.66 && (state.completedComparisons >= 2 || n <= 2));

  if (baseConverged && !hasMissingSameCuisineNeighbor && !hasMissingSameMealNeighbor) {
    return null;
  }

  // Find median of current slot distribution within [minValidSlot, maxValidSlot]
  const loSlot = clamp(state.minValidSlot ?? 0, 0, n);
  const hiSlot = clamp(state.maxValidSlot ?? n, loSlot, n);
  let windowMass = 0;
  for (let k = loSlot; k <= hiSlot; k++) {
    windowMass += state.slotWeights[k];
  }

  let cumulative = 0;
  let medianSlot = insertIndex;
  const halfMass = windowMass > 0 ? windowMass * 0.5 : 0.5;
  for (let k = loSlot; k <= hiSlot; k++) {
    cumulative += state.slotWeights[k];
    if (cumulative >= halfMass) {
      medianSlot = k;
      break;
    }
  }

  const targetOpponentIdx = clamp(
    medianSlot === 0 ? 0 : medianSlot >= n ? n - 1 : medianSlot - 0.5,
    0,
    n - 1
  );

  // 1. Inside the active window [loSlot, hiSlot - 1]:
  //    a) First look for an uncompared spot sharing BOTH cuisine tag (e.g. Japanese) AND meal
  //    b) Next look for an uncompared spot sharing the cuisine tag (e.g. Japanese)
  //    c) Next look for an uncompared spot sharing the meal
  if (loSlot < hiSlot) {
    let bestSameCuisineAndMeal = -1;
    let bestSameCuisineAndMealDist = Infinity;
    let bestSameCuisine = -1;
    let bestSameCuisineDist = Infinity;
    let bestSameMealInWindow = -1;
    let bestSameMealDist = Infinity;

    for (let i = loSlot; i <= hiSlot - 1; i++) {
      if (usedSet.has(i)) continue;
      const entry = existingRanked[i];
      const dist = Math.abs(i - targetOpponentIdx);
      const isSameMeal = entry.meal === state.candidateMeal;
      const isSameCuisine = sharesTagWithCandidate(entry, state.candidateCuisines);

      if (isSameCuisine && isSameMeal && dist < bestSameCuisineAndMealDist) {
        bestSameCuisineAndMealDist = dist;
        bestSameCuisineAndMeal = i;
      }
      if (isSameCuisine && dist < bestSameCuisineDist) {
        bestSameCuisineDist = dist;
        bestSameCuisine = i;
      }
      if (isSameMeal && dist < bestSameMealDist) {
        bestSameMealDist = dist;
        bestSameMealInWindow = i;
      }
    }

    if (bestSameCuisineAndMeal !== -1) {
      return {
        opponentIndex: bestSameCuisineAndMeal,
        opponent: existingRanked[bestSameCuisineAndMeal],
      };
    }
    if (bestSameCuisine !== -1) {
      return {
        opponentIndex: bestSameCuisine,
        opponent: existingRanked[bestSameCuisine],
      };
    }
    if (bestSameMealInWindow !== -1) {
      return {
        opponentIndex: bestSameMealInWindow,
        opponent: existingRanked[bestSameMealInWindow],
      };
    }
  }

  // 2a. If an adjacent same-cuisine spot (e.g. Japanese) above or below `insertIndex` hasn't been compared yet,
  //     compare against it first!
  if (missingCuisineAbove !== -1 && missingCuisineBelow !== -1) {
    const distAbove = Math.abs(missingCuisineAbove - targetOpponentIdx);
    const distBelow = Math.abs(missingCuisineBelow - targetOpponentIdx);
    const chosenIdx = distAbove <= distBelow ? missingCuisineAbove : missingCuisineBelow;
    return {
      opponentIndex: chosenIdx,
      opponent: existingRanked[chosenIdx],
    };
  }
  if (missingCuisineAbove !== -1) {
    return {
      opponentIndex: missingCuisineAbove,
      opponent: existingRanked[missingCuisineAbove],
    };
  }
  if (missingCuisineBelow !== -1) {
    return {
      opponentIndex: missingCuisineBelow,
      opponent: existingRanked[missingCuisineBelow],
    };
  }

  // 2b. If the adjacent same-meal spot above or below `insertIndex` hasn't been compared yet,
  //     compare against it next.
  if (missingAbove !== -1 && missingBelow !== -1) {
    const distAbove = Math.abs(missingAbove - targetOpponentIdx);
    const distBelow = Math.abs(missingBelow - targetOpponentIdx);
    const chosenIdx = distAbove <= distBelow ? missingAbove : missingBelow;
    return {
      opponentIndex: chosenIdx,
      opponent: existingRanked[chosenIdx],
    };
  }
  if (missingAbove !== -1) {
    return {
      opponentIndex: missingAbove,
      opponent: existingRanked[missingAbove],
    };
  }
  if (missingBelow !== -1) {
    return {
      opponentIndex: missingBelow,
      opponent: existingRanked[missingBelow],
    };
  }

  // 3. Otherwise (same-cuisine and same-meal neighbors above & below are already verified),
  //    refine exact placement within the active window [loSlot, hiSlot - 1]
  let bestCandidateIdx = -1;
  let bestCandidateScore = -Infinity;

  const searchStart = loSlot < hiSlot ? loSlot : 0;
  const searchEnd = loSlot < hiSlot ? hiSlot - 1 : n - 1;

  for (let i = searchStart; i <= searchEnd; i++) {
    if (usedSet.has(i)) continue;

    const item = existingRanked[i];
    const dist = Math.abs(i - targetOpponentIdx);

    let score = -dist * 1.45;

    if (sharesTagWithCandidate(item, state.candidateCuisines) && dist <= 4) {
      score += 1.25;
    }
    if (item.meal === state.candidateMeal && dist <= 3) score += 0.75;

    const jitter = (((i * 31 + state.completedComparisons * 17) % 10) - 5) * 0.03;
    score += jitter;

    if (score > bestCandidateScore) {
      bestCandidateScore = score;
      bestCandidateIdx = i;
    }
  }

  if (bestCandidateIdx === -1) return null;

  return {
    opponentIndex: bestCandidateIdx,
    opponent: existingRanked[bestCandidateIdx],
  };
}

/**
 * Updates both the ELO rating and the noisy search belief distribution after a user comparison choice.
 */
export function recordSxSComparison(
  state: SxSSearchState,
  opponentIndex: number,
  opponent: RestaurantEntry,
  outcome: 'new_wins' | 'opponent_wins' | 'tie' | 'skip'
): SxSSearchState {
  const prevWeights = [...state.slotWeights];
  const prevMinSlot = state.minValidSlot;
  const prevMaxSlot = state.maxValidSlot;
  const prevAdjustments = { ...state.opponentEloAdjustments };

  if (outcome === 'skip') {
    return {
      ...state,
      skippedIndices: [...state.skippedIndices, opponentIndex],
      history: [
        ...state.history,
        {
          opponentId: opponent.id,
          opponentName: opponent.name,
          opponentIndex,
          outcome,
          weightsBefore: prevWeights,
          minValidSlotBefore: prevMinSlot,
          maxValidSlotBefore: prevMaxSlot,
          candidateEloBefore: state.candidateElo,
          eloFloorBefore: state.eloFloor,
          eloCeilingBefore: state.eloCeiling,
          opponentEloAdjustmentsBefore: prevAdjustments,
        },
      ],
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
  let nextMinSlot = state.minValidSlot;
  let nextMaxSlot = state.maxValidSlot;

  if (outcome === 'new_wins') {
    nextFloor = Math.max(nextFloor, oppElo + oppDelta + 10);
    if (nextCeiling < nextFloor) nextCeiling = nextFloor + 24;
    nextCandidateElo = clamp(Math.max(nextCandidateElo, oppElo + 16), nextFloor, nextCeiling);

    // Candidate beat opponent at `opponentIndex`, so candidate belongs at or above `opponentIndex`
    nextMaxSlot = Math.min(nextMaxSlot, opponentIndex);
    if (nextMinSlot > nextMaxSlot) {
      nextMinSlot = nextMaxSlot;
    }
  } else if (outcome === 'opponent_wins') {
    nextCeiling = Math.min(nextCeiling, oppElo + oppDelta - 10);
    if (nextFloor > nextCeiling) nextFloor = nextCeiling - 24;
    nextCandidateElo = clamp(Math.min(nextCandidateElo, oppElo - 16), nextFloor, nextCeiling);

    // Opponent at `opponentIndex` beat candidate, so candidate belongs below `opponentIndex`
    nextMinSlot = Math.max(nextMinSlot, opponentIndex + 1);
    if (nextMaxSlot < nextMinSlot) {
      nextMaxSlot = nextMinSlot;
    }
  } else {
    nextCandidateElo = Math.round(0.5 * (state.candidateElo + oppElo));
    nextMinSlot = clamp(opponentIndex, 0, state.slotWeights.length - 1);
    nextMaxSlot = clamp(opponentIndex + 1, nextMinSlot, state.slotWeights.length - 1);
  }

  const winMultiplier = 0.92;
  const loseMultiplier = 0.05;

  const nextWeights = state.slotWeights.map((w, slotIdx) => {
    if (outcome === 'new_wins') {
      return slotIdx <= opponentIndex ? w * winMultiplier : w * loseMultiplier;
    } else if (outcome === 'opponent_wins') {
      return slotIdx >= opponentIndex + 1 ? w * winMultiplier : w * loseMultiplier;
    } else {
      const distFromOpponent = Math.abs(slotIdx - (opponentIndex + 0.5));
      const tieBoost = Math.exp(-(distFromOpponent * distFromOpponent) / (2 * 0.85 * 0.85)) + 0.08;
      return w * tieBoost;
    }
  });

  const nextAdjustments = {
    ...state.opponentEloAdjustments,
    [opponent.id]: (state.opponentEloAdjustments[opponent.id] || 0) + oppDelta,
  };

  return {
    ...state,
    slotWeights: normalizeWeights(nextWeights),
    minValidSlot: nextMinSlot,
    maxValidSlot: nextMaxSlot,
    comparedIndices: [...state.comparedIndices, opponentIndex],
    completedComparisons: state.completedComparisons + 1,
    candidateElo: nextCandidateElo,
    eloFloor: nextFloor,
    eloCeiling: nextCeiling,
    opponentEloAdjustments: nextAdjustments,
    history: [
      ...state.history,
      {
        opponentId: opponent.id,
        opponentName: opponent.name,
        opponentIndex,
        outcome,
        weightsBefore: prevWeights,
        minValidSlotBefore: prevMinSlot,
        maxValidSlotBefore: prevMaxSlot,
        candidateEloBefore: state.candidateElo,
        eloFloorBefore: state.eloFloor,
        eloCeilingBefore: state.eloCeiling,
        opponentEloAdjustmentsBefore: prevAdjustments,
      },
    ],
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
    minValidSlot: lastStep.minValidSlotBefore,
    maxValidSlot: lastStep.maxValidSlotBefore,
    comparedIndices: state.comparedIndices.filter((i) => i !== lastStep.opponentIndex),
    completedComparisons: Math.max(0, state.completedComparisons - 1),
    candidateElo: lastStep.candidateEloBefore,
    eloFloor: lastStep.eloFloorBefore,
    eloCeiling: lastStep.eloCeilingBefore,
    opponentEloAdjustments: lastStep.opponentEloAdjustmentsBefore,
    history: nextHistory,
  };
}

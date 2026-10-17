import { MealCategory, RestaurantEntry } from '../types';

export interface SxSHistoryStep {
  opponentId: string;
  opponentName: string;
  opponentIndex: number;
  outcome: 'new_wins' | 'opponent_wins' | 'tie' | 'skip';
  weightsBefore: number[];
  candidateEloBefore: number;
  eloFloorBefore: number;
  eloCeilingBefore: number;
  opponentEloAdjustmentsBefore: Record<string, number>;
}

export interface SxSSearchState {
  slotWeights: number[]; // Length N + 1 (slots 0..N)
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
 * Computes the current best insertion slot (0..N), final calibrated ELO, and 0-100 confidence.
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

  let bestSlot = 0;
  let bestWeight = -1;
  for (let i = 0; i < numSlots; i++) {
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

/**
 * Picks the next restaurant opponent for a side-by-side comparison,
 * or returns null when the search has converged or hit maxComparisons.
 */
export function pickNextOpponent(
  state: SxSSearchState,
  existingRanked: RestaurantEntry[]
): { opponentIndex: number; opponent: RestaurantEntry } | null {
  const n = existingRanked.length;
  if (n === 0) return null;
  if (state.completedComparisons >= state.maxComparisons) return null;

  const maxWeight = Math.max(...state.slotWeights);
  if (maxWeight >= 0.66 && (state.completedComparisons >= 2 || n <= 2)) {
    return null;
  }

  // Find median of current slot distribution
  let cumulative = 0;
  let medianSlot = 0;
  for (let k = 0; k < state.slotWeights.length; k++) {
    cumulative += state.slotWeights[k];
    if (cumulative >= 0.5) {
      medianSlot = k;
      break;
    }
  }

  const targetOpponentIdx = clamp(
    medianSlot === 0 ? 0 : medianSlot >= n ? n - 1 : medianSlot - 0.5,
    0,
    n - 1
  );

  const usedSet = new Set([...state.comparedIndices, ...state.skippedIndices]);

  let bestCandidateIdx = -1;
  let bestCandidateScore = -Infinity;

  for (let i = 0; i < n; i++) {
    if (usedSet.has(i)) continue;

    const item = existingRanked[i];
    const dist = Math.abs(i - targetOpponentIdx);

    let score = -dist * 1.45;

    // Gentle preference for same-meal or same-cuisine opponents when close in rank
    if (item.meal === state.candidateMeal && dist <= 3) score += 0.5;
    if (item.cuisines.some((c) => state.candidateCuisines.includes(c)) && dist <= 3) {
      score += 0.45;
    }

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

  const winMultiplier = 0.88;
  const loseMultiplier = 0.12;

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
    comparedIndices: state.comparedIndices.filter((i) => i !== lastStep.opponentIndex),
    completedComparisons: Math.max(0, state.completedComparisons - 1),
    candidateElo: lastStep.candidateEloBefore,
    eloFloor: lastStep.eloFloorBefore,
    eloCeiling: lastStep.eloCeilingBefore,
    opponentEloAdjustments: lastStep.opponentEloAdjustmentsBefore,
    history: nextHistory,
  };
}

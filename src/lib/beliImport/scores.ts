import { fitScoresWithSpread } from '../rankingEngine';

/**
 * Gut ratings for an imported list. Beli exports only the order, and jelly's scores are gut
 * ratings fitted to the order, so the user rates spots on the normal spectrum. Rating every spot
 * matches a list ranked in jelly; fewer is allowed (a spot without a rating is unknown to the fit,
 * never guessed). Simulated error (RMS, score points) on a 300-spot list: 3 rated 1.0, 20 rated
 * 0.33, 60 rated 0.25, all 0.13.
 */

/**
 * The order to ask for ratings in, as positions 0..n-1: #1, last, middle, then the middle of each
 * gap, level by level. Wherever the user stops, the ratings so far are spread as evenly as they
 * can be, which is about as good as any choice (simulated: adaptive picks barely beat it).
 */
export function ratingOrder(n: number): number[] {
  if (n <= 0) return [];
  const out = [0];
  if (n > 1) out.push(n - 1);
  let gaps: Array<[number, number]> = n > 2 ? [[0, n - 1]] : [];
  while (gaps.length > 0) {
    const next: Array<[number, number]> = [];
    for (const [a, b] of gaps) {
      if (b - a < 2) continue;
      const mid = (a + b) >> 1;
      out.push(mid);
      next.push([a, mid], [mid, b]);
    }
    gaps = next;
  }
  return out;
}

/** The list's keys in the order to ask for ratings, skipping ones already rated */
export function nextToRate(order: string[], guts: Record<string, number | undefined>): string[] {
  return ratingOrder(order.length)
    .map((i) => order[i])
    .filter((k) => guts[k] === undefined);
}

function gutsInOrder(order: string[], guts: Record<string, number | undefined>): Array<number | null> {
  return order.map((k) => (typeof guts[k] === 'number' ? (guts[k] as number) : null));
}

/** Each spot's estimated score from the ratings so far and the order (to guide merge searches; never stored). */
export function estimateScores(order: string[], guts: Record<string, number | undefined>): Record<string, number> {
  if (order.length === 0) return {};
  const fit = fitScoresWithSpread(gutsInOrder(order, guts));
  return Object.fromEntries(order.map((k, i) => [k, fit[i].mean]));
}

/**
 * How sure the list's scores are with the ratings so far: `typicalError` is the root-mean-square
 * posterior spread across spots (score points), straight from the model. Live feedback for "rate
 * more?" (it shrinks as ratings come in).
 */
export function listAccuracy(order: string[], guts: Record<string, number | undefined>): { rated: number; total: number; typicalError: number } {
  const g = gutsInOrder(order, guts);
  const rated = g.filter((x) => x !== null).length;
  if (order.length === 0) return { rated: 0, total: 0, typicalError: 0 };
  const fit = fitScoresWithSpread(g);
  const typicalError = Math.sqrt(fit.reduce((s, f) => s + f.sd * f.sd, 0) / fit.length);
  return { rated, total: order.length, typicalError };
}

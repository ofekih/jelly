import { pctToSpectrumRating, spectrumRatingToPct } from '../rankingEngine';
import type { Anchor, AnchorLevel, BeliBucket } from './types';

/**
 * Gut ratings for a list whose order is known: the user rates a few anchors on the spectrum, the
 * rest are interpolated by position. Interpolation runs in spectrum-% space (where the bar is
 * evenly spread), so it means the same thing on the linear and the non-linear scale. The guts
 * then go through `recomputeMagicScores` like any list.
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function lastIndexWhere<T>(items: T[], test: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i])) return i;
  return -1;
}

/**
 * Which spots to ask about, in list order.
 * - quick: #1, the last spot ("liked" after the merge if buckets are known, else the median) and
 *   the last; every spot of a list of 3 or fewer.
 * - more: also the quartiles, the best spot of each lower bucket, the last of each bucket, and
 *   every spot of a list of 6 or fewer.
 */
export function suggestAnchors(order: string[], level: AnchorLevel = 'quick', buckets?: Record<string, BeliBucket>): string[] {
  const n = order.length;
  if (n <= (level === 'quick' ? 3 : 6)) return [...order];
  const picks = new Set<number>([0, n - 1]);
  const bucket = (i: number) => buckets?.[order[i]];
  const lastLiked = buckets ? lastIndexWhere(order, (k) => buckets[k] === 'liked') : -1;
  const hasLower = buckets ? order.some((k) => buckets[k] !== 'liked') : false;
  if (lastLiked > 0 && lastLiked < n - 1 && hasLower) picks.add(lastLiked);
  else picks.add(Math.floor((n - 1) / 2));
  if (level === 'more') {
    picks.add(Math.floor((n - 1) / 4));
    picks.add(Math.floor((n - 1) / 2));
    picks.add(Math.floor((3 * (n - 1)) / 4));
    if (buckets) {
      for (const b of ['fine', 'disliked'] as const) {
        const first = order.findIndex((_, i) => bucket(i) === b);
        if (first >= 0) picks.add(first);
      }
      const lastFine = lastIndexWhere(order, (k) => buckets[k] === 'fine');
      if (lastFine >= 0) picks.add(lastFine);
    }
  }
  return [...picks].sort((a, b) => a - b).map((i) => order[i]);
}

/**
 * Anchors used when the user skips rating (or for the stretch of the list beyond the ones they
 * rated). With buckets: "liked" from 9.2 down to 6.0, "fine" 5.9 to 4.0, "didn't like" 3.9 to 1.5,
 * placed by how many spots each bucket has. Without: 9.0 at #1, 7.0 at the median, 4.5 at the
 * bottom. Kept low on purpose, like the spectrum labels.
 */
export function presetAnchors(order: string[], buckets?: Record<string, BeliBucket>): Anchor[] {
  const n = order.length;
  if (n === 0) return [];
  const at = (i: number, rating: number): Anchor => ({ key: order[i], rating, source: 'preset' });
  if (n === 1) return [at(0, 8.0)];
  const counts = { liked: 0, fine: 0, disliked: 0 };
  if (buckets) for (const k of order) counts[buckets[k] ?? 'liked']++;
  if (!buckets || counts.liked === n) {
    return n === 2 ? [at(0, 9.0), at(1, 6.5)] : [at(0, 9.0), at(Math.floor((n - 1) / 2), 7.0), at(n - 1, 4.5)];
  }
  const ranges: Array<[BeliBucket, number, number]> = [
    ['liked', 9.2, 6.0],
    ['fine', 5.9, 4.0],
    ['disliked', 3.9, 1.5],
  ];
  const anchors: Anchor[] = [];
  let start = 0;
  for (const [bucket, top, bottom] of ranges) {
    const size = counts[bucket];
    if (size === 0) continue;
    anchors.push(at(start, top));
    if (size > 1) anchors.push(at(start + size - 1, bottom));
    start += size;
  }
  return anchors;
}

/** Pool-adjacent-violators: the closest non-increasing sequence (weights = 1). */
function nonIncreasing(values: number[]): number[] {
  const blocks: Array<{ sum: number; count: number }> = [];
  for (const v of values) {
    blocks.push({ sum: v, count: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.count >= b.sum / b.count) break;
      blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, count: a.count + b.count });
    }
  }
  return blocks.flatMap((b) => Array(b.count).fill(b.sum / b.count));
}

const SOURCE_PRIORITY: Record<Anchor['source'], number> = { user: 3, existing: 2, preset: 1 };

/**
 * One gut rating per spot of `order`. Anchors keep the rating given; every other spot is
 * interpolated by position between the nearest anchors (flat past the first and last), on the
 * anchors made non-increasing first, so a contradicting pair of anchors never bends the
 * interpolation back up. With no anchors at all, the preset fills in. Preset anchors only count
 * beyond the stretch the user's own anchors cover.
 */
export function interpolateGuts(
  order: string[],
  anchors: Anchor[],
  options: { linear?: boolean; buckets?: Record<string, BeliBucket> } = {}
): Record<string, number> {
  const { linear = false, buckets } = options;
  if (order.length === 0) return {};
  const position = new Map(order.map((k, i) => [k, i]));
  const given = anchors.filter((a) => position.has(a.key) && Number.isFinite(a.rating));
  const real = given.filter((a) => a.source !== 'preset');
  const lo = Math.min(...real.map((a) => position.get(a.key)!));
  const hi = Math.max(...real.map((a) => position.get(a.key)!));
  const preset = [...given.filter((a) => a.source === 'preset'), ...presetAnchors(order, buckets)].filter(
    (a) => real.length === 0 || position.get(a.key)! < lo || position.get(a.key)! > hi
  );

  // One anchor per position, the most trusted source winning
  const byPos = new Map<number, Anchor>();
  for (const a of [...real, ...preset]) {
    const pos = position.get(a.key)!;
    const prev = byPos.get(pos);
    if (!prev || SOURCE_PRIORITY[a.source] > SOURCE_PRIORITY[prev.source]) byPos.set(pos, a);
  }
  const points = [...byPos.entries()].sort((a, b) => a[0] - b[0]);
  const fitted = nonIncreasing(points.map(([, a]) => spectrumRatingToPct(clamp(a.rating, 1, 10), linear)));

  const guts: Record<string, number> = {};
  let j = 0;
  order.forEach((key, i) => {
    const anchor = byPos.get(i);
    if (anchor && anchor.source !== 'preset') {
      guts[key] = Math.round(clamp(anchor.rating, 1, 10) * 10) / 10;
      return;
    }
    while (j < points.length - 1 && points[j + 1][0] <= i) j++;
    let pct: number;
    if (i <= points[0][0]) pct = fitted[0];
    else if (i >= points[points.length - 1][0]) pct = fitted[points.length - 1];
    else {
      const [p0, p1] = [points[j][0], points[j + 1][0]];
      const t = (i - p0) / (p1 - p0);
      pct = fitted[j] + t * (fitted[j + 1] - fitted[j]);
    }
    guts[key] = pctToSpectrumRating(pct / 100, linear);
  });
  return guts;
}

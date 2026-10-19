import type { RestaurantEntry } from '../types';
import { ratingToBaseElo, recomputeMagicScores } from '../lib/rankingEngine';

export interface SampleSpot {
  name: string;
  gut: number;
  cuisines?: string[];
  elo?: number;
}

/** Turns illustrative spots (already in rank order) into scored entries via the real engine */
export function buildList(spots: SampleSpot[], prefix = 's'): RestaurantEntry[] {
  return recomputeMagicScores(
    spots.map((s, i) => ({
      id: `${prefix}${i}`,
      placeId: `demo_${s.name}`,
      name: s.name,
      formattedAddress: '',
      category: 'restaurants',
      categories: ['restaurants'],
      cuisines: s.cuisines ?? [],
      initialRating: s.gut,
      elo: s.elo ?? ratingToBaseElo(s.gut),
      rankIndex: i,
      magicScore: s.gut,
      comparisonsCount: 0,
      createdAt: 0,
      updatedAt: 0,
    }))
  );
}

export const fmt = (n: number, digits = 1) => n.toFixed(digits);

/** Entries with fixed displayed scores (for friend/taste demos, where scores come from someone's list) */
export function scoredEntries(spots: Array<{ name: string; score: number }>, prefix: string): RestaurantEntry[] {
  return spots.map((s, i) => ({
    id: `${prefix}${i}`,
    placeId: `demo_${s.name}`,
    name: s.name,
    formattedAddress: '',
    category: 'restaurants',
    categories: ['restaurants'],
    cuisines: [],
    initialRating: s.score,
    elo: ratingToBaseElo(s.score),
    rankIndex: i,
    magicScore: s.score,
    comparisonsCount: 0,
    createdAt: 0,
    updatedAt: 0,
  }));
}

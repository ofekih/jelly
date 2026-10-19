import type { SpotGroup } from '../types';

/**
 * The gut-feeling spectrum: 5 tiers, each split into 4 labelled bands.
 *
 * Label rules (see AGENTS.md): the head (before "·") climbs strictly; the tail never sounds
 * weaker than the band below, fits every group, and is never a near-synonym of a neighbour.
 * `travel` replaces the tail where it doesn't fit a trip.
 */
interface VibeBand {
  from: number;
  head: string;
  tail: string;
  travel?: string;
}

export interface RatingTier {
  name: string;
  /** Lowest rating in the tier; tiers fill equal fifths of the non-linear spectrum */
  from: number;
  /** Rating picked when the tier's name under the spectrum is tapped */
  zoneRating: number;
  thumbColor: string;
  pillClass: string;
  zoneClass: string;
  bands: VibeBand[];
}

export const RATING_TIERS: RatingTier[] = [
  {
    name: 'Skip',
    from: 1.0,
    zoneRating: 2.5,
    thumbColor: '#f43f5e',
    pillClass:
      'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/70',
    zoneClass: 'text-rose-500 dark:text-rose-400',
    bands: [
      { from: 1.0, head: 'Disaster', tail: 'Avoid at all costs' },
      { from: 1.8, head: 'Terrible', tail: 'Steer clear', travel: 'Regretted the trip' },
      { from: 2.5, head: 'Bad', tail: 'Not worth going' },
      { from: 3.3, head: 'Subpar', tail: 'Probably skip it' },
    ],
  },
  {
    name: 'Mid',
    from: 4.0,
    zoneRating: 5.0,
    thumbColor: '#f59e0b',
    pillClass:
      'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70',
    zoneClass: 'text-amber-600 dark:text-amber-400',
    bands: [
      { from: 4.0, head: 'Underwhelming', tail: 'Only if there’s no other option' },
      { from: 4.5, head: 'Meh', tail: 'Only if someone else picks it', travel: 'Only if someone else plans it' },
      { from: 5.0, head: 'Passable', tail: 'Fine if it’s convenient', travel: 'Fine to pass through' },
      { from: 5.5, head: 'Decent', tail: 'Solid for what it is' },
    ],
  },
  {
    name: 'Good',
    from: 6.0,
    zoneRating: 6.8,
    thumbColor: '#06b6d4',
    pillClass:
      'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800/70',
    zoneClass: 'text-cyan-600 dark:text-cyan-400',
    bands: [
      { from: 6.0, head: 'Pleasant', tail: 'Glad I went' },
      { from: 6.4, head: 'Good', tail: 'Worth checking out' },
      { from: 6.8, head: 'Very good', tail: 'Well worth it' },
      { from: 7.2, head: 'Really liked it', tail: 'Easy to recommend' },
    ],
  },
  {
    name: 'Great',
    from: 7.5,
    zoneRating: 8.2,
    thumbColor: '#14b8a6',
    pillClass:
      'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800/70',
    zoneClass: 'text-teal-600 dark:text-teal-400',
    bands: [
      { from: 7.5, head: 'Great', tail: 'A real standout' },
      { from: 7.8, head: 'Really great', tail: 'Worth going out of your way', travel: 'Worth the journey' },
      { from: 8.2, head: 'Loved it', tail: 'Would rave about it' },
      { from: 8.5, head: 'Really loved it', tail: 'Still thinking about it', travel: 'Bucket-list worthy' },
    ],
  },
  {
    name: 'Incredible',
    from: 8.8,
    zoneRating: 9.4,
    thumbColor: '#059669',
    pillClass:
      'bg-jade-100/90 text-jade-800 border-jade-300 dark:bg-jade-900/70 dark:text-jade-200 dark:border-jade-700',
    zoneClass: 'text-jade-600 dark:text-jade-400',
    bands: [
      { from: 8.8, head: 'Incredible', tail: 'One of my favorites' },
      { from: 9.1, head: 'Unforgettable', tail: 'An all-time favorite' },
      { from: 9.5, head: 'Near-perfect', tail: 'Almost nothing to critique' },
      { from: 9.8, head: 'Flawless', tail: 'Literally nothing could be improved' },
    ],
  },
];

/** Last entry in `items` whose `from` is at or below `rating` (items are ascending) */
function lastFrom<T extends { from: number }>(items: T[], rating: number): T {
  return items.reduce((found, item) => (rating >= item.from ? item : found), items[0]);
}

export function getRatingTier(rating: number): RatingTier {
  return lastFrom(RATING_TIERS, rating);
}

export function getVibeLabel(rating: number, group: SpotGroup): string {
  const band = lastFrom(getRatingTier(rating).bands, rating);
  const tail = (group === 'travel' && band.travel) || band.tail;
  return `${band.head} · ${tail}`;
}

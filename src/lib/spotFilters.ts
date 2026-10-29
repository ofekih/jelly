import { MediaInfo, SpotCategory } from '../types';
import { getItemDistanceMiles, UserCoordinates } from './geo';
import { comparablePrice } from './itemPrices';
import { fitsPlayers, fitsTime } from './media';
import type { ItemPrice } from '../types';

/** What every list view (ranked, want to try, for you) can be narrowed by. */
export interface SpotFilters {
  category: SpotCategory;
  city: string | 'ALL';
  cuisine: string | 'ALL';
  /** Board games only: who's playing and how long you have */
  players: number | 'ALL';
  maxMinutes: number | 'ALL';
  /** Lists whose titles have prices: dollars, from the shared `prices` docs */
  maxPrice: number | 'ALL';
  query: string;
}

/** The lists whose titles have prices to filter by */
export const hasPriceFilter = (category: SpotCategory): boolean =>
  category === 'board_games' || category === 'video_games' || category === 'fiction' || category === 'nonfiction';

/** A title's price: undefined while loading, null when unknown (see `usePrices`) */
export type PriceLookup = (placeId: string | undefined) => ItemPrice | null | undefined;

interface FilterableSpot {
  placeId?: string;
  name: string;
  formattedAddress: string;
  city?: string;
  category: SpotCategory;
  cuisines: string[];
  media?: MediaInfo;
}

export function fitsGameNight(
  media: MediaInfo | undefined,
  { category, players, maxMinutes }: Pick<SpotFilters, 'category' | 'players' | 'maxMinutes'>
): boolean {
  return (
    category !== 'board_games' ||
    ((players === 'ALL' || fitsPlayers(media, players)) &&
      (maxMinutes === 'ALL' || fitsTime(media, maxMinutes)))
  );
}

/** Over the budget? Titles with no known price stay (nothing says they're too dear). */
export function fitsBudget(placeId: string | undefined, maxPrice: number | 'ALL', priceOf?: PriceLookup): boolean {
  if (maxPrice === 'ALL' || !priceOf) return true;
  const price = comparablePrice(priceOf(placeId));
  return price === undefined || price <= maxPrice;
}

export function matchesSpotFilters(spot: FilterableSpot, filters: SpotFilters, priceOf?: PriceLookup): boolean {
  if (spot.category !== filters.category) return false;
  if (filters.city !== 'ALL' && spot.city !== filters.city) return false;
  if (filters.cuisine !== 'ALL' && !spot.cuisines.includes(filters.cuisine)) return false;
  if (!fitsGameNight(spot.media, filters)) return false;
  if (hasPriceFilter(filters.category) && !fitsBudget(spot.placeId, filters.maxPrice, priceOf)) return false;
  const q = filters.query.trim().toLowerCase();
  if (q) {
    const hay = `${spot.name} ${spot.formattedAddress} ${spot.city || ''} ${spot.cuisines.join(' ')}`;
    if (!hay.toLowerCase().includes(q)) return false;
  }
  return true;
}

/** Any filter beyond the open list itself is active. */
export function isFilterActive(filters: SpotFilters): boolean {
  return (
    filters.city !== 'ALL' ||
    filters.cuisine !== 'ALL' ||
    (filters.category === 'board_games' && (filters.players !== 'ALL' || filters.maxMinutes !== 'ALL')) ||
    (hasPriceFilter(filters.category) && filters.maxPrice !== 'ALL') ||
    filters.query.trim().length > 0
  );
}

/** Nearest first; spots without coordinates go last, ties keep `tiebreak` order. */
export function sortByDistance<T extends { lat?: number; lng?: number; city?: string; formattedAddress?: string }>(
  items: readonly T[],
  location: UserCoordinates,
  tiebreak: (a: T, b: T) => number = () => 0
): T[] {
  const distance = new Map(items.map((item) => [item, getItemDistanceMiles(item, location)]));
  return [...items].sort((a, b) => {
    const da = distance.get(a) ?? null;
    const db = distance.get(b) ?? null;
    if (da === null && db === null) return tiebreak(a, b);
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
}

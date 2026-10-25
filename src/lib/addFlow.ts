import {
  CATEGORY_GROUP,
  GROUP_CATEGORIES,
  PlaceCandidate,
  RestaurantEntry,
  SpotCategory,
  SpotGroup,
} from '../types';
import { isMediaPlaceId } from './tasteModel';

/**
 * Groups whose lists search different sources or place types, so the search page offers a
 * choice: Play's board games (BGG) and video games (IGDB), Travel's destinations and hotels.
 * Every other group searches all its lists at once.
 */
export const SEARCH_SCOPES: Partial<Record<SpotGroup, Array<{ label: string; categories: SpotCategory[] }>>> = {
  travel: [
    { label: 'Destinations', categories: ['cities', 'getaways', 'countries'] },
    { label: 'Hotels & Stays', categories: ['stays'] },
  ],
  play: [
    { label: 'Tabletop', categories: ['board_games'] },
    { label: 'Video games', categories: ['video_games'] },
  ],
};

/** The list a search in `group` starts from: the one being viewed if it's in that group. */
export function searchCategoryFor(group: SpotGroup, viewing: SpotCategory): SpotCategory {
  return CATEGORY_GROUP[viewing] === group ? viewing : GROUP_CATEGORIES[group][0];
}

/** Whether `entry` is the same spot as `candidate` (titles match by ID; places by ID or name + address). */
export function isSameCandidate(
  candidate: Pick<PlaceCandidate, 'placeId' | 'name' | 'formattedAddress'>,
  entry: Pick<RestaurantEntry, 'placeId' | 'name' | 'formattedAddress'>
): boolean {
  if (entry.placeId && candidate.placeId && entry.placeId === candidate.placeId) return true;
  return (
    !isMediaPlaceId(candidate.placeId) &&
    entry.name.toLowerCase() === candidate.name.toLowerCase() &&
    entry.formattedAddress === candidate.formattedAddress
  );
}

export function findExistingInCategory(
  candidate: PlaceCandidate,
  category: SpotCategory,
  restaurants: RestaurantEntry[]
): RestaurantEntry | undefined {
  return restaurants.find((r) => r.category === category && isSameCandidate(candidate, r));
}

/**
 * Lists to offer for a candidate searched from `searchCategory`: its auto-detected categories in that
 * group, plus the searched list (TMDB knows for sure whether a title is a movie or a show; BGG and
 * IGDB only find their own list; Travel's types are reliable).
 */
export function categoryOptions(candidate: PlaceCandidate, searchCategory: SpotCategory): SpotCategory[] {
  const group = CATEGORY_GROUP[searchCategory];
  const detected = (candidate.categories || []).filter((c) => CATEGORY_GROUP[c] === group);
  if ((['tmdb', 'bgg', 'igdb'].includes(candidate.source) || group === 'travel') && detected.length > 0) {
    return detected;
  }
  return Array.from(new Set([...detected, searchCategory]));
}

/**
 * Your entry for this candidate somewhere in the group, if any: the one in its best-guess list
 * first, else your highest-scored one.
 */
export function findRankedInGroup(
  candidate: PlaceCandidate,
  searchCategory: SpotCategory,
  restaurants: RestaurantEntry[]
): RestaurantEntry | undefined {
  const group = CATEGORY_GROUP[searchCategory];
  const matches = restaurants.filter((r) => CATEGORY_GROUP[r.category] === group && isSameCandidate(candidate, r));
  if (matches.length <= 1) return matches[0];
  const best = categoryOptions(candidate, searchCategory)[0];
  return matches.find((r) => r.category === best) ?? [...matches].sort((a, b) => b.magicScore - a.magicScore)[0];
}

/** A list entry (yours, a friend's, a bookmark) as a candidate for the place page or the rating flow. */
export function entryToCandidate(
  entry: Omit<PlaceCandidate, 'categories' | 'source' | 'placeId'> & {
    id?: string;
    placeId?: string;
    category: SpotCategory;
    categories?: SpotCategory[];
  }
): PlaceCandidate {
  const placeId = entry.placeId || entry.id || '';
  return {
    placeId,
    name: entry.name,
    formattedAddress: entry.formattedAddress,
    neighborhood: entry.neighborhood,
    city: entry.city,
    lat: entry.lat,
    lng: entry.lng,
    googleMapsUri: entry.googleMapsUri,
    priceLevel: entry.priceLevel,
    priceRange: entry.priceRange,
    // Its own list first
    categories: Array.from(new Set([entry.category, ...(entry.categories || [])])),
    cuisines: entry.cuisines || [],
    primaryTypeDisplay: entry.primaryTypeDisplay,
    media: entry.media,
    source: isMediaPlaceId(placeId) ? 'tmdb' : 'google_places',
  };
}

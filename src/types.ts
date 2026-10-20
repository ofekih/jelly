/**
 * Each category is its own completely separate ranked list: spots are only ever
 * compared against (and ranked within) spots of the same category.
 * The string values are persisted in Firestore and used in entry IDs.
 */
export type SpotCategory =
  // Eat
  | 'restaurants'
  | 'brunch'
  | 'dessert'
  | 'bakeries'
  | 'coffee_tea'
  | 'bars'
  // Explore
  | 'museums'
  | 'theme_parks'
  | 'zoos'
  | 'nature'
  // Travel
  | 'cities'
  | 'getaways'
  | 'countries';

/** Top-level groups of lists (Eat · Explore · Travel); only one group's lists are shown at a time. */
export type SpotGroup = 'eat' | 'explore' | 'travel';

export const ALL_GROUPS: SpotGroup[] = ['eat', 'explore', 'travel'];

export const GROUP_CATEGORIES: Record<SpotGroup, SpotCategory[]> = {
  eat: ['restaurants', 'brunch', 'dessert', 'bakeries', 'coffee_tea', 'bars'],
  explore: ['museums', 'theme_parks', 'zoos', 'nature'],
  travel: ['cities', 'getaways', 'countries'],
};

export const ALL_CATEGORIES: SpotCategory[] = ALL_GROUPS.flatMap((g) => GROUP_CATEGORIES[g]);

export const CATEGORY_GROUP = Object.fromEntries(
  ALL_GROUPS.flatMap((g) => GROUP_CATEGORIES[g].map((c) => [c, g]))
) as Record<SpotCategory, SpotGroup>;

export const DEFAULT_CATEGORY: SpotCategory = 'restaurants';

export const GROUP_LABEL: Record<SpotGroup, string> = {
  eat: 'Eat',
  explore: 'Explore',
  travel: 'Travel',
};

export const GROUP_EMOJI: Record<SpotGroup, string> = {
  eat: '🍽️',
  explore: '🧭',
  travel: '✈️',
};

export const CATEGORY_LABEL: Record<SpotCategory, string> = {
  restaurants: 'Restaurants',
  brunch: 'Brunch',
  dessert: 'Dessert',
  bakeries: 'Bakeries',
  coffee_tea: 'Coffee & Tea',
  bars: 'Bars',
  museums: 'Museums & Galleries',
  theme_parks: 'Theme Parks',
  zoos: 'Zoos & Aquariums',
  nature: 'Parks & Nature',
  cities: 'Cities',
  getaways: 'Getaways',
  countries: 'Countries',
};

export const CATEGORY_EMOJI: Record<SpotCategory, string> = {
  restaurants: '🍽️',
  brunch: '🥞',
  dessert: '🍦',
  bakeries: '🥐',
  coffee_tea: '☕',
  bars: '🍸',
  museums: '🏛️',
  theme_parks: '🎢',
  zoos: '🦁',
  nature: '🌲',
  cities: '🏙️',
  getaways: '🏝️',
  countries: '🌍',
};

export function isSpotCategory(raw: unknown): raw is SpotCategory {
  return typeof raw === 'string' && (ALL_CATEGORIES as string[]).includes(raw);
}

export const COMMON_CUISINES: string[] = [
  'Italian',
  'Japanese',
  'Sushi',
  'Ramen',
  'Mexican',
  'American',
  'Chinese',
  'Thai',
  'French',
  'Mediterranean',
  'Indian',
  'Korean',
  'Vietnamese',
  'Middle Eastern',
  'Spanish',
  'Greek',
  'Pizza',
  'Seafood',
  'Steakhouse',
  'Burgers',
  'BBQ',
  'Bakery',
  'Cafe',
  'Wine Bar',
  'Cocktail Bar',
];

export interface RankedHistoryEvent {
  timestamp: number;
  initialRating: number;
  magicScore?: number;
}

/** One side-by-side answer (or drag / order check), stored on one of the two entries */
export interface StoredComparison {
  opponentId: string; // Entry id of the other spot (same category list)
  result: 0 | 0.5 | 1; // This entry's result against it: 1 = preferred, 0.5 = too close to call
  at: number; // When it was answered; answers older than either spot's last (re-)rank are ignored
}

export interface RestaurantEntry {
  id: string; // Unique per (placeId + category)
  placeId?: string;
  name: string;
  formattedAddress: string;
  neighborhood?: string;
  city?: string;
  lat?: number;
  lng?: number;
  googleMapsUri?: string;
  priceLevel?: number; // 1 ($) to 4 ($$$$)

  // Each listing belongs to exactly ONE category list (the same place can appear in several lists
  // as separate, independently ranked entries)
  category: SpotCategory;
  categories: SpotCategory[]; // Auto-detected categories this venue could fit
  cuisines: string[];
  primaryTypeDisplay?: string;

  // ELO + Rating & Ranking
  initialRating: number; // Integer 1 to 10 gut rating from Q1
  elo: number; // Canonical ELO rating driving the ranking order
  rankIndex: number; // 0 = #1 ranked spot within its category list
  magicScore: number; // 1.0 to 10.0 displayed score derived from ELO + loosely calibrated by 1-10 ratings
  comparisonsCount: number;

  // Optional hidden metadata (only shown if user opens the detail/edit drawer)
  notes?: string;
  favoriteDishes?: string;
  rankedHistory?: RankedHistoryEvent[];
  comparisons?: StoredComparison[]; // Private: never copied into shared lists
  createdAt: number;
  updatedAt: number;
}

export interface PlaceCandidate {
  placeId: string;
  name: string;
  formattedAddress: string;
  neighborhood?: string;
  city?: string;
  lat?: number;
  lng?: number;
  googleMapsUri?: string;
  priceLevel?: number;
  categories: SpotCategory[]; // Auto-detected categories, best match first
  cuisines: string[]; // Auto-detected cuisines
  primaryTypeDisplay?: string;
  source: 'google_places' | 'osm_photon' | 'manual';
}

export interface BookmarkEntry {
  id: string;
  placeId?: string;
  name: string;
  formattedAddress: string;
  neighborhood?: string;
  city?: string;
  lat?: number;
  lng?: number;
  googleMapsUri?: string;
  priceLevel?: number;
  category: SpotCategory;
  categories: SpotCategory[];
  cuisines: string[];
  primaryTypeDisplay?: string;
  notes?: string;
  recommendedBy?: string; // e.g. "Sarah (9.4)"
  recommendedByUid?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SharedListPayload {
  id: string;
  ownerUid: string;
  ownerName: string;
  displayName?: string;
  handle?: string;
  photoURL?: string;
  title?: string;
  followingIds?: string[];
  restaurants: RestaurantEntry[];
  bookmarks?: BookmarkEntry[];
  /** Number of ranked spots, when known without the spots themselves (profiles) */
  rankedCount?: number;
  /** Built from `profiles/{uid}`: carries no spots; load `sharedLists/{uid}` to show the list */
  profileOnly?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FriendProfile {
  uid: string; // matches sharedLists/{uid} doc ID
  name: string;
  handle?: string;
  photoURL?: string;
  shareId?: string;
  addedAt: number;
}

export interface FriendSpotMatch {
  friendUid: string;
  friendName: string;
  friendPhotoURL?: string;
  status: 'ranked' | 'want_to_try';
  magicScore?: number;
  rankIndex?: number;
  category: SpotCategory;
  notes?: string;
  favoriteDishes?: string;
}



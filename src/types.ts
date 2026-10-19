/**
 * Each category is its own completely separate ranked list: spots are only ever
 * compared against (and ranked within) spots of the same category.
 * The string values are persisted in Firestore and used in entry IDs.
 */
export type SpotCategory =
  | 'restaurants'
  | 'brunch'
  | 'dessert'
  | 'bakeries'
  | 'coffee_tea'
  | 'bars';

export const ALL_CATEGORIES: SpotCategory[] = [
  'restaurants',
  'brunch',
  'dessert',
  'bakeries',
  'coffee_tea',
  'bars',
];

export const DEFAULT_CATEGORY: SpotCategory = 'restaurants';

export const CATEGORY_LABEL: Record<SpotCategory, string> = {
  restaurants: 'Restaurants',
  brunch: 'Brunch',
  dessert: 'Dessert',
  bakeries: 'Bakeries',
  coffee_tea: 'Coffee & Tea',
  bars: 'Bars',
};

export const CATEGORY_EMOJI: Record<SpotCategory, string> = {
  restaurants: '🍽️',
  brunch: '🥞',
  dessert: '🍦',
  bakeries: '🥐',
  coffee_tea: '☕',
  bars: '🍸',
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



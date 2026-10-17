export type MealCategory =
  | 'Breakfast'
  | 'Lunch'
  | 'Dinner'
  | 'Coffee'
  | 'Dessert'
  | 'Drinks';

export const ALL_MEAL_CATEGORIES: MealCategory[] = [
  'Dinner',
  'Lunch',
  'Breakfast',
  'Coffee',
  'Dessert',
  'Drinks',
];

export const MEAL_EMOJI: Record<MealCategory, string> = {
  Dinner: '🍽️',
  Lunch: '🥪',
  Breakfast: '🥐',
  Coffee: '☕',
  Dessert: '🍦',
  Drinks: '🍸',
};

export function normalizeMealCategory(raw?: string): MealCategory {
  if (!raw) return 'Dinner';
  const lower = raw.toLowerCase();
  if (lower.includes('breakfast') || lower.includes('brunch')) return 'Breakfast';
  if (lower.includes('lunch')) return 'Lunch';
  if (lower.includes('coffee') || lower.includes('cafe') || lower.includes('tea')) return 'Coffee';
  if (lower.includes('dessert') || lower.includes('bakery') || lower.includes('ice cream'))
    return 'Dessert';
  if (lower.includes('drink') || lower.includes('bar') || lower.includes('wine')) return 'Drinks';
  return 'Dinner';
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
  id: string; // Unique per (placeId + meal)
  placeId?: string;
  name: string;
  formattedAddress: string;
  neighborhood?: string;
  city?: string;
  lat?: number;
  lng?: number;
  googleMapsUri?: string;
  priceLevel?: number; // 1 ($) to 4 ($$$$)

  // Each listing is for ONE specific meal of the day (same restaurant can appear for different meals)
  meal: MealCategory;
  meals: MealCategory[]; // Potential meals this venue serves (for Firestore backwards-compat & edit)
  cuisines: string[];
  primaryTypeDisplay?: string;

  // ELO + Rating & Ranking
  initialRating: number; // Integer 1 to 10 gut rating from Q1
  elo: number; // Canonical ELO rating driving the ranking order
  rankIndex: number; // 0 = #1 ranked spot
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
  meals: MealCategory[]; // Auto-detected meals this place works for
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
  meal: MealCategory;
  meals: MealCategory[];
  cuisines: string[];
  primaryTypeDisplay?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SharedListPayload {
  id: string;
  ownerUid: string;
  ownerName: string;
  title?: string;
  restaurants: RestaurantEntry[];
  bookmarks?: BookmarkEntry[];
  createdAt: number;
  updatedAt: number;
}


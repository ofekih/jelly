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
  | 'countries'
  | 'stays'
  // Watch
  | 'movies'
  | 'tv_shows'
  // Read
  | 'fiction'
  | 'nonfiction'
  // Play
  | 'board_games'
  | 'video_games';

/** Top-level groups of lists (Eat · Explore · Travel · Watch · Read · Play); only one group's lists are shown at a time. */
export type SpotGroup = 'eat' | 'explore' | 'travel' | 'watch' | 'read' | 'play';

export const ALL_GROUPS: SpotGroup[] = ['eat', 'explore', 'travel', 'watch', 'read', 'play'];

export const GROUP_CATEGORIES: Record<SpotGroup, SpotCategory[]> = {
  eat: ['restaurants', 'brunch', 'dessert', 'bakeries', 'coffee_tea', 'bars'],
  explore: ['museums', 'theme_parks', 'zoos', 'nature'],
  travel: ['cities', 'getaways', 'countries', 'stays'],
  watch: ['movies', 'tv_shows'],
  read: ['fiction', 'nonfiction'],
  play: ['board_games', 'video_games'],
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
  watch: 'Watch',
  read: 'Read',
  play: 'Play',
};

export const GROUP_EMOJI: Record<SpotGroup, string> = {
  eat: '🍽️',
  explore: '🧭',
  travel: '✈️',
  watch: '🍿',
  read: '📚',
  play: '🎲',
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
  stays: 'Hotels & Stays',
  movies: 'Movies',
  tv_shows: 'TV Shows',
  fiction: 'Fiction',
  nonfiction: 'Nonfiction',
  board_games: 'Tabletop Games',
  video_games: 'Video Games',
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
  stays: '🏨',
  movies: '🎬',
  tv_shows: '📺',
  fiction: '🐉',
  nonfiction: '🧠',
  board_games: '♟️',
  video_games: '🎮',
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

/**
 * What a title (movie, show, book or game) carries instead of an address. Its `placeId` is
 * `tmdb:movie:<id>` / `tmdb:tv:<id>` / `book:<author>:<title>` / `bgg:<id>` / `igdb:<id>`, and
 * `formattedAddress` holds its short "2021 · Director" line.
 */
export interface MediaInfo {
  year?: number;
  poster?: string; // TMDB image path ("/abc.jpg") or a full https cover URL
  creator?: string; // Director(s), creator(s), author(s), designer(s) or developer(s)
  // Board & card games (from BGG)
  players?: number[]; // [min, max]
  best?: number[]; // [min, max] player count the community votes best
  time?: number[]; // [min, max] minutes
  weight?: number; // Complexity, 1 (light) to 5 (heavy)
}

/** A movie or show as the `/api/tmdb/search` proxy returns it (see `functions/src/tmdb.ts`). */
export interface TmdbTitle {
  kind: 'movie' | 'tv';
  id: number;
  title: string;
  year?: number;
  poster?: string;
  creator?: string;
  genres: string[]; // Watch tags (`GROUP_COPY.watch.tagOptions`)
}

/** A book as the `/api/books/search` proxy returns it (see `functions/src/books.ts`). */
export interface BookResult {
  placeId: string; // `book:<author>:<title>`, the same for every edition
  title: string;
  year?: number; // Earliest edition found, often a reprint: not shown
  cover?: string;
  creator?: string;
  list?: 'fiction' | 'nonfiction';
  tags: string[]; // Read tags (`GROUP_COPY.read.tagOptions`)
}

/** A game as the `/api/bgg/search` and `/api/igdb/search` proxies return it (`functions/src/games.ts`). */
export interface GameResult {
  placeId: string; // `bgg:<id>` or `igdb:<id>`
  title: string;
  year?: number;
  cover?: string;
  creator?: string;
  tags: string[]; // Play tags (`GROUP_COPY.play.tagOptions`)
  players?: number[];
  best?: number[];
  time?: number[];
  weight?: number;
}

/**
 * Typical spend per person from Google Places (`priceRange`): `start` inclusive, `end` exclusive and
 * missing for "100+"; whole units of `currency` (ISO 4217). Formatting lives in `lib/price.ts`.
 */
export interface PriceRange {
  currency: string;
  start?: number;
  end?: number;
}

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
  priceLevel?: number; // 0 (free), 1 ($) to 4 ($$$$)
  priceRange?: PriceRange; // Only alongside the tier it came with (see mergePrice)

  // Each listing belongs to exactly ONE category list (the same place can appear in several lists
  // as separate, independently ranked entries)
  category: SpotCategory;
  categories: SpotCategory[]; // Auto-detected categories this venue could fit
  cuisines: string[];
  primaryTypeDisplay?: string;
  media?: MediaInfo;

  // Rating & Ranking
  initialRating: number; // Integer 1 to 10 gut rating from Q1
  rankIndex: number; // 0 = #1 ranked spot within its category list
  magicScore: number; // 1.0 to 10.0 displayed score: the gut ratings fitted to the order (recomputeMagicScores)
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
  priceRange?: PriceRange;
  categories: SpotCategory[]; // Auto-detected categories, best match first
  cuisines: string[]; // Auto-detected cuisines
  primaryTypeDisplay?: string;
  media?: MediaInfo;
  source: 'google_places' | 'osm_photon' | 'manual' | 'tmdb' | 'google_books' | 'bgg' | 'igdb';
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
  priceRange?: PriceRange;
  category: SpotCategory;
  categories: SpotCategory[];
  cuisines: string[];
  primaryTypeDisplay?: string;
  media?: MediaInfo;
  notes?: string;
  recommendedBy?: string; // e.g. "Sarah (9.4)"
  recommendedByUid?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * What the "For you" list shows for a predicted spot, stored next to each prediction in
 * `users/{uid}/private/predictions` (kept small: the doc holds up to `MAX_PREDICTIONS` of them).
 */
export interface PredictionPlace {
  name: string;
  city?: string;
  neighborhood?: string;
  lat?: number;
  lng?: number;
  cuisines?: string[];
  media?: MediaInfo;
  priceLevel?: number;
  priceRange?: PriceRange;
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



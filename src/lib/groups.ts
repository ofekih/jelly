import { CATEGORY_GROUP, COMMON_CUISINES, SpotCategory, SpotGroup } from '../types';
import { formatPrice, type PriceInfo } from './price';

interface GroupCopy {
  together: string; // "Eat Together"
  want: string; // Bookmarked list: "Want to Try" / "Want to Go"
  togetherHint: string;
  searchPlaceholder: string;
  searchEmptyHint: string;
  tagLabel: string; // What `cuisines` means in this group
  tagOptions: string[];
  notePlaceholder: string;
  noteAddPrompt: string;
  showPrice: boolean;
  hasLocation: boolean; // Places (map, distances, cities); titles have none
  notYet: string; // Offered next to the rating line: save it instead
  done: string; // "Been here", "Watched it": ranking a saved spot
}

export const GROUP_COPY: Record<SpotGroup, GroupCopy> = {
  eat: {
    together: 'Eat Together',
    want: 'Want to Try',
    togetherHint: 'Blend your list with friends to decide where to eat together',
    searchPlaceholder: 'Search any restaurant, cafe, or bar...',
    searchEmptyHint: 'Type a restaurant name to rate & rank it, or tap the bookmark icon to save for later.',
    tagLabel: 'Cuisine',
    tagOptions: COMMON_CUISINES,
    notePlaceholder: 'What did you order? What stood out? Would you come back?',
    noteAddPrompt: 'Add a note (favorite dishes, thoughts...)',
    showPrice: true,
    hasLocation: true,
    notYet: 'Haven’t been yet?',
    done: 'Been here',
  },
  explore: {
    together: 'Visit Together',
    want: 'Want to Go',
    togetherHint: 'Blend your list with friends to decide where to go together',
    searchPlaceholder: 'Search any museum, park, zoo, or sight...',
    searchEmptyHint: 'Type a place name to rate & rank it, or tap the bookmark icon to save for later.',
    tagLabel: 'Type',
    tagOptions: [
      'Art',
      'Gallery',
      'Science',
      'History',
      'Natural History',
      'Kids',
      'Theme Park',
      'Water Park',
      'Zoo',
      'Aquarium',
      'Wildlife Park',
      'National Park',
      'State Park',
      'Garden',
      'Hike',
      'Beach',
    ],
    notePlaceholder: 'Favorite exhibits, rides, trails, tips, or notes...',
    noteAddPrompt: 'Add a note (highlights, tips...)',
    showPrice: true,
    hasLocation: true,
    notYet: 'Haven’t been yet?',
    done: 'Been here',
  },
  travel: {
    together: 'Travel Together',
    want: 'Want to Go',
    togetherHint: 'Blend your list with friends to decide where to travel together',
    searchPlaceholder: 'Search any city, town, island, or country...',
    searchEmptyHint: 'Type a city, town, or country to rate & rank it, or tap the bookmark icon to save for later.',
    tagLabel: 'Vibe',
    tagOptions: [
      'Beach',
      'Mountains',
      'Nature',
      'Culture',
      'History',
      'Food',
      'Nightlife',
      'Shopping',
      'Romantic',
      'Family',
      'Adventure',
      'Relaxing',
      // Hotels & Stays
      'Hotel',
      'Resort',
      'B&B',
      'Inn',
      'Hostel',
      'Cabin',
      'Camping',
    ],
    notePlaceholder: 'Highlights, where you stayed, tips, or notes...',
    noteAddPrompt: 'Add a note (highlights, tips...)',
    showPrice: false,
    hasLocation: true,
    notYet: 'Haven’t been yet?',
    done: 'Been here',
  },
  watch: {
    together: 'Watch Together',
    want: 'Want to Watch',
    togetherHint: 'Blend your list with friends to decide what to watch together',
    searchPlaceholder: 'Search any movie or TV show...',
    searchEmptyHint: 'Type a title to rate & rank it, or tap the bookmark icon to save for later.',
    tagLabel: 'Genre',
    // Must match the tags `functions/src/tmdb.ts` derives from TMDB genres
    tagOptions: [
      'Action',
      'Adventure',
      'Animation',
      'Comedy',
      'Crime',
      'Documentary',
      'Drama',
      'Family',
      'Fantasy',
      'History',
      'Horror',
      'Music',
      'Mystery',
      'Romance',
      'Sci-Fi',
      'Thriller',
      'War',
      'Western',
      'Reality',
    ],
    notePlaceholder: 'What stood out? Favorite scenes, who you watched it with...',
    noteAddPrompt: 'Add a note (favorite scenes, thoughts...)',
    showPrice: false,
    hasLocation: false,
    notYet: 'Haven’t watched it yet?',
    done: 'Watched it',
  },
  read: {
    together: 'Read Together',
    want: 'Want to Read',
    togetherHint: 'Blend your list with friends to pick a book to read together',
    searchPlaceholder: 'Search any book or author...',
    searchEmptyHint: 'Type a title or author to rate & rank a book, or tap the bookmark icon to save for later.',
    tagLabel: 'Genre',
    // Must match the tags `functions/src/books.ts` derives from Google Books categories
    tagOptions: [
      'Fantasy',
      'Sci-Fi',
      'Mystery',
      'Thriller',
      'Romance',
      'Horror',
      'Historical',
      'Literary',
      'Classics',
      'Young Adult',
      'Kids',
      'Graphic Novel',
      'Poetry',
      'Biography',
      'History',
      'Science',
      'Business',
      'Self-Help',
      'Psychology',
      'Philosophy',
      'Politics',
      'Religion',
      'True Crime',
      'Travel',
      'Food',
    ],
    notePlaceholder: 'What stayed with you? Favorite quotes, characters, who should read it...',
    noteAddPrompt: 'Add a note (favorite quotes, thoughts...)',
    showPrice: false,
    hasLocation: false,
    notYet: 'Haven’t read it yet?',
    done: 'Read it',
  },
  play: {
    together: 'Play Together',
    want: 'Want to Play',
    togetherHint: 'Blend your list with friends to pick what to play together',
    searchPlaceholder: 'Search any game...',
    searchEmptyHint: 'Type a game’s name to rate & rank it, or tap the bookmark icon to save for later.',
    tagLabel: 'Type',
    // Must match the tags `functions/src/games.ts` derives from BGG and IGDB
    tagOptions: [
      // Board & card games
      'Strategy',
      'Family',
      'Party',
      'Thematic',
      'Abstract',
      'Wargame',
      'Kids',
      'Card Game',
      'Dexterity',
      'Deduction',
      'Word',
      'Co-op',
      'Solo',
      'Deck Building',
      'Worker Placement',
      'Legacy',
      // Video games
      'RPG',
      'Action',
      'Adventure',
      'Shooter',
      'Platformer',
      'Puzzle',
      'Racing',
      'Sports',
      'Fighting',
      'Simulation',
      'Indie',
      'Horror',
      'Open World',
      'Multiplayer',
    ],
    notePlaceholder: 'What made it fun? Who you played with, house rules, favorite moments...',
    noteAddPrompt: 'Add a note (who you played with, thoughts...)',
    showPrice: false,
    hasLocation: false,
    notYet: 'Haven’t played it yet?',
    done: 'Played it',
  },
};

/** What the search box asks for in a list (Play searches board and video games separately) */
export function searchPlaceholder(category: SpotCategory): string {
  if (category === 'board_games') return 'Search any board, card or party game...';
  if (category === 'video_games') return 'Search any video game...';
  if (category === 'stays') return 'Search any hotel, resort, or place to stay...';
  return GROUP_COPY[CATEGORY_GROUP[category]].searchPlaceholder;
}

/** Whether a category's spots are places (with a map, distances and cities) */
export function hasLocation(category: SpotCategory): boolean {
  return GROUP_COPY[CATEGORY_GROUP[category]].hasLocation;
}

/** Whether a list's spots have a price worth showing (meals, entry fees, hotels; not titles or cities) */
export function showsPrice(category: SpotCategory): boolean {
  return category === 'stays' || GROUP_COPY[CATEGORY_GROUP[category]].showPrice;
}

/** A spot's price (`$20–30`, else the tier `$$`), '' where lists show no price. */
export function spotPrice(spot: PriceInfo, category: SpotCategory): string {
  return showsPrice(category) ? formatPrice(spot) : '';
}

/** Name of the bookmarked ("want to") list a category's spots are saved to */
export function wantLabel(category: SpotCategory): string {
  return GROUP_COPY[CATEGORY_GROUP[category]].want;
}

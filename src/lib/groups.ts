import { CATEGORY_GROUP, COMMON_CUISINES, SpotCategory, SpotGroup } from '../types';

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
  hasLocation: boolean; // Places (map, distances, cities); movies and shows have none
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
    ],
    notePlaceholder: 'Highlights, where you stayed, tips, or notes...',
    noteAddPrompt: 'Add a note (highlights, tips...)',
    showPrice: false,
    hasLocation: true,
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
  },
};

/** Whether a category's spots are places (with a map, distances and cities) */
export function hasLocation(category: SpotCategory): boolean {
  return GROUP_COPY[CATEGORY_GROUP[category]].hasLocation;
}

/** Name of the bookmarked ("want to") list a category's spots are saved to */
export function wantLabel(category: SpotCategory): string {
  return GROUP_COPY[CATEGORY_GROUP[category]].want;
}

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
  },
};

// Gut-feeling labels are worded to fit every group; these swap the few that don't fit a trip
const VIBE_LABEL_OVERRIDES: Record<SpotGroup, Record<string, string>> = {
  eat: {},
  explore: {},
  travel: {
    'Terrible · Steer clear': 'Terrible · Regretted the trip',
    'Meh · Only if someone else picks it': 'Meh · Only if someone else plans it',
    'Passable · Fine if it’s convenient': 'Passable · Fine to pass through',
    'Really great · Worth going out of your way': 'Really great · Worth the journey',
    'Really loved it · Still thinking about it': 'Really loved it · Bucket-list worthy',
  },
};

/** Name of the bookmarked ("want to") list a category's spots are saved to */
export function wantLabel(category: SpotCategory): string {
  return GROUP_COPY[CATEGORY_GROUP[category]].want;
}

export function vibeLabelForGroup(label: string, group: SpotGroup): string {
  return VIBE_LABEL_OVERRIDES[group][label] ?? label;
}

import { COMMON_CUISINES, SpotGroup } from '../types';

interface GroupCopy {
  together: string; // "Eat Together"
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

// Gut-feeling labels are written for food; these swap the food-specific ones per group
const VIBE_LABEL_OVERRIDES: Record<SpotGroup, Record<string, string>> = {
  eat: {},
  explore: {
    'Liked it · Solid neighborhood spot': 'Liked it · A solid outing',
    'Good spot · Happy to go back': 'Good one · Happy to go back',
    'Great meal · Worth a detour': 'Great visit · Worth a detour',
    'Loved it · Standout spot': 'Loved it · A standout',
    'Really loved it · Crave-worthy': 'Really loved it · Can’t wait to go back',
    'Obsessed · Top-tier meal': 'Obsessed · Top-tier visit',
  },
  travel: {
    'Liked it · Solid neighborhood spot': 'Liked it · A solid trip',
    'Good spot · Happy to go back': 'Good place · Happy to go back',
    'Great meal · Worth a detour': 'Great trip · Worth the journey',
    'Loved it · Standout spot': 'Loved it · A standout',
    'Really loved it · Crave-worthy': 'Really loved it · Can’t wait to go back',
    'Obsessed · Top-tier meal': 'Obsessed · Top-tier trip',
  },
};

export function vibeLabelForGroup(label: string, group: SpotGroup): string {
  return VIBE_LABEL_OVERRIDES[group][label] ?? label;
}

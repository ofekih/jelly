import { SpotCategory } from '../types';
import { continentForCountryCode } from './continents';

export interface RawPlaceSignals {
  name: string;
  types?: string[];
  primaryType?: string;
  primaryTypeDisplayName?: string;
  osmCuisine?: string;
  osmAmenity?: string;
  servesBreakfast?: boolean;
  servesBrunch?: boolean;
  servesLunch?: boolean;
  servesDinner?: boolean;
  servesCoffee?: boolean;
  servesDessert?: boolean;
  servesCocktails?: boolean;
  servesWine?: boolean;
  servesBeer?: boolean;
  // Destination signals (Travel lists)
  countryCode?: string; // ISO 3166-1 alpha-2
  countryName?: string;
  viewportDiagonalKm?: number; // Size of Google's viewport for the place
  osmPlace?: string; // OSM place=* value (city, town, village, island, country…)
}

const GOOGLE_TYPE_TO_CUISINE: Record<string, string> = {
  italian_restaurant: 'Italian',
  japanese_restaurant: 'Japanese',
  sushi_restaurant: 'Sushi',
  ramen_restaurant: 'Ramen',
  mexican_restaurant: 'Mexican',
  american_restaurant: 'American',
  chinese_restaurant: 'Chinese',
  thai_restaurant: 'Thai',
  french_restaurant: 'French',
  mediterranean_restaurant: 'Mediterranean',
  indian_restaurant: 'Indian',
  korean_restaurant: 'Korean',
  vietnamese_restaurant: 'Vietnamese',
  middle_eastern_restaurant: 'Middle Eastern',
  spanish_restaurant: 'Spanish',
  greek_restaurant: 'Greek',
  pizza_restaurant: 'Pizza',
  seafood_restaurant: 'Seafood',
  steak_house: 'Steakhouse',
  hamburger_restaurant: 'Burgers',
  barbecue_restaurant: 'BBQ',
  vegan_restaurant: 'Vegetarian',
  vegetarian_restaurant: 'Vegetarian',
  indonesian_restaurant: 'Indonesian',
  lebanese_restaurant: 'Middle Eastern',
  turkish_restaurant: 'Middle Eastern',
  brazilian_restaurant: 'Brazilian',
  afghani_restaurant: 'Middle Eastern',
  african_restaurant: 'African',
  bakery: 'Bakery',
  coffee_shop: 'Cafe',
  cafe: 'Cafe',
  tea_house: 'Cafe',
  wine_bar: 'Wine Bar',
  cocktail_bar: 'Cocktail Bar',
  bar: 'Bar',
  pub: 'Pub',
  ice_cream_shop: 'Dessert',
  dessert_shop: 'Dessert',
  dessert_restaurant: 'Dessert',
  bagel_shop: 'Bagels',
  sandwich_shop: 'Sandwiches',
  deli: 'Deli',
};

const KEYWORD_CUISINE_RULES: Array<[RegExp, string]> = [
  [/\b(sushi|omakase|izakaya|yakitori|tempura|udon|soba|katsu)\b/i, 'Japanese'],
  [/\b(sushi|omakase|handroll)\b/i, 'Sushi'],
  [/\b(ramen|tsukemen)\b/i, 'Ramen'],
  [/\b(trattoria|osteria|pizzeria|pasta|gelato|cucina|ristorante)\b/i, 'Italian'],
  [/\b(pizza|pizzeria|slice)\b/i, 'Pizza'],
  [/\b(taqueria|taco|tacos|mezcal|cantina|burrito|birria|oaxacan)\b/i, 'Mexican'],
  [/\b(bistro|brasserie|boulangerie|patisserie)\b/i, 'French'],
  [/\b(dim sum|sichuan|szechaun|dumpling|noodle|hot pot|hotpot|cantonese)\b/i, 'Chinese'],
  [/\b(thai|pad thai|som tum)\b/i, 'Thai'],
  [/\b(pho|banh mi|vietnamese)\b/i, 'Vietnamese'],
  [/\b(kbbq|korean|bibimbap|soondubu|galbi)\b/i, 'Korean'],
  [/\b(tandoori|curry|masala|biryani|indian|chaat|dosa)\b/i, 'Indian'],
  [/\b(falafel|shawarma|hummus|kebab|kebob|levant|mediterranean)\b/i, 'Mediterranean'],
  [/\b(steak|steakhouse|chophouse)\b/i, 'Steakhouse'],
  [/\b(burger|burgers|smashburger)\b/i, 'Burgers'],
  [/\b(bbq|barbecue|smokehouse)\b/i, 'BBQ'],
  [/\b(oyster|seafood|fish|crab|lobster)\b/i, 'Seafood'],
  [/\b(bakery|bakehouse|bread|croissant|pastry|donut|doughnut|tart)\b/i, 'Bakery'],
  [/\b(coffee|espresso|roasters|roastery|matcha|cafe|café)\b/i, 'Cafe'],
  [/\b(wine bar|natural wine)\b/i, 'Wine Bar'],
  [/\b(cocktail|speakeasy|lounge|tavern|bar)\b/i, 'Cocktail Bar'],
];

// Keyword fallbacks (venue name / display type) when Google types are inconclusive.
// Order matters: earlier rules produce higher-priority categories.
const KEYWORD_CATEGORY_RULES: Array<[RegExp, SpotCategory[]]> = [
  [/\b(boba|bubble tea|milk tea|teahouse|tea house|tea bar)\b/i, ['coffee_tea']],
  [/\b(coffee|espresso|roasters|roastery|matcha|cafe|café|tea)\b/i, ['coffee_tea']],
  [/\b(bakery|bakehouse|boulangerie|patisserie|pâtisserie|bagel|bagels|donut|donuts|doughnut|doughnuts|croissant|bread)\b/i, ['bakeries']],
  [/\b(ice cream|gelato|gelateria|sorbet|dessert|desserts|creamery|frozen yogurt|froyo|cookie|cookies|cupcake|cupcakes|chocolate|churro|churros|mochi)\b/i, ['dessert']],
  [/\b(brunch|breakfast|pancake|pancakes|waffle|waffles|diner)\b/i, ['brunch']],
  [/\b(bar|pub|tavern|speakeasy|taproom|brewery|brewing|wine bar|cocktail|cocktails|lounge|saloon|biergarten)\b/i, ['bars']],
];

const COFFEE_TEA_TYPES = ['coffee_shop', 'cafe', 'tea_house', 'coffee_roastery', 'coffee_stand'];
const BAKERY_TYPES = ['bakery', 'bagel_shop', 'donut_shop'];
const DESSERT_TYPES = [
  'ice_cream_shop',
  'dessert_shop',
  'dessert_restaurant',
  'confectionery',
  'chocolate_shop',
  'candy_store',
  'frozen_yogurt_shop',
];
const BAR_TYPES = ['bar', 'wine_bar', 'cocktail_bar', 'pub', 'brewery', 'brewpub', 'beer_garden', 'lounge_bar', 'sports_bar', 'night_club'];
const BRUNCH_TYPES = ['breakfast_restaurant', 'brunch_restaurant', 'diner', 'pancake_restaurant'];

// Explore lists, led by Google place types
const EXPLORE_TYPE_RULES: Array<[SpotCategory, string[]]> = [
  ['museums', ['museum', 'art_gallery', 'art_museum', 'history_museum', 'science_museum', 'planetarium']],
  ['theme_parks', ['amusement_park', 'water_park', 'theme_park', 'roller_coaster', 'ferris_wheel']],
  ['zoos', ['zoo', 'aquarium', 'wildlife_park', 'wildlife_refuge']],
  [
    'nature',
    [
      'national_park',
      'state_park',
      'park',
      'botanical_garden',
      'garden',
      'hiking_area',
      'nature_preserve',
      'beach',
      'lake',
      'mountain_peak',
      'campground',
    ],
  ],
];

const EXPLORE_SUBTYPES: Record<string, string> = {
  art_gallery: 'Gallery',
  art_museum: 'Art',
  history_museum: 'History',
  science_museum: 'Science',
  planetarium: 'Science',
  amusement_park: 'Theme Park',
  theme_park: 'Theme Park',
  water_park: 'Water Park',
  zoo: 'Zoo',
  aquarium: 'Aquarium',
  wildlife_park: 'Wildlife Park',
  wildlife_refuge: 'Wildlife Park',
  national_park: 'National Park',
  state_park: 'State Park',
  botanical_garden: 'Garden',
  garden: 'Garden',
  hiking_area: 'Hike',
  nature_preserve: 'Nature Preserve',
  beach: 'Beach',
};

const MUSEUM_KEYWORD_SUBTYPES: Array<[RegExp, string]> = [
  [/\b(art|arts|moma|sfmoma|kunst|gallery|galleria|galerie|getty|louvre|uffizi|prado|tate)\b/i, 'Art'],
  [/\b(science|exploratorium|discovery|tech|technology|space|air and space|planetarium)\b/i, 'Science'],
  [/\bnatural history\b/i, 'Natural History'],
  [/\b(history|historical|heritage|holocaust|archaeolog\w*)\b/i, 'History'],
  [/\b(children'?s|kids)\b/i, 'Kids'],
];

// Landmarks & sights that aren't food (they have no list of their own, so they get no default)
const NON_FOOD_SIGHT_TYPES = [
  'tourist_attraction',
  'historical_landmark',
  'historical_place',
  'cultural_landmark',
  'monument',
  'sculpture',
  'observation_deck',
  'church',
  'place_of_worship',
  'stadium',
  'performing_arts_theater',
  'concert_hall',
  'lodging',
  'hotel',
];

// Destinations (Travel lists)
const SETTLEMENT_TYPES = [
  'locality',
  'postal_town',
  'sublocality',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'colloquial_area',
];
const ISLAND_TYPES = ['island', 'archipelago', 'natural_feature'];
// Places whose Google viewport spans at least this many km (corner to corner) lean "city"
const CITY_MIN_VIEWPORT_KM = 12;

function detectTravelCategories(signals: RawPlaceSignals, allTypes: Set<string>): SpotCategory[] {
  const osmPlace = (signals.osmPlace || '').toLowerCase();
  if (allTypes.has('country') || osmPlace === 'country') return ['countries'];

  const isIsland = ISLAND_TYPES.some((t) => allTypes.has(t)) || ['island', 'islet', 'archipelago'].includes(osmPlace);
  const isSettlement =
    SETTLEMENT_TYPES.some((t) => allTypes.has(t)) || ['city', 'town', 'village', 'hamlet', 'state', 'region'].includes(osmPlace);
  if (!isIsland && !isSettlement) return [];

  if (isIsland && !allTypes.has('locality')) return ['getaways'];
  const looksBig =
    osmPlace === 'city' ||
    (typeof signals.viewportDiagonalKm === 'number' && signals.viewportDiagonalKm >= CITY_MIN_VIEWPORT_KM);
  return looksBig ? ['cities'] : ['getaways'];
}

export function autoCategorizePlace(signals: RawPlaceSignals): {
  categories: SpotCategory[];
  cuisines: string[];
  primaryTypeDisplay: string;
} {
  // Ordered list of categories, best match first (the first one is the default pick)
  const categories: SpotCategory[] = [];
  const add = (c: SpotCategory) => {
    if (!categories.includes(c)) categories.push(c);
  };
  const cuisinesSet = new Set<string>();
  const allTypes = new Set<string>(signals.types || []);
  if (signals.primaryType) allTypes.add(signals.primaryType);

  // Destinations: tagged by country & continent instead of cuisine
  const travelCategories = detectTravelCategories(signals, allTypes);
  if (travelCategories.length > 0) {
    const continent = continentForCountryCode(signals.countryCode);
    const isCountry = travelCategories[0] === 'countries';
    const tags = (isCountry ? [continent] : [signals.countryName, continent]).filter(
      (t): t is string => Boolean(t) && t !== signals.name
    );
    return {
      categories: travelCategories,
      cuisines: Array.from(new Set(tags)),
      primaryTypeDisplay: isCountry ? 'Country' : signals.countryName || CATEGORY_FALLBACK_DISPLAY[travelCategories[0]],
    };
  }

  // Sights & activities: tagged by subtype (Art vs. Science museum, Zoo vs. Aquarium…)
  const exploreCategories = EXPLORE_TYPE_RULES.filter(([, types]) => types.some((t) => allTypes.has(t))).map(
    ([category]) => category
  );
  if (exploreCategories.length > 0) {
    // The primary type wins when it's an explore type (e.g. a museum that has a garden)
    const primaryRule = EXPLORE_TYPE_RULES.find(([, types]) => types.includes(signals.primaryType || ''));
    if (primaryRule) {
      exploreCategories.splice(exploreCategories.indexOf(primaryRule[0]), 1);
      exploreCategories.unshift(primaryRule[0]);
    }
    for (const t of [signals.primaryType, ...allTypes]) {
      if (t && EXPLORE_SUBTYPES[t]) cuisinesSet.add(EXPLORE_SUBTYPES[t]);
    }
    if (exploreCategories[0] === 'museums') {
      for (const [regex, subtype] of MUSEUM_KEYWORD_SUBTYPES) {
        if (regex.test(signals.name)) cuisinesSet.add(subtype);
      }
    }
    return {
      categories: exploreCategories,
      cuisines: Array.from(cuisinesSet),
      primaryTypeDisplay:
        signals.primaryTypeDisplayName || Array.from(cuisinesSet)[0] || CATEGORY_FALLBACK_DISPLAY[exploreCategories[0]],
    };
  }
  const isNonFoodSight =
    NON_FOOD_SIGHT_TYPES.some((t) => allTypes.has(t)) &&
    !allTypes.has('restaurant') &&
    !allTypes.has('food') &&
    !signals.primaryType?.endsWith('_restaurant');

  // 1. Extract cuisines from Google types
  for (const t of allTypes) {
    const mapped = GOOGLE_TYPE_TO_CUISINE[t];
    if (mapped) {
      cuisinesSet.add(mapped);
    }
    if (t === 'sushi_restaurant' || t === 'ramen_restaurant') {
      cuisinesSet.add('Japanese');
    }
  }

  // 2. Extract cuisines from OpenStreetMap cuisine tag
  if (signals.osmCuisine) {
    const parts = signals.osmCuisine.split(/[;,]/).map((s) => s.trim().toLowerCase());
    for (const part of parts) {
      if (!part) continue;
      const asGoogleKey = `${part}_restaurant`;
      if (GOOGLE_TYPE_TO_CUISINE[asGoogleKey]) {
        cuisinesSet.add(GOOGLE_TYPE_TO_CUISINE[asGoogleKey]);
      } else if (GOOGLE_TYPE_TO_CUISINE[part]) {
        cuisinesSet.add(GOOGLE_TYPE_TO_CUISINE[part]);
      } else {
        const formatted = part
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
        cuisinesSet.add(formatted);
      }
    }
  }

  // 3. Extract cuisines from name and primaryTypeDisplayName keywords
  const combinedText = `${signals.name} ${signals.primaryTypeDisplayName || ''} ${signals.osmAmenity || ''}`;
  for (const [regex, cuisine] of KEYWORD_CUISINE_RULES) {
    if (regex.test(combinedText)) {
      cuisinesSet.add(cuisine);
    }
  }

  // 4. Category detection, led by the venue's primary type
  const primary = signals.primaryType || '';
  const amenity = signals.osmAmenity || '';
  const hasAnyType = (list: string[]) => list.some((t) => allTypes.has(t));
  const servesBrunchish = Boolean(signals.servesBreakfast || signals.servesBrunch);

  if (COFFEE_TEA_TYPES.includes(primary) || amenity === 'cafe') {
    add('coffee_tea');
    if (hasAnyType(BAKERY_TYPES)) add('bakeries');
    if (servesBrunchish && (signals.servesLunch || hasAnyType(BRUNCH_TYPES))) add('brunch');
  } else if (DESSERT_TYPES.includes(primary) || amenity === 'ice_cream') {
    add('dessert');
    if (hasAnyType(BAKERY_TYPES)) add('bakeries');
  } else if (BAKERY_TYPES.includes(primary)) {
    add('bakeries');
    if (signals.servesCoffee || hasAnyType(COFFEE_TEA_TYPES)) add('coffee_tea');
    if (hasAnyType(DESSERT_TYPES)) add('dessert');
    if (signals.servesBrunch || (signals.servesBreakfast && signals.servesLunch)) add('brunch');
  } else if (BAR_TYPES.includes(primary) || ['bar', 'pub', 'biergarten', 'nightclub'].includes(amenity)) {
    add('bars');
    if (signals.servesDinner) add('restaurants');
    if (signals.servesBrunch) add('brunch');
  } else if (BRUNCH_TYPES.includes(primary)) {
    add('brunch');
    if (signals.servesDinner) add('restaurants');
    if (hasAnyType(COFFEE_TEA_TYPES)) add('coffee_tea');
  } else if (primary || allTypes.size > 0 || amenity) {
    // General restaurant (or an unknown primary type with secondary signals)
    const looksLikeRestaurant =
      primary.endsWith('_restaurant') ||
      primary === 'restaurant' ||
      allTypes.has('restaurant') ||
      amenity === 'restaurant' ||
      Boolean(signals.servesDinner || signals.servesLunch);

    // Daytime-only spots that serve breakfast lean Brunch first
    if (servesBrunchish && !signals.servesDinner) {
      add('brunch');
      if (looksLikeRestaurant) add('restaurants');
    } else if (looksLikeRestaurant) {
      add('restaurants');
      if (servesBrunchish || hasAnyType(BRUNCH_TYPES)) add('brunch');
    }
    if (hasAnyType(BRUNCH_TYPES)) add('brunch');
    if (hasAnyType(BAR_TYPES)) add('bars');
    if (hasAnyType(COFFEE_TEA_TYPES)) add('coffee_tea');
    if (hasAnyType(BAKERY_TYPES)) add('bakeries');
    if (hasAnyType(DESSERT_TYPES)) add('dessert');
  }

  // 5. Keyword fallback (name / display type) if still empty or only weakly detected
  if (categories.length === 0) {
    for (const [regex, list] of KEYWORD_CATEGORY_RULES) {
      if (regex.test(combinedText)) {
        for (const c of list) add(c);
      }
    }
  }

  // 6. Default: a regular restaurant (sights without a list of their own get none)
  if (categories.length === 0 && !isNonFoodSight) {
    add('restaurants');
  }

  let primaryTypeDisplay = signals.primaryTypeDisplayName || '';
  if (!primaryTypeDisplay) {
    const firstCuisine = Array.from(cuisinesSet)[0];
    if (firstCuisine) {
      primaryTypeDisplay = firstCuisine;
    } else {
      primaryTypeDisplay = categories[0] ? CATEGORY_FALLBACK_DISPLAY[categories[0]] : 'Sight';
    }
  }

  return {
    categories,
    cuisines: Array.from(cuisinesSet),
    primaryTypeDisplay,
  };
}

const CATEGORY_FALLBACK_DISPLAY: Record<SpotCategory, string> = {
  restaurants: 'Restaurant',
  brunch: 'Brunch',
  dessert: 'Dessert',
  bakeries: 'Bakery',
  coffee_tea: 'Cafe',
  bars: 'Bar',
  museums: 'Museum',
  theme_parks: 'Theme Park',
  zoos: 'Zoo',
  nature: 'Park',
  cities: 'City',
  getaways: 'Getaway',
  countries: 'Country',
  movies: 'Movie',
  tv_shows: 'TV show',
  fiction: 'Book',
  nonfiction: 'Book',
};

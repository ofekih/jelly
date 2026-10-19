import { SpotCategory } from '../types';

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

  // 6. Default: a regular restaurant
  if (categories.length === 0) {
    add('restaurants');
  }

  let primaryTypeDisplay = signals.primaryTypeDisplayName || '';
  if (!primaryTypeDisplay) {
    const firstCuisine = Array.from(cuisinesSet)[0];
    if (firstCuisine) {
      primaryTypeDisplay = firstCuisine;
    } else {
      primaryTypeDisplay = CATEGORY_FALLBACK_DISPLAY[categories[0]];
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
};

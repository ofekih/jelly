import { MealCategory } from '../types';

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

const KEYWORD_MEAL_RULES: Array<[RegExp, MealCategory[]]> = [
  [/\b(coffee|espresso|roasters|roastery|matcha|cafe|café|tea)\b/i, ['Coffee', 'Breakfast']],
  [/\b(bakery|bakehouse|boulangerie|patisserie|bagel|donut|doughnut|croissant)\b/i, ['Breakfast', 'Coffee', 'Dessert']],
  [/\b(ice cream|gelato|sorbet|dessert|sweet|cookie|cupcake|boba)\b/i, ['Dessert']],
  [/\b(brunch|breakfast|pancake|waffle|diner)\b/i, ['Breakfast', 'Lunch']],
  [/\b(bar|pub|tavern|speakeasy|taproom|brewery|wine bar|cocktail)\b/i, ['Drinks', 'Dinner']],
  [/\b(deli|sandwich|sub|salad|poke|taco|taqueria|burger|pizza)\b/i, ['Lunch', 'Dinner']],
];

export function autoCategorizePlace(signals: RawPlaceSignals): {
  meals: MealCategory[];
  cuisines: string[];
  primaryTypeDisplay: string;
} {
  const mealsSet = new Set<MealCategory>();
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

  // 4. Primary venue type priority for Meals
  if (
    signals.primaryType === 'coffee_shop' ||
    signals.primaryType === 'cafe' ||
    signals.primaryType === 'tea_house' ||
    signals.osmAmenity === 'cafe'
  ) {
    mealsSet.add('Coffee');
    if (signals.servesBreakfast || allTypes.has('breakfast_restaurant') || allTypes.has('bakery')) {
      mealsSet.add('Breakfast');
    }
    if (signals.servesLunch) {
      mealsSet.add('Lunch');
    }
  } else if (
    signals.primaryType === 'ice_cream_shop' ||
    signals.primaryType === 'dessert_shop' ||
    signals.primaryType === 'dessert_restaurant' ||
    signals.osmAmenity === 'ice_cream'
  ) {
    mealsSet.add('Dessert');
  } else if (signals.primaryType === 'bakery') {
    mealsSet.add('Breakfast');
    mealsSet.add('Coffee');
    mealsSet.add('Dessert');
    if (signals.servesLunch) mealsSet.add('Lunch');
  } else if (
    signals.primaryType === 'bar' ||
    signals.primaryType === 'wine_bar' ||
    signals.primaryType === 'cocktail_bar' ||
    signals.primaryType === 'pub' ||
    signals.primaryType === 'brewery' ||
    signals.osmAmenity === 'bar' ||
    signals.osmAmenity === 'pub'
  ) {
    mealsSet.add('Drinks');
    if (signals.servesDinner) mealsSet.add('Dinner');
  } else {
    // Standard restaurant meal detection
    if (signals.servesDinner) mealsSet.add('Dinner');
    if (signals.servesLunch) mealsSet.add('Lunch');
    if (signals.servesBreakfast || signals.servesBrunch) mealsSet.add('Breakfast');

    if (
      allTypes.has('breakfast_restaurant') ||
      allTypes.has('brunch_restaurant') ||
      allTypes.has('bagel_shop') ||
      allTypes.has('donut_shop')
    ) {
      mealsSet.add('Breakfast');
    }
    if (allTypes.has('coffee_shop') || allTypes.has('cafe')) {
      mealsSet.add('Coffee');
    }
    if (allTypes.has('bar') || allTypes.has('wine_bar') || allTypes.has('cocktail_bar')) {
      mealsSet.add('Drinks');
    }
  }

  // 5. Keyword fallback for meals if still empty
  if (mealsSet.size === 0) {
    for (const [regex, mealList] of KEYWORD_MEAL_RULES) {
      if (regex.test(combinedText)) {
        for (const m of mealList) mealsSet.add(m);
      }
    }
  }

  // 6. Default fallback if a general restaurant had no explicit meal service booleans
  if (mealsSet.size === 0) {
    mealsSet.add('Dinner');
    mealsSet.add('Lunch');
  }

  let primaryTypeDisplay = signals.primaryTypeDisplayName || '';
  if (!primaryTypeDisplay) {
    const firstCuisine = Array.from(cuisinesSet)[0];
    if (firstCuisine) {
      primaryTypeDisplay = firstCuisine;
    } else if (mealsSet.has('Coffee')) {
      primaryTypeDisplay = 'Coffee';
    } else if (mealsSet.has('Drinks')) {
      primaryTypeDisplay = 'Bar';
    } else {
      primaryTypeDisplay = 'Restaurant';
    }
  }

  return {
    meals: Array.from(mealsSet),
    cuisines: Array.from(cuisinesSet),
    primaryTypeDisplay,
  };
}

import { strToU8, zipSync } from 'fflate';

/**
 * A synthetic Beli export in the real format (made-up places, no real person's data), with the
 * edge cases a real export has: quoted commas, doubled quotes, line breaks in notes, accents, bare
 * cities, several notes of one kind, private notes, notes on bookmarks, unmatched notes, an
 * unknown list code, and the files the engine must never open. Used by tests and the emulator seed.
 */

const ADJECTIVES = ['Golden', 'Little', 'Blue', 'Old', 'Lucky', 'Wild', 'Silver', 'Hidden', 'Red', 'Green', 'Copper', 'Velvet'];
const NOUNS = ['Spoon', 'Fig', 'Lantern', 'Harbor', 'Oven', 'Table', 'Garden', 'Kettle', 'Olive', 'Pepper', 'Anchor', 'Basil'];
const CITIES = ['Irvine, CA', 'Costa Mesa, CA', 'Los Angeles, CA', 'New York, NY', 'Brooklyn, NY', 'Tel Aviv-Yafo'];

export const FIXTURE_DATE = '2025-06-01 18:30:00.123456+00:00';

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csv(rows: string[][]): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\n') + '\n';
}

export interface FixtureSpot {
  name: string;
  city: string;
}

/** `count` distinct made-up place names, deterministic */
export function fixtureSpots(count: number, offset = 0): FixtureSpot[] {
  return Array.from({ length: count }, (_, i) => {
    const k = i + offset;
    const name = `${ADJECTIVES[k % ADJECTIVES.length]} ${NOUNS[Math.floor(k / ADJECTIVES.length) % NOUNS.length]}${
      k >= ADJECTIVES.length * NOUNS.length ? ` ${Math.floor(k / (ADJECTIVES.length * NOUNS.length)) + 1}` : ''
    }`;
    return { name, city: CITIES[k % CITIES.length] };
  });
}

export interface FixtureOptions {
  restaurants?: number;
}

/** The export's CSV texts by file name (plus two files the engine must ignore). */
export function syntheticBeliTexts({ restaurants = 30 }: FixtureOptions = {}): Record<string, string> {
  const res = [
    { name: 'Café Lumière', city: 'Tel Aviv-Yafo' },
    { name: 'Nonna’s Kitchen, Pasta & Wine', city: 'New York, NY' },
    { name: 'The "Best" Tacos', city: 'Los Angeles, CA' },
    ...fixtureSpots(restaurants - 3),
  ];
  const bak = [
    { name: 'Morning Crumb', city: 'Irvine, CA' },
    { name: 'Rye & Butter', city: 'Brooklyn, NY' },
    { name: 'Le Petit Four', city: 'Costa Mesa, CA' },
    { name: 'Daily Loaf', city: 'Jerusalem' },
  ];
  const cof = [
    { name: 'Bean There', city: 'Irvine, CA' },
    { name: 'Drip Theory', city: 'Los Angeles, CA' },
  ];
  const des = [{ name: 'Sugar Moon', city: 'Irvine, CA' }];

  const rankings: string[][] = [['Rank', 'Restaurant Name', 'City', 'Category', 'Created Date', 'Visit Dates']];
  const add = (list: FixtureSpot[], code: string) =>
    list.forEach((s, i) =>
      rankings.push([
        String(i + 1),
        s.name,
        s.city,
        code,
        FIXTURE_DATE,
        i === 0 ? '[datetime.date(2026, 10, 3), datetime.date(2025, 1, 12)]' : i === 1 ? '[datetime.date(2026, 9, 30)]' : '[]',
      ])
    );
  add(res, 'RES');
  add(bak, 'BAK');
  add(cof, 'COF');
  add(des, 'DES');
  rankings.push(['1', 'Mystery Spot', 'Irvine, CA', 'XYZ', FIXTURE_DATE, '[]']); // Unknown list code

  const bookmarks = csv([
    ['Business Name', 'City', 'Category', 'Bookmarked Date'],
    ['Saffron Road', 'Irvine, CA', 'RES', '2026-01-02 10:00:00+00:00'],
    ['Crust Club', 'Costa Mesa, CA', 'BAK', FIXTURE_DATE],
    ['Matcha Lab', 'Los Angeles, CA', 'COF', FIXTURE_DATE],
    ['Saffron Road', 'Irvine, CA', 'RES', FIXTURE_DATE], // Duplicate
  ]);

  const notes = csv([
    ['Field Type', 'Business Name', 'City', 'Note Text', 'Created Date'],
    ['Notes', 'Café Lumière', 'Tel Aviv-Yafo', 'Great shakshuka, slow service.\nWould go back, "for sure".', FIXTURE_DATE],
    ['Notes', 'Café Lumière', 'Tel Aviv-Yafo', 'Second visit: even better.', FIXTURE_DATE],
    ['Favorite Dishes', 'Café Lumière', 'Tel Aviv-Yafo', 'Shakshuka, labneh', FIXTURE_DATE],
    ['Private Notes', 'Nonna’s Kitchen, Pasta & Wine', 'New York, NY', 'Ask for the back table', FIXTURE_DATE],
    ['Notes', 'Saffron Road', 'Irvine, CA', 'Friend says the biryani is the move', FIXTURE_DATE], // On a bookmark
    ['Notes', 'Nowhere Diner', 'Irvine, CA', 'Not in any list', FIXTURE_DATE], // Unmatched
  ]);

  const labels = csv([
    ['Label Name', 'Business Name', 'City', 'Created Date'],
    ['Date Night', 'Café Lumière', 'Tel Aviv-Yafo', FIXTURE_DATE],
    ['Hidden Gem', 'Café Lumière', 'Tel Aviv-Yafo', FIXTURE_DATE],
    ['Overpriced', 'Morning Crumb', 'Irvine, CA', FIXTURE_DATE],
  ]);

  const follows = csv([
    ['Username', 'Request Date', 'Accept Date'],
    ['foodfriend_1', FIXTURE_DATE, FIXTURE_DATE],
    ['pending_pal', FIXTURE_DATE, ''],
  ]);

  return {
    'rankings.csv': csv(rankings),
    'bookmarks.csv': bookmarks,
    'notes_dishes.csv': notes,
    'labels.csv': labels,
    'follows.csv': follows,
    'photos.csv': 'must,never,be,read\n',
    'user_profile.csv': 'Email,Phone\nnot-real@example.com,000\n',
  };
}

/** The same export as a zip, under a folder like a re-zipped download would be */
export function syntheticBeliZip(options?: FixtureOptions): Uint8Array {
  const texts = syntheticBeliTexts(options);
  return zipSync(Object.fromEntries(Object.entries(texts).map(([name, text]) => [`export/${name}`, strToU8(text)])));
}

const TYPES_BY_WORD: Array<[RegExp, string[]]> = [
  [/crumb|loaf|rye|four|crust/i, ['bakery', 'food']],
  [/bean|drip|matcha/i, ['cafe', 'coffee_shop', 'food']],
  [/sugar/i, ['dessert_shop', 'food']],
];

/**
 * A stand-in for Google Text Search over the synthetic export (emulator and tests: no real calls).
 * "Lucky …" places have two branches in the city (a chain: review), "Wild …" ones are not found,
 * everything else is a clean match.
 */
export async function syntheticPlacesSearch(textQuery: string): Promise<{ status: 'ok'; places: any[] }> {
  // "name, city[, ST]" where the name itself may hold commas: read the city from the end
  const parts = textQuery.split(', ');
  const region = parts.length >= 3 && /^[A-Z]{2}$/.test(parts[parts.length - 1]) ? parts.pop() : undefined;
  const city = parts.length >= 2 ? parts.pop()! : '';
  const name = parts.join(', ');
  if (/^wild /i.test(name)) return { status: 'ok', places: [] };
  const id = `synthetic_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${city.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  const types = TYPES_BY_WORD.find(([re]) => re.test(name))?.[1] ?? ['restaurant', 'food'];
  const place = (suffix: string, street: string) => ({
    id: id + suffix,
    displayName: { text: name },
    formattedAddress: `${street}, ${city}${region ? `, ${region}` : ''}`,
    addressComponents: [
      { longText: city, shortText: city, types: ['locality', 'political'] },
      ...(region ? [{ longText: region, shortText: region, types: ['administrative_area_level_1'] }] : []),
      { longText: region ? 'United States' : 'Israel', shortText: region ? 'US' : 'IL', types: ['country'] },
    ],
    location: { latitude: 33.6 + (id.length % 7) / 100, longitude: -117.8 - (id.length % 5) / 100 },
    types,
    primaryType: types[0],
    googleMapsUri: `https://maps.google.com/?cid=${id.length}`,
  });
  const places = /^lucky /i.test(name) ? [place('_a', '1 Main St'), place('_b', '99 Oak Ave')] : [place('', '1 Main St')];
  return { status: 'ok', places };
}

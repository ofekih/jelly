import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteField, doc, setDoc, updateDoc } from 'firebase/firestore';
import { clearEmulator, closeDevices, createDevice, EMULATOR_PROJECT } from './emulatorDevice';

/**
 * Firestore stops evaluating rules at 1,000 expressions per document written (the emulator
 * enforces it like production). v4.7.0's rules pushed ordinary spots over it and every rank failed
 * to save, so these check that filled-in spots stay accepted with room to spare, and that the
 * cheaper validators still accept and reject exactly what they did.
 */

const RULES = readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
const HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';

async function loadRules(content: string) {
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${EMULATOR_PROJECT}:securityRules`, {
    method: 'PUT',
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
  });
  if (!res.ok) throw new Error(`Could not load rules: ${res.status} ${await res.text()}`);
}

/** The real rules with ~`units` × 8 extra expressions on every spot / saved spot write */
function paddedRules(units: number): string {
  const tens = Math.floor(units / 10);
  const ones = units % 10;
  const pad = [...Array(tens).fill('budgetPad10(d)'), ...Array(ones).fill('budgetPad1(d)')].join(' && ') || 'true';
  const helpers = `
    function budgetPad1(d) { return d.name != null; }
    function budgetPad10(d) { return ${Array(10).fill('budgetPad1(d)').join(' && ')}; }
    function budgetPad(d) { return ${pad}; }
`;
  let out = RULES.replace('match /databases/{database}/documents {', (m) => m + helpers);
  for (const v of ['isValidRestaurant', 'isValidBookmark']) {
    const call = `${v}(request.resource.data, writtenKeys())`;
    const count = out.split(call).length - 1;
    expect(count).toBe(2); // create and update
    out = out.split(call).join(`${call} && budgetPad(request.resource.data)`);
  }
  return out;
}

const place = {
  id: 'g1__restaurants',
  placeId: 'g1',
  name: 'Trattoria',
  formattedAddress: '1 Main St, New York, NY 10012, USA',
  neighborhood: 'SoHo',
  city: 'New York',
  lat: 40.72,
  lng: -74.0,
  googleMapsUri: 'https://maps.google.com/?cid=1',
  priceLevel: 2,
  priceRange: { currency: 'USD', start: 20, end: 30 },
  category: 'restaurants',
  categories: ['restaurants', 'brunch'],
  cuisines: ['Italian', 'Pasta'],
  primaryTypeDisplay: 'Italian restaurant',
  initialRating: 8.2,
  rankIndex: 3,
  magicScore: 8.1,
  comparisonsCount: 5,
  notes: 'Go for the cacio e pepe',
  rankedHistory: [{ at: 1, initialRating: 8.2 }],
  comparisons: [{ opponentId: 'g2__restaurants', result: 1, at: 1 }],
  createdAt: 1,
  updatedAt: 2,
};

/** Every field a spot can have (30 keys, the limit) */
const fullestPlace = {
  ...place,
  favoriteDishes: 'Cacio e pepe',
  privateNotes: 'Ask for the back room',
  imported: { source: 'beli', batch: 'beli-abc-123', key: 'trattoria|new york, ny' },
  visitedAt: '2025-01-01',
  elo: 1500,
  status: 'ranked',
};

/** A board game with every media field, notes and private notes */
const fullestTitle = {
  id: 'bgg:13__board_games',
  placeId: 'bgg:13',
  name: 'Catan',
  formattedAddress: '1995 · Klaus Teuber',
  category: 'board_games',
  categories: ['board_games'],
  cuisines: ['Strategy', 'Trading'],
  primaryTypeDisplay: 'Board game',
  media: { year: 1995, poster: 'https://cf.geekdo-images.com/x.jpg', creator: 'Klaus Teuber', players: [3, 4], best: [4, 4], time: [60, 120], weight: 2.3 },
  initialRating: 7.5,
  rankIndex: 0,
  magicScore: 7.6,
  comparisonsCount: 2,
  notes: 'Better with 4',
  favoriteDishes: 'The robber',
  privateNotes: 'Lent to Sam',
  rankedHistory: [{ at: 1, initialRating: 7.5 }],
  comparisons: [{ opponentId: 'bgg:822__board_games', result: 0, at: 1 }],
  createdAt: 1,
  updatedAt: 2,
};

const fullestBookmark = {
  id: 'g1',
  placeId: 'g1',
  name: 'Trattoria',
  formattedAddress: '1 Main St, New York, NY 10012, USA',
  neighborhood: 'SoHo',
  city: 'New York',
  lat: 40.72,
  lng: -74.0,
  googleMapsUri: 'https://maps.google.com/?cid=1',
  priceLevel: 2,
  priceRange: { currency: 'USD', start: 20, end: 30 },
  category: 'restaurants',
  categories: ['restaurants'],
  cuisines: ['Italian'],
  primaryTypeDisplay: 'Italian restaurant',
  media: { year: 1995, poster: '/x.jpg', creator: 'Someone', players: [3, 4], best: [4, 4], time: [60, 120], weight: 2.3 },
  notes: 'Recommended by Dana',
  privateNotes: 'Birthday spot?',
  imported: { source: 'beli', batch: 'beli-abc-123', key: 'trattoria|new york, ny' },
  recommendedBy: 'Dana',
  recommendedByUid: 'dana-uid',
  createdAt: 1,
  updatedAt: 2,
};

/** What a rank writes to most of a list */
const reranked = (d: { rankIndex: number; magicScore: number; updatedAt: number }) => ({
  ...d,
  rankIndex: d.rankIndex + 1,
  magicScore: d.magicScore - 0.1,
  updatedAt: d.updatedAt + 1,
});

beforeEach(() => clearEmulator());
afterEach(() => closeDevices());
afterAll(async () => {
  await loadRules(RULES);
  await closeDevices();
});

describe('rules evaluation budget', () => {
  it('a spot with a Google price range can be re-ranked (v4.7.0 rejected the rank)', async () => {
    const d = createDevice('budget');
    const { notes: _, ...withPrice } = place;
    const ref = doc(d.db, 'users', d.uid, 'restaurants', place.id);
    await setDoc(ref, withPrice);
    await setDoc(ref, reranked(withPrice));
  });

  it('and with notes and favourite dishes too (v4.6.1 already rejected that rank)', async () => {
    const d = createDevice('budget');
    const full = { ...place, favoriteDishes: 'Cacio e pepe' };
    const ref = doc(d.db, 'users', d.uid, 'restaurants', place.id);
    await setDoc(ref, full);
    await setDoc(ref, reranked(full));
  });

  it('the fullest spots and saved spots keep ~80 expressions to spare on create and on a rank', async () => {
    await loadRules(paddedRules(10));
    const d = createDevice('budget');
    for (const spot of [fullestPlace, fullestTitle]) {
      const ref = doc(d.db, 'users', d.uid, 'restaurants', spot.id);
      await setDoc(ref, spot);
      await setDoc(ref, reranked(spot));
    }
    const bm = doc(d.db, 'users', d.uid, 'bookmarks', fullestBookmark.id);
    await setDoc(bm, fullestBookmark);
    await setDoc(bm, { ...fullestBookmark, notes: 'Changed' });
    await loadRules(RULES);
  });

  it('a rank leaves most of the budget unused (only changed fields are checked)', async () => {
    await loadRules(paddedRules(70));
    const d = createDevice('budget');
    const ref = doc(d.db, 'users', d.uid, 'restaurants', fullestPlace.id);
    await expect(setDoc(ref, fullestPlace)).rejects.toThrow(); // the full check doesn't fit with this much padding
    await loadRules(RULES);
    await setDoc(ref, fullestPlace);
    await loadRules(paddedRules(70));
    await setDoc(ref, reranked(fullestPlace));
    await loadRules(RULES);
  });
});

describe('spot validators accept and reject what they did', () => {
  const write = async (data: Record<string, unknown>, col: 'restaurants' | 'bookmarks' = 'restaurants') => {
    const d = createDevice('shape');
    await setDoc(doc(d.db, 'users', d.uid, col, 'x'), data);
  };
  const minimal = { name: 'S', rankIndex: 0, magicScore: 5 };

  it('accepts nulls where the old rules did', async () => {
    // A few at a time: a null costs more than a value (the usual case is checked first), and the
    // app never writes them (`stripUndefined`), so a doc of nothing but nulls isn't a real case
    const nullable = [
      'id', 'placeId', 'formattedAddress', 'neighborhood', 'city', 'googleMapsUri', 'primaryTypeDisplay', 'category',
      'media', 'notes', 'favoriteDishes', 'privateNotes', 'status', 'elo', 'lat', 'lng', 'priceLevel', 'priceRange',
      'categories', 'visitedAt', 'createdAt', 'updatedAt',
    ];
    for (let i = 0; i < nullable.length; i += 6) {
      await write({ ...minimal, ...Object.fromEntries(nullable.slice(i, i + 6).map((f) => [f, null])) });
    }
    await write({ name: 'B', media: null, priceRange: null, categories: null, recommendedBy: null }, 'bookmarks');
    await write({ ...minimal, priceRange: { currency: 'EUR', end: 5 } });
    await write({ ...minimal, priceRange: { currency: 'EUR', start: 100 } });
    await write({ ...minimal, visitedAt: 1700000000000 });
    await write({ ...minimal, media: { year: 2001 } });
  });

  it.each([
    ['missing name', { rankIndex: 0, magicScore: 5 }],
    ['missing magicScore', { name: 'S', rankIndex: 0 }],
    ['empty name', { ...minimal, name: '' }],
    ['null initialRating', { ...minimal, initialRating: null }],
    ['initialRating 0', { ...minimal, initialRating: 0 }],
    ['magicScore 11', { ...minimal, magicScore: 11 }],
    ['rankIndex -1', { ...minimal, rankIndex: -1 }],
    ['empty id', { ...minimal, id: '' }],
    ['numeric notes', { ...minimal, notes: 5 }],
    ['long notes', { ...minimal, notes: 'x'.repeat(5001) }],
    ['long favoriteDishes', { ...minimal, favoriteDishes: 'x'.repeat(2001) }],
    ['long city', { ...minimal, city: 'x'.repeat(201) }],
    ['unknown category', { ...minimal, category: 'pizza' }],
    ['numeric category', { ...minimal, category: 5 }],
    ['unknown status', { ...minimal, status: 'maybe' }],
    ['lat 91', { ...minimal, lat: 91 }],
    ['string lng', { ...minimal, lng: '1' }],
    ['priceLevel 6', { ...minimal, priceLevel: 6 }],
    ['price range without amounts', { ...minimal, priceRange: { currency: 'USD' } }],
    ['price range end below start', { ...minimal, priceRange: { currency: 'USD', start: 30, end: 20 } }],
    ['price range lowercase currency', { ...minimal, priceRange: { currency: 'usd', start: 1 } }],
    ['price range extra key', { ...minimal, priceRange: { currency: 'USD', start: 1, x: 1 } }],
    ['price range null start', { ...minimal, priceRange: { currency: 'USD', start: null, end: 5 } }],
    ['too many categories', { ...minimal, categories: Array(11).fill('bars') }],
    ['null cuisines', { ...minimal, cuisines: null }],
    ['null comparisons', { ...minimal, comparisons: null }],
    ['too many history events', { ...minimal, rankedHistory: Array(101).fill({}) }],
    ['null comparisonsCount', { ...minimal, comparisonsCount: null }],
    ['long visitedAt', { ...minimal, visitedAt: 'x'.repeat(101) }],
    ['boolean createdAt', { ...minimal, createdAt: true }],
    ['media extra key', { ...minimal, media: { year: 2000, rating: 5 } }],
    ['media float year', { ...minimal, media: { year: 2000.5 } }],
    ['media reversed players', { ...minimal, media: { players: [4, 2] } }],
    ['media 3-item time', { ...minimal, media: { time: [1, 2, 3] } }],
    ['media weight 6', { ...minimal, media: { weight: 6 } }],
    ['media as a string', { ...minimal, media: 'x' }],
    ['null imported', { ...minimal, imported: null }],
    ['imported from elsewhere', { ...minimal, imported: { source: 'yelp', batch: 'b', key: 'k' } }],
    ['imported without key', { ...minimal, imported: { source: 'beli', batch: 'b' } }],
    ['too many keys', { ...minimal, ...Object.fromEntries(Array.from({ length: 28 }, (_, i) => [`f${i}`, 1])) }],
  ])('rejects a spot with %s', async (_, data) => {
    await expect(write(data)).rejects.toThrow();
  });

  it.each([
    ['missing name', { notes: 'x' }],
    ['long recommendedBy', { name: 'B', recommendedBy: 'x'.repeat(121) }],
    ['null cuisines', { name: 'B', cuisines: null }],
    ['bad imported', { name: 'B', imported: { source: 'beli', batch: '', key: 'k' } }],
  ])('rejects a saved spot with %s', async (_, data) => {
    await expect(write(data, 'bookmarks')).rejects.toThrow();
  });

  it('checks changed fields on update, allows removing optional ones but not required ones', async () => {
    const d = createDevice('update');
    const ref = doc(d.db, 'users', d.uid, 'restaurants', place.id);
    await setDoc(ref, { ...place, favoriteDishes: 'x' });
    await expect(updateDoc(ref, { notes: 5 })).rejects.toThrow();
    await expect(updateDoc(ref, { magicScore: 12 })).rejects.toThrow();
    await expect(updateDoc(ref, { category: 'pizza' })).rejects.toThrow();
    await expect(updateDoc(ref, { id: 'other__restaurants' })).rejects.toThrow(); // the ID can't change
    await expect(updateDoc(ref, { name: deleteField() })).rejects.toThrow();
    await expect(updateDoc(ref, { initialRating: null })).rejects.toThrow();
    await updateDoc(ref, { favoriteDishes: deleteField(), priceRange: deleteField(), initialRating: deleteField(), cuisines: deleteField() });
    await updateDoc(ref, { notes: null, priceRange: { currency: 'USD', start: 10 } });
  });
});

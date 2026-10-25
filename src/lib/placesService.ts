import { DEFAULT_PLACES_API_KEY } from '../firebase';
import { CATEGORY_GROUP, PlaceCandidate, SpotCategory, SpotGroup } from '../types';
import { autoCategorizePlace } from './categorizer';
import { haversineDistanceMiles, UserCoordinates } from './geo';
import { fromGooglePriceRange, GOOGLE_PRICE_LEVEL, type PriceInfo } from './price';

interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

const NYC_BOROUGHS = new Set([
  'Brooklyn',
  'Manhattan',
  'Queens',
  'Bronx',
  'The Bronx',
  'Staten Island',
]);

function extractNeighborhoodAndCity(
  formattedAddress: string,
  addressComponents?: GoogleAddressComponent[]
): {
  neighborhood?: string;
  city?: string;
} {
  if (Array.isArray(addressComponents) && addressComponents.length > 0) {
    let neighborhood: string | undefined;
    let sublocality: string | undefined;
    let locality: string | undefined;
    let postalTown: string | undefined;

    for (const comp of addressComponents) {
      const types = comp.types || [];
      const text = comp.longText || comp.shortText;
      if (!text) continue;
      if (!neighborhood && types.includes('neighborhood')) {
        neighborhood = text;
      }
      if (!sublocality && (types.includes('sublocality_level_1') || types.includes('sublocality'))) {
        sublocality = text;
      }
      if (!locality && types.includes('locality')) {
        locality = text;
      }
      if (!postalTown && types.includes('postal_town')) {
        postalTown = text;
      }
    }

    // Handle NYC boroughs cleanly: e.g. Williamsburg (neighborhood) + Brooklyn (sublocality) -> New York (city)
    if (!locality && sublocality && NYC_BOROUGHS.has(sublocality)) {
      return {
        neighborhood: neighborhood || sublocality,
        city: 'New York',
      };
    }

    const resolvedCity = locality || postalTown || sublocality;
    const resolvedNeighborhood =
      neighborhood || (sublocality && sublocality !== resolvedCity ? sublocality : undefined);

    if (resolvedCity || resolvedNeighborhood) {
      return {
        neighborhood: resolvedNeighborhood,
        city: resolvedCity,
      };
    }
  }

  if (!formattedAddress) return {};
  const parts = formattedAddress.split(',').map((p) => p.trim());
  if (parts.length >= 3) {
    const cityCandidate = parts[parts.length - 3];
    const neighborhoodCandidate = parts.length >= 4 ? parts[parts.length - 4] : undefined;
    return {
      city: cityCandidate,
      neighborhood: neighborhoodCandidate !== parts[0] ? neighborhoodCandidate : undefined,
    };
  }
  if (parts.length === 2) {
    return { city: parts[0] };
  }
  return {};
}

const PLACES_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'shortFormattedAddress',
  'addressComponents',
  'location',
  'types',
  'primaryType',
  'primaryTypeDisplayName',
  // priceLevel and priceRange are both Enterprise fields: the serves* fields below already put
  // every request in the (pricier) Enterprise + Atmosphere tier, so they add nothing to the bill
  'priceLevel',
  'priceRange',
  'googleMapsUri',
  'servesBreakfast',
  'servesBrunch',
  'servesLunch',
  'servesDinner',
  'servesCoffee',
  'servesDessert',
  'servesCocktails',
  'servesWine',
  'servesBeer',
  'viewport',
];

function extractCountry(addressComponents?: GoogleAddressComponent[]): {
  countryCode?: string;
  countryName?: string;
} {
  const comp = addressComponents?.find((c) => c.types?.includes('country'));
  return comp ? { countryCode: comp.shortText, countryName: comp.longText || comp.shortText } : {};
}

function viewportDiagonalKm(viewport: any): number | undefined {
  const low = viewport?.low;
  const high = viewport?.high;
  if (typeof low?.latitude !== 'number' || typeof high?.latitude !== 'number') return undefined;
  return haversineDistanceMiles(low.latitude, low.longitude, high.latitude, high.longitude) * 1.609344;
}

function normalizeForMatch(str: string): string {
  return str
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scores how strongly a candidate restaurant's name matches the user's raw search query.
 * Returns > 0 if the query matches the restaurant's name, or 0 if it only matched
 * unrelated review/category text (e.g. shabu-shabu places appearing for "boil").
 */
function computeNameMatchScore(candidateName: string, rawQuery: string): number {
  const normName = normalizeForMatch(candidateName);
  const normQuery = normalizeForMatch(rawQuery);
  if (!normName || !normQuery) return 0;

  if (normName === normQuery) return 120;
  if (normName.startsWith(normQuery)) return 100;

  // Also check raw lowercase prefix (preserving '&', e.g. "boil & bake")
  const rawLowerName = candidateName.toLowerCase().trim();
  const rawLowerQuery = rawQuery.toLowerCase().trim();
  if (rawLowerName.startsWith(rawLowerQuery)) return 105;

  const nameWords = normName.split(' ').filter(Boolean);
  const queryWords = normQuery
    .split(' ')
    .filter((w) => w.length > 0 && w !== 'and' && w !== 'the');

  if (queryWords.length === 0) return 0;

  // Check if every query word matches the prefix of some word in the restaurant name
  const allWordsMatchPrefix = queryWords.every((qw) =>
    nameWords.some((nw) => nw.startsWith(qw))
  );
  if (allWordsMatchPrefix) {
    // Higher score if the very first word of the restaurant name starts with the first query word
    return nameWords[0]?.startsWith(queryWords[0]) ? 95 : 85;
  }

  if (normName.includes(normQuery) || rawLowerName.includes(rawLowerQuery)) {
    return 75;
  }

  // Partial word-prefix match (e.g. user typed "boil costa mesa" where "boil" is in the name)
  const matchedWordCount = queryWords.filter((qw) =>
    nameWords.some((nw) => nw.startsWith(qw) || (qw.length >= 3 && nw.includes(qw)))
  ).length;

  if (matchedWordCount > 0) {
    return 40 + Math.round((matchedWordCount / queryWords.length) * 30);
  }

  return 0;
}

const FAR_AWAY_KM = 150;

/**
 * Adjusts a name-match score by where the place is: a far-away namesake (the Natural History
 * Museum in London when searching from LA) drops below nearby matches, unless the query names
 * the place's area ("natural history museum london"), which instead gives it a small boost.
 */
export function locationAdjustedScore(
  nameScore: number,
  cand: Pick<PlaceCandidate, 'name' | 'formattedAddress' | 'lat' | 'lng'>,
  rawQuery: string,
  userLocation?: UserCoordinates | null
): number {
  const nameWords = normalizeForMatch(cand.name).split(' ');
  const addressWords = normalizeForMatch(cand.formattedAddress || '').split(' ');
  const areaWords = normalizeForMatch(rawQuery)
    .split(' ')
    .filter((w) => w.length >= 3 && !nameWords.some((nw) => nw.startsWith(w)));
  if (areaWords.some((w) => addressWords.some((aw) => aw.startsWith(w)))) return nameScore + 10;

  if (!userLocation || typeof cand.lat !== 'number' || typeof cand.lng !== 'number') return nameScore;
  const km = haversineDistanceMiles(userLocation.lat, userLocation.lng, cand.lat, cand.lng) * 1.609344;
  return km > FAR_AWAY_KM ? nameScore - 30 : nameScore;
}

function mapGooglePlaceToCandidate(p: any, fallbackName: string): PlaceCandidate {
  const name = p.displayName?.text || fallbackName;
  const formattedAddress = p.formattedAddress || p.shortFormattedAddress || '';
  const { neighborhood, city } = extractNeighborhoodAndCity(
    formattedAddress,
    p.addressComponents
  );

  const { categories, cuisines, primaryTypeDisplay } = autoCategorizePlace({
    name,
    types: p.types,
    ...extractCountry(p.addressComponents),
    viewportDiagonalKm: viewportDiagonalKm(p.viewport),
    primaryType: p.primaryType,
    primaryTypeDisplayName: p.primaryTypeDisplayName?.text,
    servesBreakfast: p.servesBreakfast,
    servesBrunch: p.servesBrunch,
    servesLunch: p.servesLunch,
    servesDinner: p.servesDinner,
    servesCoffee: p.servesCoffee,
    servesDessert: p.servesDessert,
    servesCocktails: p.servesCocktails,
    servesWine: p.servesWine,
    servesBeer: p.servesBeer,
  });

  const isDestination = categories.some((c) => CATEGORY_GROUP[c] === 'travel');
  return {
    placeId: p.id || `g_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    formattedAddress,
    neighborhood: isDestination ? undefined : neighborhood,
    city: isDestination ? undefined : city,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    googleMapsUri:
      p.googleMapsUri ||
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${name} ${formattedAddress}`
      )}`,
    ...googlePrice(p),
    categories,
    cuisines,
    primaryTypeDisplay,
    source: 'google_places',
  };
}

/** A Places API (New) place's tier and per-person range. */
export function googlePrice(p: { priceLevel?: unknown; priceRange?: unknown }): PriceInfo {
  return {
    priceLevel: typeof p.priceLevel === 'string' ? GOOGLE_PRICE_LEVEL[p.priceLevel] : undefined,
    priceRange: fromGooglePriceRange(p.priceRange),
  };
}

/**
 * Just a place's price, for spots saved before ranges were stored. Asking only for these two
 * Enterprise fields bills as Place Details Enterprise (1,000 free a month, then $20 per 1,000),
 * a separate SKU from search's details calls. Null when worth retrying later (offline, server
 * error, rate limit); `{}` when Google has nothing to give (e.g. a place ID that no longer exists).
 */
export async function fetchPlacePrice(placeId: string, customApiKey?: string): Promise<PriceInfo | null> {
  const apiKey = (customApiKey && customApiKey.trim()) || DEFAULT_PLACES_API_KEY;
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'priceLevel,priceRange' },
    });
    if (res.status === 429 || res.status >= 500) return null;
    if (!res.ok) return {};
    return googlePrice(await res.json());
  } catch {
    return null;
  }
}

async function fetchPlaceDetailsById(
  placeId: string,
  apiKey: string,
  fallbackName: string
): Promise<PlaceCandidate | null> {
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACES_FIELD_MASK.join(','),
      },
    });
    if (!res.ok) return null;
    const p = await res.json();
    return mapGooglePlaceToCandidate(p, fallbackName);
  } catch {
    return null;
  }
}

/**
 * Keeps only candidates that can go in one of the group's lists (or that have no detected list at
 * all, e.g. a landmark: the user picks the list), with the group's categories ordered first.
 */
export function fitCandidatesToGroup(candidates: PlaceCandidate[], group: SpotGroup): PlaceCandidate[] {
  const inGroup = (c: SpotCategory) => CATEGORY_GROUP[c] === group;
  return candidates
    .filter((cand) => cand.categories.length === 0 || cand.categories.some(inGroup))
    .map((cand) => ({
      ...cand,
      categories: [...cand.categories.filter(inGroup), ...cand.categories.filter((c) => !inGroup(c))],
    }));
}

// Autocomplete type filters per group (Explore spans too many types to filter server-side)
const AUTOCOMPLETE_TYPES: Record<SpotGroup, string[] | undefined> = {
  eat: ['restaurant', 'cafe', 'bakery', 'bar', 'food'],
  explore: undefined,
  travel: ['(regions)'],
  watch: undefined, // Titles are searched on TMDB / Google Books (src/lib/media.ts), never as places
  read: undefined,
  play: undefined,
};

/** Lists whose search looks for something other than their group's usual types */
const AUTOCOMPLETE_TYPES_BY_LIST: Partial<Record<SpotCategory, string[]>> = {
  stays: ['hotel', 'resort_hotel', 'lodging', 'bed_and_breakfast', 'hostel'],
};

export async function searchPlaces(
  query: string,
  customApiKey?: string,
  defaultCity?: string,
  userLocation?: UserCoordinates | null,
  group: SpotGroup = 'eat',
  category?: SpotCategory // The list being searched from: its places come first
): Promise<{ results: PlaceCandidate[]; providerUsed: 'google_places' | 'osm_photon' }> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { results: [], providerUsed: 'google_places' };
  }
  // Destinations are searched worldwide; sights are biased to nearby but not to the default city
  // (appending it would break searches like "Louvre")
  if (group !== 'eat') defaultCity = undefined;
  if (group === 'travel') userLocation = null;

  const effectiveQuery =
    defaultCity && !trimmed.toLowerCase().includes(defaultCity.toLowerCase())
      ? `${trimmed} ${defaultCity}`
      : trimmed;

  const apiKey = (customApiKey && customApiKey.trim()) || DEFAULT_PLACES_API_KEY;

  // 1. Query Google Places Autocomplete (for fast prefix/name matching like "boil" -> "Boil & Bake")
  //    AND Google Places Text Search in parallel, then prioritize name matches.
  try {
    const locationBias = userLocation
      ? {
          circle: {
            center: {
              latitude: userLocation.lat,
              longitude: userLocation.lng,
            },
            radius: 30000.0,
          },
        }
      : undefined;

    const autocompleteBody: Record<string, any> = { input: effectiveQuery };
    const autocompleteTypes = (category && AUTOCOMPLETE_TYPES_BY_LIST[category]) || AUTOCOMPLETE_TYPES[group];
    if (autocompleteTypes) autocompleteBody.includedPrimaryTypes = autocompleteTypes;
    if (locationBias) {
      autocompleteBody.locationBias = locationBias;
      autocompleteBody.origin = {
        latitude: userLocation!.lat,
        longitude: userLocation!.lng,
      };
    }

    const searchTextBody: Record<string, any> = {
      textQuery: effectiveQuery,
      maxResultCount: 8,
    };
    if (locationBias) {
      searchTextBody.locationBias = locationBias;
    }

    const [autoRes, textRes] = await Promise.allSettled([
      fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
        },
        body: JSON.stringify(autocompleteBody),
      }),
      fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': PLACES_FIELD_MASK.map((f) => `places.${f}`).join(','),
        },
        body: JSON.stringify(searchTextBody),
      }),
    ]);

    const byId = new Map<string, PlaceCandidate>();
    const autocompleteOrder: string[] = [];

    if (textRes.status === 'fulfilled' && textRes.value.ok) {
      const textData = await textRes.value.json();
      if (Array.isArray(textData.places)) {
        for (const p of textData.places) {
          const cand = mapGooglePlaceToCandidate(p, trimmed);
          byId.set(cand.placeId, cand);
        }
      }
    }

    if (autoRes.status === 'fulfilled' && autoRes.value.ok) {
      const autoData = await autoRes.value.json();
      const suggestions = Array.isArray(autoData.suggestions) ? autoData.suggestions : [];
      const missingPredictions: Array<{ placeId: string; mainText: string; secondaryText: string; types: string[] }> = [];

      for (const s of suggestions) {
        const pred = s.placePrediction;
        if (!pred?.placeId) continue;
        autocompleteOrder.push(pred.placeId);
        if (!byId.has(pred.placeId) && missingPredictions.length < 5) {
          missingPredictions.push({
            placeId: pred.placeId,
            mainText: pred.structuredFormat?.mainText?.text || pred.text?.text || trimmed,
            secondaryText: pred.structuredFormat?.secondaryText?.text || '',
            types: Array.isArray(pred.types) ? pred.types : [],
          });
        }
      }

      if (missingPredictions.length > 0) {
        const detailedList = await Promise.all(
          missingPredictions.map(async (pred) => {
            const detailed = await fetchPlaceDetailsById(pred.placeId, apiKey, pred.mainText);
            if (detailed) return detailed;
            // Instant fallback from prediction metadata if details call fails
            const { neighborhood, city } = extractNeighborhoodAndCity(pred.secondaryText);
            const { categories, cuisines, primaryTypeDisplay } = autoCategorizePlace({
              name: pred.mainText,
              types: pred.types,
            });
            return {
              placeId: pred.placeId,
              name: pred.mainText,
              formattedAddress: pred.secondaryText,
              neighborhood,
              city,
              googleMapsUri: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                `${pred.mainText} ${pred.secondaryText}`
              )}`,
              categories,
              cuisines,
              primaryTypeDisplay,
              source: 'google_places' as const,
            };
          })
        );

        for (const cand of detailedList) {
          byId.set(cand.placeId, cand);
        }
      }
    }

    const fitted = fitCandidatesToGroup(Array.from(byId.values()), group);
    // On the Hotels & Stays list, a hotel beats the city it's in
    const allCandidates = category
      ? [...fitted.filter((c) => c.categories.includes(category)), ...fitted.filter((c) => !c.categories.includes(category))]
      : fitted;
    if (allCandidates.length > 0) {
      // Score each candidate by how well its NAME matches the user's raw query
      const scored = allCandidates.map((cand, originalIdx) => {
        const nameScore = computeNameMatchScore(cand.name, trimmed);
        const autoRank = autocompleteOrder.indexOf(cand.placeId);
        const isFromAutocomplete = autoRank !== -1;
        return {
          cand,
          nameScore,
          score: nameScore > 0 ? locationAdjustedScore(nameScore, cand, trimmed, userLocation) : 0,
          isFromAutocomplete,
          autoRank: isFromAutocomplete ? autoRank : 999,
          originalIdx,
        };
      });

      const hasNameMatches = scored.some((item) => item.nameScore > 0);
      const filtered = hasNameMatches
        ? scored.filter((item) => item.nameScore > 0)
        : scored;

      filtered.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.isFromAutocomplete !== b.isFromAutocomplete) {
          return a.isFromAutocomplete ? -1 : 1;
        }
        if (a.autoRank !== b.autoRank) return a.autoRank - b.autoRank;
        return a.originalIdx - b.originalIdx;
      });

      return {
        results: filtered.slice(0, 8).map((item) => item.cand),
        providerUsed: 'google_places',
      };
    }
  } catch {
    // Fall through to Photon / OpenStreetMap live search
  }

  // 2. Automatic Fallback: OpenStreetMap Photon API (100% free, zero-billing fallback)
  try {
    const locParams = userLocation
      ? `&lat=${userLocation.lat}&lon=${userLocation.lng}`
      : '';
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(effectiveQuery)}&limit=12${locParams}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const features = Array.isArray(data.features) ? data.features : [];

      const candidates: PlaceCandidate[] = [];
      const seenKeys = new Set<string>();

      for (const f of features) {
        const props = f.properties || {};
        const coords = f.geometry?.coordinates || [];
        const name = props.name;
        if (!name) continue;

        const osmKey = props.osm_key || '';
        const osmValue = props.osm_value || '';
        const addressParts = [
          props.housenumber ? `${props.housenumber} ${props.street || ''}`.trim() : props.street,
          props.district || props.suburb || props.locality,
          props.city || props.town || props.county,
          props.state,
        ].filter(Boolean);

        const formattedAddress = addressParts.join(', ');
        const dedupeKey = `${name.toLowerCase()}|${(props.city || props.state || '').toLowerCase()}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        const { categories, cuisines, primaryTypeDisplay } = autoCategorizePlace({
          name,
          osmPlace: osmKey === 'place' ? osmValue : undefined,
          countryCode: props.countrycode,
          countryName: props.country,
          osmAmenity: osmValue,
          osmCuisine: props.cuisine,
          types: osmKey === 'amenity' || osmKey === 'shop' ? [osmValue] : [],
        });

        const lng = typeof coords[0] === 'number' ? coords[0] : undefined;
        const lat = typeof coords[1] === 'number' ? coords[1] : undefined;

        candidates.push({
          placeId: `osm_${props.osm_type || 'N'}${props.osm_id || Math.random().toString(36).slice(2, 8)}`,
          name,
          formattedAddress: formattedAddress || props.country || 'Custom Location',
          neighborhood: props.district || props.suburb || props.locality,
          city: props.city || props.town,
          lat,
          lng,
          googleMapsUri: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            `${name} ${formattedAddress}`
          )}`,
          categories,
          cuisines,
          primaryTypeDisplay,
          source: 'osm_photon',
        });

        if (candidates.length >= 8) break;
      }

      const fitted = fitCandidatesToGroup(candidates, group);
      fitted.sort(
        (a, b) => computeNameMatchScore(b.name, trimmed) - computeNameMatchScore(a.name, trimmed)
      );

      return { results: fitted, providerUsed: 'osm_photon' };
    }
  } catch {
    // Ignore network error
  }

  return { results: [], providerUsed: 'osm_photon' };
}

export function createManualPlaceCandidate(
  name: string,
  city = '',
  group: SpotGroup = 'eat'
): PlaceCandidate {
  const cleanName = name.trim();
  const cleanLoc = city.trim();
  // Keyword detection only knows food; custom sights & destinations go in the list being viewed
  const detected =
    group === 'eat'
      ? autoCategorizePlace({ name: cleanName })
      : { categories: [] as SpotCategory[], cuisines: [] as string[], primaryTypeDisplay: undefined };
  const { categories, cuisines, primaryTypeDisplay } = detected;

  return {
    placeId: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: cleanName,
    formattedAddress: cleanLoc || 'Custom spot',
    city: cleanLoc || undefined,
    googleMapsUri: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${cleanName} ${cleanLoc}`
    )}`,
    categories,
    cuisines,
    primaryTypeDisplay,
    source: 'manual',
  };
}

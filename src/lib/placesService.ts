import { DEFAULT_PLACES_API_KEY } from '../firebase';
import { PlaceCandidate } from '../types';
import { autoCategorizePlace } from './categorizer';
import { UserCoordinates } from './geo';

const GOOGLE_PRICE_MAP: Record<string, number> = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

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

export async function searchRestaurants(
  query: string,
  customApiKey?: string,
  defaultCity?: string,
  userLocation?: UserCoordinates | null
): Promise<{ results: PlaceCandidate[]; providerUsed: 'google_places' | 'osm_photon' }> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { results: [], providerUsed: 'google_places' };
  }

  const effectiveQuery =
    defaultCity && !trimmed.toLowerCase().includes(defaultCity.toLowerCase())
      ? `${trimmed} ${defaultCity}`
      : trimmed;

  const apiKey = (customApiKey && customApiKey.trim()) || DEFAULT_PLACES_API_KEY;

  // 1. Try Google Places API (New) first
  try {
    const fieldMask = [
      'places.id',
      'places.displayName',
      'places.formattedAddress',
      'places.shortFormattedAddress',
      'places.addressComponents',
      'places.location',
      'places.types',
      'places.primaryType',
      'places.primaryTypeDisplayName',
      'places.priceLevel',
      'places.googleMapsUri',
      'places.servesBreakfast',
      'places.servesBrunch',
      'places.servesLunch',
      'places.servesDinner',
      'places.servesCoffee',
      'places.servesDessert',
      'places.servesCocktails',
      'places.servesWine',
      'places.servesBeer',
    ].join(',');

    const requestBody: Record<string, any> = {
      textQuery: effectiveQuery,
      maxResultCount: 8,
    };

    if (userLocation) {
      requestBody.locationBias = {
        circle: {
          center: {
            latitude: userLocation.lat,
            longitude: userLocation.lng,
          },
          radius: 25000.0,
        },
      };
    }

    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data.places) && data.places.length > 0) {
        const candidates: PlaceCandidate[] = data.places.map((p: any) => {
          const name = p.displayName?.text || trimmed;
          const formattedAddress = p.formattedAddress || p.shortFormattedAddress || '';
          const { neighborhood, city } = extractNeighborhoodAndCity(
            formattedAddress,
            p.addressComponents
          );

          const { meals, cuisines, primaryTypeDisplay } = autoCategorizePlace({
            name,
            types: p.types,
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

          return {
            placeId: p.id || `g_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name,
            formattedAddress,
            neighborhood,
            city,
            lat: p.location?.latitude,
            lng: p.location?.longitude,
            googleMapsUri:
              p.googleMapsUri ||
              `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                `${name} ${formattedAddress}`
              )}`,
            priceLevel: p.priceLevel ? GOOGLE_PRICE_MAP[p.priceLevel] : undefined,
            meals,
            cuisines,
            primaryTypeDisplay,
            source: 'google_places',
          };
        });

        return { results: candidates, providerUsed: 'google_places' };
      }
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
        // Prefer food/drink/shop/tourism POIs or named places
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

        const { meals, cuisines, primaryTypeDisplay } = autoCategorizePlace({
          name,
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
          meals,
          cuisines,
          primaryTypeDisplay,
          source: 'osm_photon',
        });

        if (candidates.length >= 8) break;
      }

      return { results: candidates, providerUsed: 'osm_photon' };
    }
  } catch {
    // Ignore network error
  }

  return { results: [], providerUsed: 'osm_photon' };
}

export function createManualPlaceCandidate(name: string, cityOrNeighborhood = ''): PlaceCandidate {
  const cleanName = name.trim();
  const cleanLoc = cityOrNeighborhood.trim();
  const { meals, cuisines, primaryTypeDisplay } = autoCategorizePlace({
    name: cleanName,
  });

  return {
    placeId: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: cleanName,
    formattedAddress: cleanLoc || 'Custom spot',
    neighborhood: cleanLoc || undefined,
    city: cleanLoc || undefined,
    googleMapsUri: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${cleanName} ${cleanLoc}`
    )}`,
    meals,
    cuisines,
    primaryTypeDisplay,
    source: 'manual',
  };
}

export interface UserCoordinates {
  lat: number;
  lng: number;
}

export const CITY_FALLBACK_COORDS: Record<string, [number, number]> = {
  'san francisco': [37.7749, -122.4194],
  'new york': [40.7128, -74.006],
  brooklyn: [40.7181, -73.9571],
  'los angeles': [34.0522, -118.2437],
  chicago: [41.8781, -87.6298],
  seattle: [47.6062, -122.3321],
  austin: [30.2672, -97.7431],
  boston: [42.3601, -71.0589],
  tokyo: [35.6762, 139.6503],
  london: [51.5072, -0.1276],
  paris: [48.8566, 2.3522],
};

export function resolveItemCoords(
  item: { lat?: number; lng?: number; city?: string; formattedAddress?: string },
  offsetIndex = 0
): [number, number] | null {
  if (
    typeof item.lat === 'number' &&
    typeof item.lng === 'number' &&
    !Number.isNaN(item.lat) &&
    !Number.isNaN(item.lng)
  ) {
    return [item.lat, item.lng];
  }

  const hay = `${item.city || ''} ${item.formattedAddress || ''}`.toLowerCase();
  for (const [key, coords] of Object.entries(CITY_FALLBACK_COORDS)) {
    if (hay.includes(key)) {
      if (offsetIndex === 0) return coords;
      const angle = (offsetIndex * 137.5 * Math.PI) / 180;
      const radius = 0.004 * Math.sqrt(offsetIndex + 1);
      return [coords[0] + radius * Math.cos(angle), coords[1] + radius * Math.sin(angle)];
    }
  }
  return null;
}

export function haversineDistanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function getItemDistanceMiles(
  item: { lat?: number; lng?: number; city?: string; formattedAddress?: string },
  userLoc?: UserCoordinates | null
): number | null {
  if (!userLoc) return null;
  const coords = resolveItemCoords(item, 0);
  if (!coords) return null;
  return haversineDistanceMiles(userLoc.lat, userLoc.lng, coords[0], coords[1]);
}

export function formatDistanceMiles(miles: number | null | undefined): string | null {
  if (miles === null || miles === undefined || Number.isNaN(miles)) return null;
  if (miles < 0.1) return '<0.1 mi';
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  if (miles < 100) return `${Math.round(miles)} mi`;
  return null; // Don't clutter with "2,500 mi" for another coast unless sorted by nearest
}

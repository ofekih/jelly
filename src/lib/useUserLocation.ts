import { useCallback, useState } from 'react';
import { UserCoordinates } from './geo';

const SESSION_COORDS_KEY = 'jelly_user_coords_v1';

function readCachedCoords(): UserCoordinates | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_COORDS_KEY) || 'null');
    if (typeof parsed?.lat === 'number' && typeof parsed?.lng === 'number') return parsed;
  } catch {
    // Ignore
  }
  return null;
}

export interface LocationRequest {
  /** No toast when location is unsupported or denied */
  silent?: boolean;
  deniedMessage?: string;
  onDone?: (located: boolean) => void;
}

/** The device's position, cached for the session so reloads don't wait on GPS. */
export function useUserLocation(showToast: (message: string) => void) {
  const [userLocation, setUserLocation] = useState<UserCoordinates | null>(readCachedCoords);

  const requestUserLocation = useCallback(
    ({
      silent,
      deniedMessage = 'Enable location permissions in your browser to sort by nearest',
      onDone,
    }: LocationRequest = {}) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        if (!silent) showToast('Location access is not supported by your browser');
        onDone?.(false);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords: UserCoordinates = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserLocation(coords);
          try {
            sessionStorage.setItem(SESSION_COORDS_KEY, JSON.stringify(coords));
          } catch {
            // Ignore
          }
          onDone?.(true);
        },
        () => {
          if (!silent) showToast(deniedMessage);
          onDone?.(false);
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
      );
    },
    [showToast]
  );

  return { userLocation, requestUserLocation };
}

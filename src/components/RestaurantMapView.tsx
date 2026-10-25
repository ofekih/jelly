import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PLACES_API_KEY } from '../firebase';
import { Bookmark, ExternalMapLinkIcon, LocateFixed, Navigation, Sparkles } from './MapIcons';
import { BookmarkEntry, RestaurantEntry } from '../types';
import {
  formatDistanceMiles,
  getItemDistanceMiles,
  haversineDistanceMiles,
  resolveItemCoords,
  UserCoordinates,
} from '../lib/geo';
import { ScoreBadge } from './ScoreBadge';
import { spotPrice } from '../lib/groups';

declare global {
  interface Window {
    google?: any;
    gm_authFailure?: () => void;
  }
}

interface RestaurantMapViewProps {
  mode: 'ranked' | 'want_to_try';
  restaurants: RestaurantEntry[];
  bookmarks: BookmarkEntry[];
  darkMode: boolean;
  userLocation?: UserCoordinates | null;
  selectedCity?: string | 'ALL';
  worldScale?: boolean; // Destinations: frame all pins at country/continent zoom, never "near me"
  onRequestLocation?: () => void;
  onSelectSpot: (spot: RestaurantEntry) => void;
  onRankBookmark: (bookmark: BookmarkEntry) => void;
}

const GOOGLE_LIGHT_MAP_STYLES = [
  {
    featureType: 'poi',
    elementType: 'labels.icon',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'poi.business',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'poi.medical',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'poi.place_of_worship',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'poi.school',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'transit',
    elementType: 'labels.icon',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'transit.station.bus',
    stylers: [{ visibility: 'off' }],
  },
];

const GOOGLE_DARK_MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#18181b' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#18181b' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a1a1aa' }] },
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#e4e4e7' }],
  },
  {
    featureType: 'administrative.neighborhood',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#a1a1aa' }],
  },
  {
    featureType: 'poi',
    elementType: 'labels.icon',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'poi.business',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'poi.medical',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'poi.school',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#14261f' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#6ee7b7' }],
  },
  {
    featureType: 'transit',
    elementType: 'labels.icon',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#27272a' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#18181b' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#71717a' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#3f3f46' }],
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#27272a' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#090d16' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#52525b' }],
  },
];

let googleMapsPromise: Promise<any> | null = null;

function loadGoogleMapsSdk(): Promise<any> {
  if (typeof window !== 'undefined' && window.google?.maps?.Map && window.google?.maps?.OverlayView) {
    return Promise.resolve(window.google.maps);
  }
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById('jelly-google-maps-sdk') as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener('load', () => {
        if (window.google?.maps) resolve(window.google.maps);
        else reject(new Error('Google Maps failed to initialize'));
      });
      existingScript.addEventListener('error', () => reject(new Error('Google Maps script error')));
      return;
    }

    const script = document.createElement('script');
    script.id = 'jelly-google-maps-sdk';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      DEFAULT_PLACES_API_KEY
    )}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.maps) {
        resolve(window.google.maps);
      } else {
        reject(new Error('Google Maps SDK unavailable after load'));
      }
    };
    script.onerror = () => {
      googleMapsPromise = null;
      reject(new Error('Failed to load Google Maps JS SDK'));
    };
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

function getEntryCoords(
  item: { id: string; lat?: number; lng?: number; city?: string; formattedAddress?: string },
  idx: number
): [number, number] | null {
  if (
    typeof item.lat === 'number' &&
    typeof item.lng === 'number' &&
    !Number.isNaN(item.lat) &&
    !Number.isNaN(item.lng)
  ) {
    return [item.lat, item.lng];
  }

  const fallback = resolveItemCoords(item);
  if (fallback) {
    // Deterministic tiny offset so multiple fallback pins in the same city don't overlap
    const angle = (idx * 137.5 * Math.PI) / 180;
    const radius = 0.004 * Math.sqrt(idx + 1);
    return [fallback[0] + radius * Math.cos(angle), fallback[1] + radius * Math.sin(angle)];
  }
  return null;
}

function getPinColors(score: number): { bg: string; border: string; text: string } {
  if (score >= 9.0) {
    return { bg: '#059669', border: '#6ee7b7', text: '#ffffff' };
  }
  if (score >= 7.8) {
    return { bg: '#0d9488', border: '#5eead4', text: '#ffffff' };
  }
  if (score >= 6.5) {
    return { bg: '#d97706', border: '#fcd34d', text: '#ffffff' };
  }
  return { bg: '#e11d48', border: '#fda4af', text: '#ffffff' };
}

function createHtmlOverlay(
  gmaps: any,
  position: { lat: number; lng: number },
  html: string,
  zIndex: number,
  onClick?: () => void
) {
  class HtmlPinOverlay extends gmaps.OverlayView {
    private div: HTMLDivElement | null = null;

    onAdd() {
      const div = document.createElement('div');
      div.style.position = 'absolute';
      div.style.zIndex = String(zIndex);
      div.style.userSelect = 'none';
      div.innerHTML = html;

      if (onClick) {
        div.style.cursor = 'pointer';
        div.addEventListener('click', (e) => {
          e.stopPropagation();
          onClick();
        });
      }

      this.div = div;
      const panes = this.getPanes();
      panes?.overlayMouseTarget?.appendChild(div);
    }

    draw() {
      if (!this.div) return;
      const projection = this.getProjection();
      if (!projection) return;
      const point = projection.fromLatLngToDivPixel(new gmaps.LatLng(position.lat, position.lng));
      if (point) {
        this.div.style.left = `${point.x}px`;
        this.div.style.top = `${point.y}px`;
      }
    }

    onRemove() {
      if (this.div && this.div.parentNode) {
        this.div.parentNode.removeChild(this.div);
      }
      this.div = null;
    }
  }

  return new HtmlPinOverlay();
}

export const RestaurantMapView: React.FC<RestaurantMapViewProps> = ({
  mode,
  restaurants,
  bookmarks,
  darkMode,
  userLocation,
  selectedCity = 'ALL',
  worldScale = false,
  onRequestLocation,
  onSelectSpot,
  onRankBookmark,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any | null>(null);
  const gmapsRef = useRef<any | null>(null);
  const overlaysRef = useRef<any[]>([]);

  const [sdkReady, setSdkReady] = useState(false);
  const [selectedRanked, setSelectedRanked] = useState<RestaurantEntry | null>(null);
  const [selectedBookmark, setSelectedBookmark] = useState<BookmarkEntry | null>(null);

  const plottedRanked = useMemo(() => {
    return restaurants
      .map((r, idx) => {
        const coords = getEntryCoords(r, idx);
        return coords ? { entry: r, coords } : null;
      })
      .filter((x): x is { entry: RestaurantEntry; coords: [number, number] } => x !== null);
  }, [restaurants]);

  const plottedBookmarks = useMemo(() => {
    return bookmarks
      .map((b, idx) => {
        const coords = getEntryCoords(b, idx);
        return coords ? { entry: b, coords } : null;
      })
      .filter((x): x is { entry: BookmarkEntry; coords: [number, number] } => x !== null);
  }, [bookmarks]);

  // Initialize Google Map
  useEffect(() => {
    let cancelled = false;

    loadGoogleMapsSdk()
      .then((gmaps) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        gmapsRef.current = gmaps;

        const initialCenter = userLocation
          ? { lat: userLocation.lat, lng: userLocation.lng }
          : { lat: 37.7749, lng: -122.4194 };

        const map = new gmaps.Map(containerRef.current, {
          center: initialCenter,
          zoom: 13,
          disableDefaultUI: true,
          zoomControl: true,
          zoomControlOptions: {
            position: gmaps.ControlPosition.RIGHT_TOP,
          },
          gestureHandling: 'greedy',
          clickableIcons: false,
          styles: darkMode ? GOOGLE_DARK_MAP_STYLES : GOOGLE_LIGHT_MAP_STYLES,
        });

        map.addListener('click', () => {
          setSelectedRanked(null);
          setSelectedBookmark(null);
        });

        mapRef.current = map;
        setSdkReady(true);
      })
      .catch((err) => {
        console.error('Error loading Google Maps:', err);
      });

    return () => {
      cancelled = true;
      overlaysRef.current.forEach((ov) => ov.setMap(null));
      overlaysRef.current = [];
      mapRef.current = null;
    };
    // Creates the map once; later theme and position changes are applied by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update dark/light map style dynamically
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setOptions({
      styles: darkMode ? GOOGLE_DARK_MAP_STYLES : GOOGLE_LIGHT_MAP_STYLES,
    });
  }, [darkMode, sdkReady]);

  // Render custom HTML pins and fit bounds
  useEffect(() => {
    const map = mapRef.current;
    const gmaps = gmapsRef.current;
    if (!map || !gmaps || !sdkReady) return;

    overlaysRef.current.forEach((ov) => ov.setMap(null));
    overlaysRef.current = [];
    setSelectedRanked(null);
    setSelectedBookmark(null);

    const boundsPoints: [number, number][] = [];

    // 1. Pulsing blue "You Are Here" marker
    if (userLocation) {
      const userHtml = `
        <div
          title="You are here"
          style="
            position: relative;
            width: 24px;
            height: 24px;
            transform: translate(-50%, -50%);
            display: flex;
            align-items: center;
            justify-content: center;
          "
        >
          <div style="
            position: absolute;
            inset: 0;
            border-radius: 9999px;
            background: rgba(59, 130, 246, 0.28);
          "></div>
          <div style="
            width: 13px;
            height: 13px;
            border-radius: 9999px;
            background: #3b82f6;
            border: 2.5px solid #ffffff;
            box-shadow: 0 2px 6px rgba(37, 99, 235, 0.55);
          "></div>
        </div>
      `;
      const userOverlay = createHtmlOverlay(
        gmaps,
        { lat: userLocation.lat, lng: userLocation.lng },
        userHtml,
        20000
      );
      userOverlay.setMap(map);
      overlaysRef.current.push(userOverlay);
    }

    // 2. Ranked or Want-to-Try pins
    if (mode === 'ranked') {
      plottedRanked.forEach(({ entry, coords }) => {
        boundsPoints.push(coords);
        const colors = getPinColors(entry.magicScore);
        const html = `
          <div style="
            display: flex;
            flex-direction: column;
            align-items: center;
            transform: translate(-50%, -50%);
            cursor: pointer;
          ">
            <div style="
              width: 34px;
              height: 34px;
              border-radius: 9999px;
              background: ${colors.bg};
              border: 2px solid ${colors.border};
              color: ${colors.text};
              font-family: Inter, system-ui, sans-serif;
              font-weight: 800;
              font-size: 11px;
              display: flex;
              align-items: center;
              justify-content: center;
              box-shadow: 0 4px 12px rgba(0,0,0,0.32);
            ">
              ${entry.magicScore.toFixed(1)}
            </div>
            <div style="
              margin-top: 2px;
              padding: 1px 6px;
              border-radius: 9999px;
              background: ${darkMode ? 'rgba(24,24,27,0.92)' : 'rgba(255,255,255,0.94)'};
              color: ${darkMode ? '#f4f4f5' : '#18181b'};
              font-family: Inter, system-ui, sans-serif;
              font-weight: 600;
              font-size: 10px;
              white-space: nowrap;
              max-width: 115px;
              overflow: hidden;
              text-overflow: ellipsis;
              box-shadow: 0 1px 4px rgba(0,0,0,0.18);
            ">
              ${entry.name.replace(/</g, '&lt;')}
            </div>
          </div>
        `;

        const overlay = createHtmlOverlay(
          gmaps,
          { lat: coords[0], lng: coords[1] },
          html,
          Math.max(10, 1000 - entry.rankIndex),
          () => {
            setSelectedBookmark(null);
            setSelectedRanked(entry);
            map.panTo({ lat: coords[0], lng: coords[1] });
          }
        );
        overlay.setMap(map);
        overlaysRef.current.push(overlay);
      });
    } else {
      plottedBookmarks.forEach(({ entry, coords }) => {
        boundsPoints.push(coords);
        const html = `
          <div style="
            display: flex;
            flex-direction: column;
            align-items: center;
            transform: translate(-50%, -50%);
            cursor: pointer;
          ">
            <div style="
              width: 32px;
              height: 32px;
              border-radius: 9999px;
              background: #f43f5e;
              border: 2px solid #fda4af;
              color: #ffffff;
              font-family: Inter, system-ui, sans-serif;
              font-weight: 800;
              font-size: 13px;
              display: flex;
              align-items: center;
              justify-content: center;
              box-shadow: 0 4px 12px rgba(0,0,0,0.32);
            ">
              ★
            </div>
            <div style="
              margin-top: 2px;
              padding: 1px 6px;
              border-radius: 9999px;
              background: ${darkMode ? 'rgba(24,24,27,0.92)' : 'rgba(255,255,255,0.94)'};
              color: ${darkMode ? '#f4f4f5' : '#18181b'};
              font-family: Inter, system-ui, sans-serif;
              font-weight: 600;
              font-size: 10px;
              white-space: nowrap;
              max-width: 115px;
              overflow: hidden;
              text-overflow: ellipsis;
              box-shadow: 0 1px 4px rgba(0,0,0,0.18);
            ">
              ${entry.name.replace(/</g, '&lt;')}
            </div>
          </div>
        `;

        const overlay = createHtmlOverlay(
          gmaps,
          { lat: coords[0], lng: coords[1] },
          html,
          500,
          () => {
            setSelectedRanked(null);
            setSelectedBookmark(entry);
            map.panTo({ lat: coords[0], lng: coords[1] });
          }
        );
        overlay.setMap(map);
        overlaysRef.current.push(overlay);
      });
    }

    const maxZoom = worldScale ? 6 : 15;
    const fitPoints = (pts: [number, number][]) => {
      if (pts.length === 1) {
        map.setCenter({ lat: pts[0][0], lng: pts[0][1] });
        map.setZoom(worldScale ? 5 : 14);
        return;
      }
      if (pts.length > 1) {
        const bounds = new gmaps.LatLngBounds();
        pts.forEach((p) => bounds.extend({ lat: p[0], lng: p[1] }));
        map.fitBounds(bounds, 48);
        const listener = gmaps.event.addListenerOnce(map, 'idle', () => {
          if (map.getZoom() > maxZoom) map.setZoom(maxZoom);
          gmaps.event.removeListener(listener);
        });
      }
    };

    if (worldScale) {
      if (boundsPoints.length > 0) {
        fitPoints(boundsPoints);
      } else {
        map.setCenter({ lat: 20, lng: 0 });
        map.setZoom(2);
      }
      return;
    }

    if (userLocation && selectedCity === 'ALL') {
      const nearbyPoints = boundsPoints.filter(
        (pt) => haversineDistanceMiles(userLocation.lat, userLocation.lng, pt[0], pt[1]) <= 50
      );
      if (nearbyPoints.length > 0) {
        fitPoints([[userLocation.lat, userLocation.lng], ...nearbyPoints]);
        return;
      }
      if (boundsPoints.length === 0) {
        map.setCenter({ lat: userLocation.lat, lng: userLocation.lng });
        map.setZoom(13);
        return;
      }
    }

    // If All Cities is selected and spots span multiple distant cities (>100 miles apart),
    // start framed around the primary/closest city cluster rather than zooming out to a continent view
    if (selectedCity === 'ALL' && boundsPoints.length > 1) {
      const anchor = userLocation
        ? [...boundsPoints].sort(
            (a, b) =>
              haversineDistanceMiles(userLocation.lat, userLocation.lng, a[0], a[1]) -
              haversineDistanceMiles(userLocation.lat, userLocation.lng, b[0], b[1])
          )[0]
        : boundsPoints[0];
      const cluster = boundsPoints.filter(
        (pt) => haversineDistanceMiles(anchor[0], anchor[1], pt[0], pt[1]) <= 50
      );
      if (cluster.length > 0 && cluster.length < boundsPoints.length) {
        fitPoints(cluster);
        return;
      }
    }

    fitPoints(boundsPoints);
  }, [mode, plottedRanked, plottedBookmarks, darkMode, userLocation, selectedCity, worldScale, sdkReady]);

  const handleLocateMeClick = () => {
    const map = mapRef.current;
    if (userLocation && map) {
      map.panTo({ lat: userLocation.lat, lng: userLocation.lng });
      map.setZoom(14);
    } else if (onRequestLocation) {
      onRequestLocation();
    }
  };

  const totalCount = mode === 'ranked' ? plottedRanked.length : plottedBookmarks.length;

  return (
    <div className="relative isolate z-0 w-full h-[64vh] min-h-[400px] max-h-[620px] rounded-2xl overflow-hidden border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-100 dark:bg-zinc-900 shadow-2xs">
      <div ref={containerRef} className="w-full h-full z-0" />

      {/* Count Pill */}
      <div className="absolute top-3 left-3 z-[400] px-3 py-1.5 rounded-full bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border border-zinc-200/80 dark:border-zinc-800 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 shadow-xs flex items-center gap-1.5">
        <Navigation className="w-3 h-3 text-emerald-500" />
        <span>
          {totalCount} {totalCount === 1 ? 'spot' : 'spots'} on map
        </span>
      </div>

      {/* Locate Me Button */}
      <button
        type="button"
        onClick={handleLocateMeClick}
        className={`absolute top-24 right-2.5 z-[400] w-9 h-9 rounded-lg bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border border-zinc-200/80 dark:border-zinc-800 shadow-sm flex items-center justify-center transition-colors ${
          userLocation
            ? 'text-blue-600 dark:text-blue-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
        }`}
        title={userLocation ? 'Center on my location' : 'Use my location'}
        aria-label="Center on my location"
      >
        <LocateFixed className="w-4 h-4" />
      </button>

      {/* Selected Ranked Spot Preview Card */}
      {selectedRanked && (
        <div className="absolute bottom-6 left-3 right-3 z-[400] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md rounded-2xl p-3.5 border border-zinc-200/80 dark:border-zinc-800 shadow-xl flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onSelectSpot(selectedRanked)}
            className="min-w-0 flex-1 text-left"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-zinc-400 dark:text-zinc-500 tabular-nums">
                #{selectedRanked.rankIndex + 1}
              </span>
              <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate">
                {selectedRanked.name}
              </span>
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
              {[
                selectedRanked.cuisines[0] || selectedRanked.primaryTypeDisplay,
                spotPrice(selectedRanked, selectedRanked.category),
                selectedRanked.neighborhood || selectedRanked.city,
                (() => {
                  const dist = getItemDistanceMiles(selectedRanked, userLocation);
                  return dist !== null ? formatDistanceMiles(dist) : null;
                })(),
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            {selectedRanked.googleMapsUri && (
              <a
                href={selectedRanked.googleMapsUri}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                title="Open in Google Maps"
              >
                <ExternalMapLinkIcon className="w-4 h-4" />
              </a>
            )}
            <button
              type="button"
              onClick={() => onSelectSpot(selectedRanked)}
              className="focus:outline-none"
            >
              <ScoreBadge score={selectedRanked.magicScore} size="md" />
            </button>
          </div>
        </div>
      )}

      {/* Selected Bookmark Spot Preview Card */}
      {selectedBookmark && (
        <div className="absolute bottom-6 left-3 right-3 z-[400] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md rounded-2xl p-3.5 border border-zinc-200/80 dark:border-zinc-800 shadow-xl flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Bookmark className="w-3.5 h-3.5 text-rose-500 fill-rose-500 shrink-0" />
              <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate">
                {selectedBookmark.name}
              </span>
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
              {[
                selectedBookmark.cuisines[0] || selectedBookmark.primaryTypeDisplay,
                spotPrice(selectedBookmark, selectedBookmark.category),
                selectedBookmark.neighborhood || selectedBookmark.city,
                (() => {
                  const dist = getItemDistanceMiles(selectedBookmark, userLocation);
                  return dist !== null ? formatDistanceMiles(dist) : null;
                })(),
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onRankBookmark(selectedBookmark)}
            className="px-3 py-1.5 rounded-full bg-zinc-900 dark:bg-emerald-500 text-white dark:text-zinc-950 text-xs font-bold flex items-center gap-1 shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Rank</span>
          </button>
        </div>
      )}
    </div>
  );
};

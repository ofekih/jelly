import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Bookmark, ExternalMapLinkIcon, Navigation, Sparkles } from './MapIcons';
import { BookmarkEntry, RestaurantEntry } from '../types';
import { ScoreBadge } from './ScoreBadge';

interface RestaurantMapViewProps {
  mode: 'ranked' | 'want_to_try';
  restaurants: RestaurantEntry[];
  bookmarks: BookmarkEntry[];
  darkMode: boolean;
  onSelectSpot: (spot: RestaurantEntry) => void;
  onRankBookmark: (bookmark: BookmarkEntry) => void;
}

const CITY_FALLBACK_COORDS: Record<string, [number, number]> = {
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

  const hay = `${item.city || ''} ${item.formattedAddress || ''}`.toLowerCase();
  for (const [key, coords] of Object.entries(CITY_FALLBACK_COORDS)) {
    if (hay.includes(key)) {
      // Deterministic tiny offset so multiple fallback pins in the same city don't overlap
      const angle = (idx * 137.5 * Math.PI) / 180;
      const radius = 0.004 * Math.sqrt(idx + 1);
      return [coords[0] + radius * Math.cos(angle), coords[1] + radius * Math.sin(angle)];
    }
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

export const RestaurantMapView: React.FC<RestaurantMapViewProps> = ({
  mode,
  restaurants,
  bookmarks,
  darkMode,
  onSelectSpot,
  onRankBookmark,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

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

  // Initialize Leaflet Map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [37.7749, -122.4194],
      zoom: 12,
      zoomControl: false,
      attributionControl: false,
    });

    L.control.zoom({ position: 'topright' }).addTo(map);

    const tileUrl = darkMode
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

    const tileLayer = L.tileLayer(tileUrl, {
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map);

    const markersGroup = L.layerGroup().addTo(map);

    mapRef.current = map;
    tileLayerRef.current = tileLayer;
    markersLayerRef.current = markersGroup;

    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      markersLayerRef.current = null;
    };
  }, []);

  // Update tile layer when dark mode changes
  useEffect(() => {
    if (!tileLayerRef.current) return;
    const tileUrl = darkMode
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    tileLayerRef.current.setUrl(tileUrl);
  }, [darkMode]);

  // Render markers and fit bounds
  useEffect(() => {
    const map = mapRef.current;
    const markersGroup = markersLayerRef.current;
    if (!map || !markersGroup) return;

    markersGroup.clearLayers();
    setSelectedRanked(null);
    setSelectedBookmark(null);

    const boundsPoints: [number, number][] = [];

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
              box-shadow: 0 4px 12px rgba(0,0,0,0.28);
            ">
              ${entry.magicScore.toFixed(1)}
            </div>
            <div style="
              margin-top: 2px;
              padding: 1px 6px;
              border-radius: 9999px;
              background: ${darkMode ? 'rgba(24,24,27,0.9)' : 'rgba(255,255,255,0.92)'};
              color: ${darkMode ? '#f4f4f5' : '#18181b'};
              font-family: Inter, system-ui, sans-serif;
              font-weight: 600;
              font-size: 10px;
              white-space: nowrap;
              max-width: 110px;
              overflow: hidden;
              text-overflow: ellipsis;
              box-shadow: 0 1px 4px rgba(0,0,0,0.15);
            ">
              ${entry.name.replace(/</g, '&lt;')}
            </div>
          </div>
        `;

        const icon = L.divIcon({
          className: 'jelly-map-pin',
          html,
          iconSize: [0, 0],
        });

        const marker = L.marker(coords, { icon });
        marker.on('click', () => {
          setSelectedBookmark(null);
          setSelectedRanked(entry);
          map.panTo(coords, { animate: true });
        });
        marker.addTo(markersGroup);
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
              box-shadow: 0 4px 12px rgba(0,0,0,0.28);
            ">
              ★
            </div>
            <div style="
              margin-top: 2px;
              padding: 1px 6px;
              border-radius: 9999px;
              background: ${darkMode ? 'rgba(24,24,27,0.9)' : 'rgba(255,255,255,0.92)'};
              color: ${darkMode ? '#f4f4f5' : '#18181b'};
              font-family: Inter, system-ui, sans-serif;
              font-weight: 600;
              font-size: 10px;
              white-space: nowrap;
              max-width: 110px;
              overflow: hidden;
              text-overflow: ellipsis;
              box-shadow: 0 1px 4px rgba(0,0,0,0.15);
            ">
              ${entry.name.replace(/</g, '&lt;')}
            </div>
          </div>
        `;

        const icon = L.divIcon({
          className: 'jelly-map-pin',
          html,
          iconSize: [0, 0],
        });

        const marker = L.marker(coords, { icon });
        marker.on('click', () => {
          setSelectedRanked(null);
          setSelectedBookmark(entry);
          map.panTo(coords, { animate: true });
        });
        marker.addTo(markersGroup);
      });
    }

    if (boundsPoints.length === 1) {
      map.setView(boundsPoints[0], 14);
    } else if (boundsPoints.length > 1) {
      const bounds = L.latLngBounds(boundsPoints);
      map.fitBounds(bounds, { padding: [44, 44], maxZoom: 15 });
    }
  }, [mode, plottedRanked, plottedBookmarks, darkMode]);

  const totalCount = mode === 'ranked' ? plottedRanked.length : plottedBookmarks.length;

  return (
    <div className="relative w-full h-[64vh] min-h-[400px] max-h-[620px] rounded-2xl overflow-hidden border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-100 dark:bg-zinc-900 shadow-2xs">
      <div ref={containerRef} className="w-full h-full z-0" />

      {/* Count Pill */}
      <div className="absolute top-3 left-3 z-[400] px-3 py-1.5 rounded-full bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border border-zinc-200/80 dark:border-zinc-800 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 shadow-xs flex items-center gap-1.5">
        <Navigation className="w-3 h-3 text-emerald-500" />
        <span>
          {totalCount} {totalCount === 1 ? 'spot' : 'spots'} on map
        </span>
      </div>

      {/* Selected Ranked Spot Preview Card */}
      {selectedRanked && (
        <div className="absolute bottom-3 left-3 right-3 z-[400] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md rounded-2xl p-3.5 border border-zinc-200/80 dark:border-zinc-800 shadow-xl flex items-center justify-between gap-3">
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
                selectedRanked.meal,
                selectedRanked.cuisines[0] || selectedRanked.primaryTypeDisplay,
                selectedRanked.neighborhood || selectedRanked.city,
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
        <div className="absolute bottom-3 left-3 right-3 z-[400] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md rounded-2xl p-3.5 border border-zinc-200/80 dark:border-zinc-800 shadow-xl flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Bookmark className="w-3.5 h-3.5 text-rose-500 fill-rose-500 shrink-0" />
              <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate">
                {selectedBookmark.name}
              </span>
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
              {[
                selectedBookmark.meal,
                selectedBookmark.cuisines[0] || selectedBookmark.primaryTypeDisplay,
                selectedBookmark.neighborhood || selectedBookmark.city,
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

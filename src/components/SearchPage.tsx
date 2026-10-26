import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, ChevronRight, Clock, Globe, Loader2, MapPin, Navigation, Plus, Search, X } from 'lucide-react';
import {
  ALL_GROUPS,
  CATEGORY_EMOJI,
  CATEGORY_GROUP,
  GROUP_EMOJI,
  GROUP_LABEL,
  PlaceCandidate,
  RestaurantEntry,
  SharedListPayload,
  SpotCategory,
  SpotGroup,
} from '../types';
import { takePrimedText } from '../lib/keyboardPrime';
import { createManualPlaceCandidate, searchPlaces } from '../lib/placesService';
import { hasSquareCover, posterUrl, searchTitles, spotPlaceLabel } from '../lib/media';
import { GROUP_COPY, searchPlaceholder, spotPrice, wantLabel } from '../lib/groups';
import { SEARCH_SCOPES, categoryOptions, findRankedInGroup, searchCategoryFor } from '../lib/addFlow';
import { addRecentSearch, clearRecentSearches, recentSearches } from '../lib/recentSearches';
import { getFriendMatchesForSpot, getSpotSocialMetrics } from '../lib/friendsService';
import { placeStatKey } from '../lib/socialService';
import { usePlaceStats } from '../lib/usePlaceStats';
import { usePredictions } from '../lib/usePredictions';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import { useVisualViewportBox } from '../lib/useVisualViewport';
import {
  formatDistanceMiles,
  getItemDistanceMiles,
  homeCoords,
  resolveManualSpotCity,
  UserCoordinates,
} from '../lib/geo';
import { trackEvent } from '../firebase';
import { PosterThumb, TitleCredit } from './PosterThumb';

type LocationChoice = { kind: 'nearby' } | { kind: 'city'; city: string };

export interface SearchPageProps {
  /** False while it animates out */
  visible: boolean;
  /** Covered by the place page or the rating sheet: out of the tab order and accessibility tree */
  covered: boolean;
  /** The list being viewed on the main screen: the search starts in its group */
  initialCategory: SpotCategory;
  existingRestaurants: RestaurantEntry[];
  myUid?: string | null;
  bookmarkedPlaceIds?: Set<string>;
  friendLists?: SharedListPayload[];
  defaultCity?: string;
  customPlacesApiKey?: string;
  userLocation?: UserCoordinates | null;
  onClose: () => void;
  /** Row body: look it up without ranking it */
  onOpenPlace: (candidate: PlaceCandidate, searchCategory: SpotCategory) => void;
  onRank: (candidate: PlaceCandidate, searchCategory: SpotCategory) => void;
  /** Adds to or removes from the want-to-try list (whichever applies) */
  onToggleBookmark?: (candidate: PlaceCandidate, searchCategory: SpotCategory) => void;
}

/**
 * The add flow's search, as a full-screen page that rises from the bottom (✕ or Back closes it).
 * Top to bottom: which group to search, the search box, where to search (place groups), results.
 * Sized to the visible viewport so the iOS keyboard never pushes the top bar off screen and the
 * results scroll above the keyboard.
 */
export const SearchPage: React.FC<SearchPageProps> = ({
  visible,
  covered,
  initialCategory,
  existingRestaurants,
  myUid = null,
  bookmarkedPlaceIds,
  friendLists = [],
  defaultCity = '',
  customPlacesApiKey = '',
  userLocation = null,
  onClose,
  onOpenPlace,
  onRank,
  onToggleBookmark,
}) => {
  useBodyScrollLock();
  const viewportBox = useVisualViewportBox();
  const [category, setCategory] = useState<SpotCategory>(initialCategory);
  const group = CATEGORY_GROUP[category];
  const copy = GROUP_COPY[group];
  const isTitles = !copy.hasLocation;
  const scopes = SEARCH_SCOPES[group];

  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  const [results, setResults] = useState<PlaceCandidate[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [recents, setRecents] = useState<string[]>(() => recentSearches(group));
  useEffect(() => setRecents(recentSearches(group)), [group]);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Focus the box on open. On phones App's add button already raised the keyboard with a stand-in
  // input (see keyboardPrime.ts); moving the focus here keeps it up.
  useEffect(() => {
    const typed = takePrimedText();
    if (typed) setQuery(typed);
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // Where to search: live location, else the account's default city for food, else near your spots
  const [locationChoice, setLocationChoice] = useState<LocationChoice | null>(null);
  const [locationPanelOpen, setLocationPanelOpen] = useState(false);
  const [cityDraft, setCityDraft] = useState('');
  const defaultChoice: LocationChoice =
    !userLocation && group === 'eat' && defaultCity.trim() ? { kind: 'city', city: defaultCity.trim() } : { kind: 'nearby' };
  const location = locationChoice ?? defaultChoice;
  // Without live location, bias toward where your own spots are (not trips)
  const spotsHome = useMemo(
    () => homeCoords(existingRestaurants.filter((r) => CATEGORY_GROUP[r.category] !== 'travel')),
    [existingRestaurants]
  );
  const searchLocation = userLocation ?? spotsHome;
  const nearbyLabel = userLocation ? 'Near you' : spotsHome ? 'Near your spots' : 'Anywhere';
  const showLocation = copy.hasLocation && group !== 'travel';
  const locationKey = location.kind === 'city' ? `city:${location.city}` : 'nearby';

  useEffect(() => {
    if (trimmed.length < 2) {
      setResults([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    const timer = setTimeout(async () => {
      const city = locationKey.startsWith('city:') ? locationKey.slice(5) : '';
      const { results: found, error } = isTitles
        ? await searchTitles(trimmed, category)
        : {
            ...(await searchPlaces(
              trimmed,
              customPlacesApiKey,
              city || undefined,
              // A chosen city replaces the location bias, except the default city, which keeps the old pairing
              city && city !== defaultCity.trim() ? null : searchLocation,
              group,
              category,
              { cityChosen: Boolean(city) }
            )),
            error: undefined,
          };
      if (cancelled) return;
      setResults(found);
      setSearchError(error ?? null);
      setIsSearching(false);
      if (resultsRef.current) resultsRef.current.scrollTop = 0;
    }, 240);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, category, group, isTitles, locationKey, customPlacesApiKey, defaultCity, searchLocation, retryCount]);

  // Community stats for each result in the list it fits best
  const statKeyFor = (c: PlaceCandidate) => placeStatKey(c.placeId, categoryOptions(c, category)[0]);
  const statFor = usePlaceStats(results.map(statKeyFor).filter((k): k is string => Boolean(k)));
  const predictionFor = usePredictions();

  const remember = () => setRecents(addRecentSearch(group, trimmed));

  const pickGroup = (next: SpotGroup) => {
    if (next === group) return;
    trackEvent('search_switch_group', { group: next });
    setCategory(searchCategoryFor(next, initialCategory));
    setResults([]);
    setLocationPanelOpen(false);
  };

  const handleCreateManual = () => {
    if (!trimmed) return;
    remember();
    onRank(
      createManualPlaceCandidate(
        trimmed,
        group === 'eat' ? resolveManualSpotCity(existingRestaurants, userLocation, defaultCity) : '',
        group
      ),
      category
    );
  };

  const applyCity = (city: string) => {
    const c = city.trim();
    setLocationChoice(c ? { kind: 'city', city: c } : { kind: 'nearby' });
    setLocationPanelOpen(false);
    setCityDraft('');
  };

  // Tapping a chip shouldn't drop the keyboard
  const keepFocus = (e: React.PointerEvent) => {
    if (document.activeElement === inputRef.current) e.preventDefault();
  };

  return (
    <div
      data-group={group}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      inert={covered || undefined}
      style={viewportBox}
      className={`fixed inset-0 z-50 flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overscroll-contain ${
        visible ? 'animate-jelly-page-up-in' : 'animate-jelly-page-up-out pointer-events-none'
      }`}
    >
      <div className="shrink-0 pt-[env(safe-area-inset-top)] bg-zinc-50 dark:bg-zinc-950">
        <div className="max-w-xl mx-auto px-4">
          {/* Top bar */}
          <div className="h-12 -mx-2.5 grid grid-cols-[3rem_1fr_3rem] items-center">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-11 h-11 rounded-full flex items-center justify-center text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 active:scale-95 transition"
            >
              <X className="w-6 h-6" />
            </button>
            <h1 className="text-center text-[15px] font-bold">Search</h1>
          </div>

          {/* 1. What to search: the group (and, where its lists search differently, which kind) */}
          <div
            role="tablist"
            aria-label="Search in"
            className="flex p-[3px] rounded-full bg-zinc-200/70 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/80"
          >
            {ALL_GROUPS.map((g) => {
              const active = g === group;
              return (
                <button
                  key={g}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={GROUP_LABEL[g]}
                  title={GROUP_LABEL[g]}
                  onPointerDown={keepFocus}
                  onClick={() => pickGroup(g)}
                  className={`h-8 rounded-full text-xs font-bold flex items-center justify-center gap-1 transition-all duration-200 motion-reduce:transition-none ${
                    active
                      ? 'flex-[2] px-3 bg-emerald-500 text-white dark:text-zinc-950 shadow-2xs'
                      : 'flex-1 px-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
                  }`}
                >
                  <span aria-hidden="true" className="text-sm leading-none">
                    {GROUP_EMOJI[g]}
                  </span>
                  <span className={active ? '' : 'hidden'}>{GROUP_LABEL[g]}</span>
                </button>
              );
            })}
          </div>

          {scopes && (
            <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label={`Search ${GROUP_LABEL[group]} for`}>
              {scopes.map((scope) => {
                const active = scope.categories.includes(category);
                return (
                  <button
                    key={scope.label}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onPointerDown={keepFocus}
                    onClick={() => {
                      if (active) return;
                      setCategory(scope.categories.includes(initialCategory) ? initialCategory : scope.categories[0]);
                      setResults([]);
                    }}
                    className={`h-8 px-3 rounded-full text-xs font-semibold border transition-colors ${
                      active
                        ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900'
                    }`}
                  >
                    {CATEGORY_EMOJI[scope.categories[0]]} {scope.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* 2. The search box (16px text: anything smaller makes iOS zoom in on focus) */}
          <form
            role="search"
            className="relative mt-3"
            onSubmit={(e) => {
              e.preventDefault();
              inputRef.current?.blur();
            }}
          >
            <Search className="w-[18px] h-[18px] text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label={searchPlaceholder(category)}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder(category)}
              className="w-full h-12 pl-10 pr-11 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 focus:border-emerald-500/70 dark:focus:border-emerald-500/70 rounded-2xl text-base text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none shadow-2xs transition-colors"
            />
            {query && (
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <span className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center">
                  <X className="w-3 h-3" />
                </span>
              </button>
            )}
          </form>

          {/* 3. Where (place groups; Travel searches the whole world) */}
          {showLocation ? (
            <div className="mt-1">
              <button
                type="button"
                onClick={() => setLocationPanelOpen((o) => !o)}
                aria-expanded={locationPanelOpen}
                className="h-9 -mx-1 px-1 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 max-w-full"
              >
                {location.kind === 'nearby' && userLocation ? (
                  <Navigation className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <MapPin className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                )}
                <span className="font-semibold text-zinc-700 dark:text-zinc-200 truncate">
                  {location.kind === 'city' ? `Near ${location.city}` : nearbyLabel}
                </span>
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold shrink-0">· Change</span>
              </button>
              {locationPanelOpen && (
                <div className="mb-2 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-1.5 space-y-0.5 animate-jelly-dialog">
                  <LocationOption
                    active={location.kind === 'nearby'}
                    icon={userLocation ? <Navigation className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
                    label={nearbyLabel}
                    hint={userLocation ? 'Your current location' : spotsHome ? 'Where your spots are' : undefined}
                    onClick={() => applyCity('')}
                  />
                  {defaultCity.trim() && (
                    <LocationOption
                      active={location.kind === 'city' && location.city === defaultCity.trim()}
                      icon={<MapPin className="w-4 h-4" />}
                      label={`Near ${defaultCity.trim()}`}
                      hint="Your default city"
                      onClick={() => applyCity(defaultCity)}
                    />
                  )}
                  <form
                    className="flex items-center gap-1.5 p-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (cityDraft.trim()) applyCity(cityDraft);
                    }}
                  >
                    <input
                      type="text"
                      value={cityDraft}
                      onChange={(e) => setCityDraft(e.target.value)}
                      placeholder="Another city or neighborhood"
                      aria-label="Search near another city"
                      enterKeyHint="done"
                      className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-base focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                    />
                    <button
                      type="submit"
                      disabled={!cityDraft.trim()}
                      className="h-10 px-3.5 rounded-xl text-sm font-semibold bg-emerald-500 text-white dark:text-zinc-950 disabled:opacity-40"
                    >
                      Use
                    </button>
                  </form>
                </div>
              )}
            </div>
          ) : group === 'travel' ? (
            <p className="h-9 mt-1 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <Globe className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              Searching the whole world
            </p>
          ) : (
            <div className="h-2" />
          )}
        </div>
      </div>

      {/* 4. Results */}
      <div
        ref={resultsRef}
        onTouchMove={() => {
          // Dragging the results tucks the keyboard away, like native search screens
          if (document.activeElement === inputRef.current) inputRef.current?.blur();
        }}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain border-t border-zinc-900/5 dark:border-white/5"
      >
        <div className="max-w-xl mx-auto px-2.5 pt-1 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          {trimmed.length < 2 ? (
            <div className="px-1.5">
              {recents.length > 0 && (
                <div className="pt-3">
                  <div className="flex items-center justify-between px-1 pb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Recent</span>
                    <button
                      type="button"
                      onClick={() => {
                        clearRecentSearches(group);
                        setRecents([]);
                      }}
                      className="text-xs font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 px-1 py-1"
                    >
                      Clear
                    </button>
                  </div>
                  {recents.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setQuery(r)}
                      className="w-full h-11 px-1 flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-200 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 text-left"
                    >
                      <Clock className="w-4 h-4 text-zinc-400 shrink-0" />
                      <span className="truncate">{r}</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="py-10 px-6 text-center text-sm text-zinc-400 dark:text-zinc-500 leading-relaxed">
                {copy.searchEmptyHint}
              </p>
            </div>
          ) : isSearching && results.length === 0 ? (
            <div aria-label="Searching" role="status">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-3 animate-pulse motion-reduce:animate-none">
                  {isTitles && <div className="w-9 h-[54px] rounded-md bg-zinc-200 dark:bg-zinc-800" />}
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-2/3 rounded bg-zinc-200 dark:bg-zinc-800" />
                    <div className="h-3 w-1/2 rounded bg-zinc-200/70 dark:bg-zinc-800/70" />
                  </div>
                  <div className="w-16 h-8 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                </div>
              ))}
            </div>
          ) : (
            <>
              {isSearching && (
                <div className="flex justify-center py-1" role="status" aria-label="Searching">
                  <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                </div>
              )}

              {searchError ? (
                <div className="py-8 px-6 text-center space-y-3">
                  <p className="text-sm text-rose-500 dark:text-rose-400">{searchError}</p>
                  <button
                    type="button"
                    onClick={() => setRetryCount((n) => n + 1)}
                    className="h-9 px-4 rounded-full text-sm font-semibold bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                !isSearching &&
                results.length === 0 && (
                  <p className="py-8 px-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
                    No matches for &ldquo;{trimmed}&rdquo;
                  </p>
                )
              )}

              {results.length > 0 && (
                <ul className="divide-y divide-zinc-200/60 dark:divide-zinc-800/70">
                  {results.map((item) => (
                    <li key={item.placeId}>
                      <ResultRow
                        item={item}
                        searchCategory={category}
                        isTitles={isTitles}
                        existingRestaurants={existingRestaurants}
                        isBookmarked={Boolean(bookmarkedPlaceIds?.has(item.placeId))}
                        friendLists={friendLists}
                        userLocation={userLocation}
                        social={
                          existingRestaurants.length > 0 || friendLists.length > 0 || statFor(statKeyFor(item))
                            ? getSpotSocialMetrics(
                                { ...item, category: categoryOptions(item, category)[0] },
                                {
                                  myUid,
                                  myRestaurants: existingRestaurants,
                                  friendLists,
                                  communityStat: statFor(statKeyFor(item)) ?? null,
                                  serverPrediction: predictionFor(item),
                                }
                              )
                            : null
                        }
                        onOpen={() => {
                          remember();
                          onOpenPlace(item, category);
                        }}
                        onRank={() => {
                          remember();
                          onRank(item, category);
                        }}
                        onToggleBookmark={
                          onToggleBookmark
                            ? () => {
                                remember();
                                onToggleBookmark(item, category);
                              }
                            : undefined
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}

              {!isSearching && (
                <button
                  type="button"
                  onClick={handleCreateManual}
                  className="mt-1 w-full h-11 px-2 rounded-xl text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors text-left flex items-center justify-between gap-2"
                >
                  <span className="truncate">
                    Add &ldquo;{trimmed}&rdquo; as a custom {isTitles ? 'title' : 'spot'}
                  </span>
                  <Plus className="w-4 h-4 shrink-0" />
                </button>
              )}
            </>
          )}

          {isTitles && (
            <div className="px-2 pt-2">
              <TitleCredit category={category} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const LocationOption: React.FC<{
  active: boolean;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}> = ({ active, icon, label, hint, onClick }) => (
  <button
    type="button"
    role="menuitemradio"
    aria-checked={active}
    onClick={onClick}
    className={`w-full min-h-11 px-2.5 py-1.5 rounded-xl flex items-center gap-2.5 text-left transition-colors ${
      active ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
    }`}
  >
    <span className={active ? '' : 'text-zinc-400'}>{icon}</span>
    <span className="min-w-0">
      <span className="block text-sm font-semibold truncate">{label}</span>
      {hint && <span className="block text-[11px] text-zinc-400">{hint}</span>}
    </span>
  </button>
);

interface ResultRowProps {
  item: PlaceCandidate;
  searchCategory: SpotCategory;
  isTitles: boolean;
  existingRestaurants: RestaurantEntry[];
  isBookmarked: boolean;
  friendLists: SharedListPayload[];
  userLocation: UserCoordinates | null;
  social: ReturnType<typeof getSpotSocialMetrics> | null;
  onOpen: () => void;
  onRank: () => void;
  onToggleBookmark?: () => void;
}

/** One result: tap the body to look it up, or use its quick actions (want to try, rank). */
const ResultRow: React.FC<ResultRowProps> = ({
  item,
  searchCategory,
  isTitles,
  existingRestaurants,
  isBookmarked,
  friendLists,
  userLocation,
  social,
  onOpen,
  onRank,
  onToggleBookmark,
}) => {
  const bestCategory = categoryOptions(item, searchCategory)[0];
  const ranked = findRankedInGroup(item, searchCategory, existingRestaurants);
  const type = item.cuisines[0] || item.primaryTypeDisplay || '';
  const where = item.media
    ? spotPlaceLabel(item)
    : [item.neighborhood, item.city].filter(Boolean).join(', ') || item.formattedAddress;
  const distance = isTitles ? null : formatDistanceMiles(getItemDistanceMiles(item, userLocation));
  const friendMatches = friendLists.length > 0 ? getFriendMatchesForSpot(item, friendLists) : [];
  const want = wantLabel(bestCategory);

  return (
    <div className="flex items-center gap-1.5 py-1">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${item.name}`}
        className="min-w-0 flex-1 flex items-center gap-3 px-2 py-2 rounded-xl text-left hover:bg-zinc-100 dark:hover:bg-zinc-900 active:bg-zinc-200/60 dark:active:bg-zinc-800 transition-colors"
      >
        {isTitles && (
          <PosterThumb src={posterUrl(item.media)} square={hasSquareCover(item.placeId)} className="w-10 h-[60px]" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span className="font-semibold text-[15px] truncate">{item.name}</span>
            <ChevronRight className="w-3.5 h-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
          </span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
            {[type, spotPrice(item, bestCategory), where, distance].filter(Boolean).join(' · ')}
          </span>
          {(ranked ||
            isBookmarked ||
            friendMatches.length > 0 ||
            (social && (social.predictedScore !== null || social.communityAvg !== null))) && (
            <span className="flex flex-wrap items-center gap-1 mt-1">
              {ranked && (
                <span className="px-1.5 py-0.5 rounded-md bg-jade-500/12 text-jade-700 dark:text-jade-300 text-[10px] font-semibold">
                  Ranked #{ranked.rankIndex + 1} · {ranked.magicScore.toFixed(1)}
                </span>
              )}
              {isBookmarked && (
                <span className="px-1.5 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-300 text-[10px] font-semibold">
                  On your {want}
                </span>
              )}
              {!ranked && social && social.predictedScore !== null && (
                <span
                  className="px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold"
                  title={social.predictionBasis || undefined}
                >
                  ~{social.predictedScore.toFixed(1)} for you
                </span>
              )}
              {social && social.communityAvg !== null && (
                <span className="px-1.5 py-0.5 rounded-md bg-zinc-200/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-[10px] font-semibold">
                  jelly {social.communityAvg.toFixed(1)}
                </span>
              )}
              {friendMatches.slice(0, 2).map((fm) => (
                <span
                  key={fm.friendUid}
                  className="px-1.5 py-0.5 rounded-md bg-teal-500/10 text-teal-700 dark:text-teal-300 text-[10px] font-semibold"
                >
                  {fm.friendName}{' '}
                  {fm.status === 'ranked' && fm.magicScore !== undefined
                    ? fm.magicScore.toFixed(1)
                    : `· ${wantLabel(fm.category)}`}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>

      <div className="flex items-center gap-1 shrink-0 pr-1">
        {onToggleBookmark && !ranked && (
          <button
            type="button"
            onClick={onToggleBookmark}
            aria-pressed={isBookmarked}
            aria-label={isBookmarked ? `Remove ${item.name} from ${want}` : `Save ${item.name} to ${want}`}
            title={isBookmarked ? `Remove from ${want}` : `Save to ${want}`}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
              isBookmarked
                ? 'text-rose-500 bg-rose-500/10'
                : 'text-zinc-400 hover:text-rose-500 hover:bg-zinc-100 dark:hover:bg-zinc-900'
            }`}
          >
            <Bookmark className={`w-[18px] h-[18px] ${isBookmarked ? 'fill-rose-500' : ''}`} />
          </button>
        )}
        <button
          type="button"
          onClick={onRank}
          aria-label={`${ranked ? 'Re-rank' : 'Rank'} ${item.name}`}
          className={`h-9 px-3.5 rounded-full text-[13px] font-bold transition-colors active:scale-95 ${
            ranked
              ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200'
              : 'bg-emerald-500 text-white dark:text-zinc-950 hover:bg-emerald-600 dark:hover:bg-emerald-400'
          }`}
        >
          {ranked ? 'Re-rank' : 'Rank'}
        </button>
      </div>
    </div>
  );
};

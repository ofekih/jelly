import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bookmark, Loader2, MapPin, Plus, Search, X } from 'lucide-react';
import {
  CATEGORY_EMOJI,
  CATEGORY_GROUP,
  CATEGORY_LABEL,
  DEFAULT_CATEGORY,
  GROUP_CATEGORIES,
  PlaceCandidate,
  RestaurantEntry,
  SharedListPayload,
  SpotCategory,
} from '../types';
import { createManualPlaceCandidate, searchPlaces } from '../lib/placesService';
import { posterUrl, searchTitles, spotPlaceLabel } from '../lib/media';
import { isMediaPlaceId } from '../lib/tasteModel';
import { GROUP_COPY, searchPlaceholder, wantLabel } from '../lib/groups';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import { getFriendMatchesForSpot, getSpotSocialMetrics } from '../lib/friendsService';
import { placeStatKey } from '../lib/socialService';
import { usePlaceStats } from '../lib/usePlaceStats';
import { usePredictions } from '../lib/usePredictions';
import {
  formatDistanceMiles,
  getItemDistanceMiles,
  homeCoords,
  resolveManualSpotCity,
  UserCoordinates,
} from '../lib/geo';
import { pctToSpectrumRating, spectrumGradient, spectrumRatingToPct } from '../lib/rankingEngine';
import { RATING_TIERS, getRatingTier, getVibeLabel } from '../lib/ratingTiers';
import { trackEvent } from '../firebase';
import { PosterThumb, TitleCredit } from './PosterThumb';

interface AddAndRateModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRestaurants: RestaurantEntry[];
  defaultCategory?: SpotCategory; // The list the user is currently viewing
  myUid?: string | null;
  bookmarkedPlaceIds?: Set<string>;
  friendLists?: SharedListPayload[];
  reRankingEntry?: RestaurantEntry | null;
  defaultCity?: string;
  customPlacesApiKey?: string;
  linearRatingScale?: boolean;
  userLocation?: UserCoordinates | null;
  onCompleteQuestions: (
    candidate: PlaceCandidate,
    initialRating: number,
    category: SpotCategory,
    existingIdToReplace?: string
  ) => void;
  onAddBookmark?: (candidate: PlaceCandidate) => void;
}

export const AddAndRateModal: React.FC<AddAndRateModalProps> = ({
  isOpen,
  onClose,
  existingRestaurants,
  defaultCategory = DEFAULT_CATEGORY,
  myUid = null,
  bookmarkedPlaceIds,
  friendLists = [],
  reRankingEntry,
  defaultCity = '',
  customPlacesApiKey = '',
  linearRatingScale = false,
  userLocation = null,
  onCompleteQuestions,
  onAddBookmark,
}) => {
  // The add flow always stays within the group (Eat / Explore / Travel) being viewed
  const group = CATEGORY_GROUP[reRankingEntry?.category ?? defaultCategory];
  const copy = GROUP_COPY[group];
  const isTitles = !copy.hasLocation; // Movies, shows and books
  useBodyScrollLock(isOpen);
  const [step, setStep] = useState<'search' | 'q1_rating' | 'q2_category'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceCandidate[]>([]);
  // Community stats for each result in the list it fits best
  const candidateStatKey = (c: PlaceCandidate) => placeStatKey(c.placeId, c.categories?.[0]);
  const statFor = usePlaceStats(
    searchResults.map(candidateStatKey).filter((k): k is string => Boolean(k))
  );
  const predictionFor = usePredictions();
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedCandidate, setSelectedCandidate] = useState<PlaceCandidate | null>(null);
  const [selectedRating, setSelectedRating] = useState<number>(8.0);
  const [previewRating, setPreviewRating] = useState<number | null>(null);
  const [isDraggingLine, setIsDraggingLine] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const resultsScrollRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (reRankingEntry) {
      setSelectedCandidate({
        placeId: reRankingEntry.placeId || reRankingEntry.id,
        name: reRankingEntry.name,
        formattedAddress: reRankingEntry.formattedAddress,
        neighborhood: reRankingEntry.neighborhood,
        city: reRankingEntry.city,
        lat: reRankingEntry.lat,
        lng: reRankingEntry.lng,
        googleMapsUri: reRankingEntry.googleMapsUri,
        priceLevel: reRankingEntry.priceLevel,
        categories: reRankingEntry.categories?.length
          ? reRankingEntry.categories
          : [reRankingEntry.category],
        cuisines: reRankingEntry.cuisines,
        primaryTypeDisplay: reRankingEntry.primaryTypeDisplay,
        media: reRankingEntry.media,
        source: isMediaPlaceId(reRankingEntry.placeId) ? 'tmdb' : 'google_places',
      });
      const roundedPrev = Math.round(reRankingEntry.initialRating * 10) / 10;
      setSelectedRating(roundedPrev);
      setPreviewRating(roundedPrev);
      setStep('q1_rating');
      setShowAllCategories(false);
    } else {
      setStep('search');
      setSearchQuery('');
      setSearchResults([]);
      setSelectedCandidate(null);
      setSelectedRating(8.0);
      setPreviewRating(null);
      setShowAllCategories(false);
    }
  }, [isOpen, reRankingEntry]);

  // Without live location, bias search toward where the user's own spots are (not trips)
  const searchLocation = useMemo(
    () =>
      userLocation ??
      homeCoords(existingRestaurants.filter((r) => CATEGORY_GROUP[r.category] !== 'travel')),
    [userLocation, existingRestaurants]
  );

  // Live Google Places search debounce
  useEffect(() => {
    if (!isOpen || step !== 'search') return;
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);

    const timer = setTimeout(async () => {
      const { results, error } = isTitles
        ? await searchTitles(trimmed, defaultCategory)
        : {
            ...(await searchPlaces(
              trimmed,
              customPlacesApiKey,
              userLocation ? undefined : defaultCity,
              searchLocation,
              group
            )),
            error: undefined,
          };
      if (!cancelled) {
        setSearchResults(results);
        setSearchError(error ?? null);
        setIsSearching(false);
        requestAnimationFrame(() => {
          if (resultsScrollRef.current) {
            resultsScrollRef.current.scrollTop = 0;
          }
        });
      }
    }, 240);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, isOpen, step, customPlacesApiKey, defaultCity, userLocation, searchLocation, isTitles, group, defaultCategory]);

  // Ensure scroll container always starts at top when query or results change
  useEffect(() => {
    if (resultsScrollRef.current) {
      resultsScrollRef.current.scrollTop = 0;
    }
  }, [searchQuery, searchResults]);

  const findExistingInCategory = (candidate: PlaceCandidate, category: SpotCategory) =>
    existingRestaurants.find(
      (r) =>
        r.category === category &&
        ((r.placeId && candidate.placeId && r.placeId === candidate.placeId) ||
          (!isMediaPlaceId(candidate.placeId) &&
            r.name.toLowerCase() === candidate.name.toLowerCase() &&
            r.formattedAddress === candidate.formattedAddress))
    );

  // Lists to offer for a candidate: its auto-detected categories in this group, plus the list being
  // viewed (TMDB knows for sure whether a title is a movie or a show; BGG and IGDB only find their own list)
  const getCategoryOptions = (candidate: PlaceCandidate): SpotCategory[] => {
    const detected = (candidate.categories || []).filter((c) => CATEGORY_GROUP[c] === group);
    if ((['tmdb', 'bgg', 'igdb'].includes(candidate.source) || group === 'travel') && detected.length > 0) return detected;
    return Array.from(new Set([...detected, defaultCategory]));
  };

  // Bookmarks go in the candidate's best list within this group
  const addBookmark = (candidate: PlaceCandidate) =>
    onAddBookmark?.({ ...candidate, categories: getCategoryOptions(candidate) });

  const finishWithCategory = (
    candidate: PlaceCandidate,
    rating: number,
    category: SpotCategory
  ) => {
    // Check if this exact (placeId + category) or (name + address + category) already exists
    const existingMatch = reRankingEntry || findExistingInCategory(candidate, category);

    onCompleteQuestions(candidate, rating, category, existingMatch?.id);
  };

          
  const handlePickRating = (rawRating: number) => {
    if (!selectedCandidate) return;
    const rating = Math.max(1.0, Math.min(10.0, Math.round(rawRating * 10) / 10));
    setSelectedRating(rating);
    trackEvent('rate_initial_score', {
      restaurant_name: selectedCandidate.name,
      initial_rating: rating,
      is_rerank: Boolean(reRankingEntry),
    });

    // If re-ranking an existing entry, its list is already fixed -> go straight to Q3+ (SxS)
    if (reRankingEntry) {
      finishWithCategory(selectedCandidate, rating, reRankingEntry.category);
      return;
    }

    // If only one list fits, skip Q2 and go straight to Q3+ (SxS)
    const options = getCategoryOptions(selectedCandidate);
    if (options.length === 1) {
      finishWithCategory(selectedCandidate, rating, options[0]);
      return;
    }

    setStep('q2_category');
  };

  const computeRatingFromClientX = (clientX: number, rect: DOMRect): number => {
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return pctToSpectrumRating(pct, linearRatingScale);
  };

  const previewTier = previewRating === null ? null : getRatingTier(previewRating);

  if (!isOpen) return null;

  const handleSelectCandidate = (candidate: PlaceCandidate) => {
    trackEvent('select_search_result', {
      restaurant_name: candidate.name,
      city: candidate.city || '',
      source: candidate.source,
    });
    setSelectedCandidate(candidate);
    setPreviewRating(null);
    setShowAllCategories(false);
    setStep('q1_rating');
  };

  const handleCreateManual = () => {
    if (!searchQuery.trim()) return;
    const manual = createManualPlaceCandidate(
      searchQuery,
      group === 'eat' ? resolveManualSpotCity(existingRestaurants, userLocation, defaultCity) : '',
      group
    );
    handleSelectCandidate(manual);
  };

  const candidateCategories = selectedCandidate
    ? getCategoryOptions(selectedCandidate)
    : [defaultCategory];

  const displayedCategories = showAllCategories
    ? Array.from(new Set([...candidateCategories, ...GROUP_CATEGORIES[group]]))
    : candidateCategories;

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-black/50 backdrop-blur-xs animate-jelly-backdrop overscroll-contain ${
        step === 'search'
          ? 'items-start sm:items-center pt-2 sm:pt-4 px-2 sm:px-4'
          : 'items-end sm:items-center p-0 sm:p-4'
      }`}
      onClick={onClose}
    >
      <div
        className={`w-full max-w-md bg-white dark:bg-zinc-900 shadow-2xl border border-zinc-200/80 dark:border-zinc-800 overflow-hidden flex flex-col overscroll-contain ${
          step === 'search'
            ? 'rounded-3xl max-h-[60dvh] sm:max-h-[85vh] animate-jelly-dialog'
            : 'rounded-t-3xl sm:rounded-3xl max-h-[88vh] animate-jelly-sheet'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile Grab Handle Pill (on non-search steps) */}
        {step !== 'search' && (
          <div className="w-full pt-2.5 pb-1 flex justify-center sm:hidden shrink-0 touch-none select-none">
            <div className="w-10 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700 pointer-events-none" />
          </div>
        )}

        {/* Minimal Top Bar */}
        <div className="px-5 pt-3 sm:pt-4 pb-3 flex items-center justify-between shrink-0 touch-none select-none">
          {step !== 'search' && !reRankingEntry ? (
            <button
              type="button"
              onClick={() => setStep(step === 'q2_category' ? 'q1_rating' : 'search')}
              className="p-1.5 -ml-1.5 rounded-full text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : (
            <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
              {reRankingEntry
                ? `${existingRestaurants.some((r) => r.id === reRankingEntry.id) ? 'Re-rank' : 'Rank'} · ${
                    CATEGORY_LABEL[reRankingEntry.category]
                  }`
                : isTitles
                ? 'Add a Title'
                : 'Add a Place'}
            </span>
          )}

          {step !== 'search' && !reRankingEntry && (
            <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
              {step === 'q1_rating' ? 'Step 1 of 2' : 'Step 2 of 2'}
            </span>
          )}

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 -mr-1.5 rounded-full text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sticky Search Input (kept outside the scrollable results container so mobile keyboard never scrolls past top results) */}
        {step === 'search' && (
          <div className="px-5 pb-3 shrink-0">
            <div className="relative">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={searchPlaceholder(defaultCategory)}
                autoFocus
                className="w-full pl-10 pr-9 py-3 bg-zinc-100/80 dark:bg-zinc-800/80 border border-transparent focus:border-zinc-300 dark:focus:border-zinc-700 rounded-2xl text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <div ref={resultsScrollRef} className="px-5 pb-6 overflow-y-auto flex-1">
          {step === 'search' && (
            <div className="space-y-3">
              {isSearching && (
                <div className="py-10 flex items-center justify-center gap-2 text-xs text-zinc-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Searching...</span>
                </div>
              )}

              {!isSearching && searchResults.length > 0 && (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                  {searchResults.map((item) => {
                    const primaryCuisine =
                      item.cuisines[0] || item.primaryTypeDisplay || '';
                    const locationShort = item.media
                      ? spotPlaceLabel(item)
                      : [item.neighborhood, item.city].filter(Boolean).join(', ') ||
                        item.formattedAddress;
                    const poster = posterUrl(item.media);
                    const distLabel = formatDistanceMiles(
                      getItemDistanceMiles(item, userLocation)
                    );
                    const isAlreadyBookmarked = bookmarkedPlaceIds?.has(item.placeId);
                    const friendMatches =
                      friendLists.length > 0 ? getFriendMatchesForSpot(item, friendLists) : [];
                    const communityStat = statFor(candidateStatKey(item)) ?? null;
                    const socialMetrics =
                      existingRestaurants.length > 0 || friendLists.length > 0 || communityStat
                        ? getSpotSocialMetrics(item, {
                            myUid,
                            myRestaurants: existingRestaurants,
                            friendLists,
                            communityStat,
                            serverPrediction: predictionFor(item),
                          })
                        : null;

                    return (
                      <div
                        key={item.placeId}
                        className="w-full py-2.5 px-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-xl transition-colors flex items-center justify-between gap-2 group"
                      >
                        {isTitles && <PosterThumb src={poster} className="w-9 h-[54px]" />}
                        <button
                          type="button"
                          onClick={() => handleSelectCandidate(item)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                            {item.name}
                          </div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                            {[primaryCuisine, locationShort, distLabel].filter(Boolean).join(' · ')}
                          </div>
                          {(friendMatches.length > 0 ||
                            (socialMetrics &&
                              (socialMetrics.predictedScore !== null ||
                                socialMetrics.communityAvg !== null))) && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              {socialMetrics && socialMetrics.predictedScore !== null && (
                                <span
                                  className="px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold"
                                  title={socialMetrics.predictionBasis || undefined}
                                >
                                  ~{socialMetrics.predictedScore.toFixed(1)} for you
                                </span>
                              )}
                              {socialMetrics && socialMetrics.communityAvg !== null && (
                                <span className="px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-[10px] font-semibold">
                                  jelly {socialMetrics.communityAvg.toFixed(1)}
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
                            </div>
                          )}
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          {onAddBookmark && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                addBookmark(item);
                              }}
                              className={`p-2 rounded-full transition-colors ${
                                isAlreadyBookmarked
                                  ? 'text-rose-500 bg-rose-50 dark:bg-rose-950/40'
                                  : 'text-zinc-400 hover:text-rose-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                              }`}
                              title={`Save to ${copy.want}`}
                              aria-label={`Save to ${copy.want}`}
                            >
                              <Bookmark
                                className={`w-4 h-4 ${isAlreadyBookmarked ? 'fill-rose-500' : ''}`}
                              />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleSelectCandidate(item)}
                            className="p-2 rounded-full text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                            title="Rate & Rank"
                            aria-label="Rate & Rank"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {!isSearching && searchQuery.trim().length >= 2 && (
                <button
                  type="button"
                  onClick={handleCreateManual}
                  className="w-full py-2.5 px-3 rounded-xl text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left flex items-center justify-between"
                >
                  <span>
                    Add &ldquo;{searchQuery.trim()}&rdquo; as a custom {isTitles ? 'title' : 'spot'}
                  </span>
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}

              {!isSearching && searchError && searchQuery.trim().length >= 2 && (
                <div className="py-4 text-center text-xs text-rose-500 dark:text-rose-400">{searchError}</div>
              )}

              {searchQuery.trim().length < 2 && (
                <div className="py-10 text-center text-xs text-zinc-400 dark:text-zinc-500">
                  {copy.searchEmptyHint}
                </div>
              )}

              {isTitles && <TitleCredit category={defaultCategory} />}
            </div>
          )}

          {/* Q1: Numberless Red-to-Green Gut-Feeling Spectrum Line */}
          {step === 'q1_rating' && selectedCandidate && (
            <div className="py-3 space-y-5">
              <div className="text-center space-y-1">
                {selectedCandidate.media?.poster && (
                  <PosterThumb
                    src={posterUrl(selectedCandidate.media, 185)}
                    className="w-20 h-[120px] mx-auto mb-2 shadow-md"
                  />
                )}
                <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                  {selectedCandidate.name}
                </h2>
                {isTitles ? (
                  spotPlaceLabel(selectedCandidate) && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      {spotPlaceLabel(selectedCandidate)}
                    </p>
                  )
                ) : (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center justify-center gap-1">
                    <MapPin className="w-3 h-3 shrink-0" />
                    <span className="truncate max-w-xs">
                      {[selectedCandidate.neighborhood, selectedCandidate.city]
                        .filter(Boolean)
                        .join(', ') || selectedCandidate.formattedAddress}
                    </span>
                  </p>
                )}
              </div>

              <div className="space-y-3.5 pt-1">
                <div className="text-center space-y-1">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                    What&rsquo;s your quick gut feeling?
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed max-w-xs mx-auto">
                    Don&rsquo;t sweat it—just tap a spot on the line. Side-by-side comparisons will figure out the true rank.
                  </p>
                </div>

                {/* Live Vibe Indicator Pill */}
                <div className="flex justify-center pt-0.5">
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                      previewTier?.pillClass ??
                      'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700'
                    }`}
                  >
                    {previewRating === null
                      ? 'Slide or tap anywhere on the line'
                      : getVibeLabel(previewRating, group)}
                  </span>
                </div>

                {/* Continuous Red-to-Green Spectrum Number Line (No 1-10 numbers shown) */}
                <div className="pt-1 pb-1 px-1">
                  <div
                    role="slider"
                    aria-label="Gut feeling spectrum"
                    aria-valuemin={1}
                    aria-valuemax={10}
                    aria-valuenow={previewRating ?? selectedRating}
                    tabIndex={0}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setIsDraggingLine(true);
                      const val = computeRatingFromClientX(
                        e.clientX,
                        e.currentTarget.getBoundingClientRect()
                      );
                      setPreviewRating(val);
                    }}
                    onPointerMove={(e) => {
                      const val = computeRatingFromClientX(
                        e.clientX,
                        e.currentTarget.getBoundingClientRect()
                      );
                      setPreviewRating(val);
                    }}
                    onPointerUp={(e) => {
                      const val = computeRatingFromClientX(
                        e.clientX,
                        e.currentTarget.getBoundingClientRect()
                      );
                      setIsDraggingLine(false);
                      handlePickRating(val);
                    }}
                    onPointerLeave={() => {
                      if (!isDraggingLine) {
                        setPreviewRating(
                          reRankingEntry
                            ? Math.round(reRankingEntry.initialRating * 10) / 10
                            : null
                        );
                      }
                    }}
                    className="relative h-14 w-full rounded-2xl cursor-pointer select-none touch-none shadow-inner ring-1 ring-inset ring-black/10 dark:ring-white/15 bg-no-repeat flex items-center transition-transform active:scale-[0.995]"
                    style={{
                      backgroundImage: spectrumGradient(linearRatingScale),
                      backgroundOrigin: 'border-box',
                      backgroundRepeat: 'no-repeat',
                    }}
                  >
                    {/* Subtle Zone Boundary Dividers along the number line (tier boundaries by default, or linear 1-10) */}
                    {RATING_TIERS.slice(1).map((tier) => (
                      <div
                        key={tier.name}
                        className="absolute top-2 bottom-2 w-px bg-white/35 dark:bg-black/25 pointer-events-none"
                        style={{ left: `${spectrumRatingToPct(tier.from, linearRatingScale)}%` }}
                      />
                    ))}

                    {/* Center baseline axis line */}
                    <div className="w-full h-0.5 bg-white/30 mx-3 rounded-full pointer-events-none" />

                    {/* Active / Preview Thumb Marker */}
                    {previewRating !== null && (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-white shadow-lg pointer-events-none flex items-center justify-center transition-transform duration-75"
                        style={{
                          left: `${Math.max(
                            4,
                            Math.min(96, spectrumRatingToPct(previewRating, linearRatingScale))
                          )}%`,
                          borderWidth: '3px',
                          borderStyle: 'solid',
                          borderColor: previewTier?.thumbColor,
                        }}
                      >
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: previewTier?.thumbColor }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Vibe Zone Labels aligned under the spectrum line */}
                  <div className="relative h-6 mt-2 select-none text-[11px] font-semibold">
                    {RATING_TIERS.map((zone) => (
                      <button
                        key={zone.name}
                        type="button"
                        onMouseEnter={() => setPreviewRating(zone.zoneRating)}
                        onMouseLeave={() =>
                          setPreviewRating(
                            reRankingEntry
                              ? Math.round(reRankingEntry.initialRating * 10) / 10
                              : null
                          )
                        }
                        onClick={() => handlePickRating(zone.zoneRating)}
                        style={{ left: `${spectrumRatingToPct(zone.zoneRating, linearRatingScale)}%` }}
                        className={`absolute -translate-x-1/2 px-1 py-0.5 rounded hover:opacity-100 transition-opacity ${zone.zoneClass} opacity-85 hover:underline`}
                      >
                        {zone.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {!reRankingEntry && onAddBookmark && (
                <div className="pt-1 text-center">
                  <button
                    type="button"
                    onClick={() => addBookmark(selectedCandidate)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-rose-500 dark:hover:text-rose-400 transition-colors"
                  >
                    <Bookmark className="w-3.5 h-3.5" />
                    <span>
                      {copy.notYet} Save to {copy.want}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Q2: Pick a list (when a place fits more than one category) */}
          {step === 'q2_category' && selectedCandidate && (
            <div className="py-3 space-y-5">
              <div className="text-center space-y-1">
                <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                  {selectedCandidate.name}
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Which list does this go in?
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {displayedCategories.map((category) => {
                  const existingInCategory = findExistingInCategory(selectedCandidate, category);

                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => finishWithCategory(selectedCandidate, selectedRating, category)}
                      className="w-full py-3.5 px-4 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-800/60 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/30 hover:border-emerald-500/60 dark:hover:border-emerald-500/60 text-zinc-900 dark:text-zinc-100 font-semibold text-sm flex items-center justify-between transition-all active:scale-[0.99]"
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="text-base">{CATEGORY_EMOJI[category]}</span>
                        <span>{CATEGORY_LABEL[category]}</span>
                      </span>
                      {existingInCategory && (
                        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                          Already ranked ({existingInCategory.magicScore.toFixed(1)}) · Re-rank
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {!showAllCategories && displayedCategories.length < GROUP_CATEGORIES[group].length && (
                <button
                  type="button"
                  onClick={() => setShowAllCategories(true)}
                  className="w-full text-center text-xs font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 pt-1"
                >
                  Show other lists...
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

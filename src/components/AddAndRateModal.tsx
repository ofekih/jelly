import React, { useEffect, useState } from 'react';
import { ArrowLeft, Bookmark, Loader2, MapPin, Plus, Search, X } from 'lucide-react';
import {
  ALL_CATEGORIES,
  CATEGORY_EMOJI,
  CATEGORY_LABEL,
  DEFAULT_CATEGORY,
  PlaceCandidate,
  RestaurantEntry,
  SharedListPayload,
  SpotCategory,
} from '../types';
import { createManualPlaceCandidate, searchRestaurants } from '../lib/placesService';
import { getFriendMatchesForSpot, getSpotSocialMetrics } from '../lib/friendsService';
import {
  formatDistanceMiles,
  getItemDistanceMiles,
  resolveManualSpotCity,
  UserCoordinates,
} from '../lib/geo';
import { pctToSpectrumRating, spectrumRatingToPct } from '../lib/rankingEngine';
import { trackEvent } from '../firebase';

interface AddAndRateModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRestaurants: RestaurantEntry[];
  defaultCategory?: SpotCategory; // The list the user is currently viewing
  myUid?: string | null;
  bookmarkedPlaceIds?: Set<string>;
  friendLists?: SharedListPayload[];
  communityLists?: SharedListPayload[];
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
  communityLists = [],
  reRankingEntry,
  defaultCity = '',
  customPlacesApiKey = '',
  linearRatingScale = false,
  userLocation = null,
  onCompleteQuestions,
  onAddBookmark,
}) => {
  const [step, setStep] = useState<'search' | 'q1_rating' | 'q2_category'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceCandidate[]>([]);
  const [isSearching, setIsSearching] = useState(false);

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
        source: 'google_places',
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
      const { results } = await searchRestaurants(
        trimmed,
        customPlacesApiKey,
        userLocation ? undefined : defaultCity,
        userLocation
      );
      if (!cancelled) {
        setSearchResults(results);
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
  }, [searchQuery, isOpen, step, customPlacesApiKey, defaultCity, userLocation]);

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
          (r.name.toLowerCase() === candidate.name.toLowerCase() &&
            r.formattedAddress === candidate.formattedAddress))
    );

  // Lists to offer for a candidate: its auto-detected categories, plus the list being viewed
  const getCategoryOptions = (candidate: PlaceCandidate): SpotCategory[] =>
    Array.from(
      new Set([...(candidate.categories || []), defaultCategory].filter(Boolean))
    ) as SpotCategory[];

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

  const getGutVibeMeta = (rating: number | null) => {
    if (rating === null) {
      return {
        label: 'Slide or tap anywhere on the line',
        pillClass:
          'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
        thumbBorder: '#10b981',
      };
    }

    // Tier 1: Skip (1.0 - 3.9, 0% - 20% of bar)
    if (rating < 4.0) {
      const label =
        rating < 1.8
          ? 'Disaster · Avoid at all costs'
          : rating < 2.5
          ? 'Rough · Regretted going'
          : rating < 3.3
          ? 'Not good · Wouldn’t go back'
          : 'Missed the mark · Skip it';
      return {
        label,
        pillClass:
          'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/70',
        thumbBorder: '#f43f5e',
      };
    }

    // Tier 2: Mid (4.0 - 5.9, 20% - 40% of bar, 5.0 at center)
    if (rating < 6.0) {
      const label =
        rating < 4.5
          ? 'Could’ve been better · Underwhelming'
          : rating < 5.0
          ? 'Meh · Pretty forgettable'
          : rating < 5.5
          ? 'It was okay · Gets the job done'
          : 'Fine in a pinch · Nothing special';
      return {
        label,
        pillClass:
          'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70',
        thumbBorder: '#f59e0b',
      };
    }

    // Tier 3: Good (6.0 - 7.4, 40% - 60% of bar)
    if (rating < 7.5) {
      const label =
        rating < 6.4
          ? 'Pretty good · Glad I went'
          : rating < 6.8
          ? 'Liked it · Solid neighborhood spot'
          : rating < 7.2
          ? 'Good spot · Happy to go back'
          : 'Really liked it · Easy recommendation';
      return {
        label,
        pillClass:
          'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800/70',
        thumbBorder: '#06b6d4',
      };
    }

    // Tier 4: Great (7.5 - 8.7, 60% - 80% of bar -> culminates in "Loved it" near the Incredible boundary)
    if (rating < 8.8) {
      const label =
        rating < 7.8
          ? 'Great meal · Worth a detour'
          : rating < 8.2
          ? 'So good · Would happily bring friends'
          : rating < 8.5
          ? 'Loved it · Standout spot'
          : 'Really loved it · Crave-worthy';
      return {
        label,
        pillClass:
          'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800/70',
        thumbBorder: '#14b8a6',
      };
    }

    // Tier 5: Incredible (8.8 - 10.0, 80% - 100% of bar -> reserves the far right for true perfection)
    const label =
      rating < 9.1
        ? 'Obsessed · Top-tier meal'
        : rating < 9.5
        ? 'Blown away · All-time favorite'
        : rating < 9.8
        ? 'Near perfection · Almost nothing to critique'
        : 'Flawless · Literally nothing could be improved';

    return {
      label,
      pillClass:
        'bg-emerald-100/90 text-emerald-800 border-emerald-300 dark:bg-emerald-900/70 dark:text-emerald-200 dark:border-emerald-700',
      thumbBorder: '#059669',
    };
  };

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
      resolveManualSpotCity(existingRestaurants, userLocation, defaultCity)
    );
    handleSelectCandidate(manual);
  };

  const candidateCategories = selectedCandidate
    ? getCategoryOptions(selectedCandidate)
    : [defaultCategory];

  const displayedCategories = showAllCategories
    ? Array.from(new Set([...candidateCategories, ...ALL_CATEGORIES]))
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
                ? `Re-rank · ${CATEGORY_LABEL[reRankingEntry.category]}`
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
                placeholder="Search any restaurant, cafe, or bar..."
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
                      item.cuisines[0] || item.primaryTypeDisplay || 'Restaurant';
                    const locationShort =
                      [item.neighborhood, item.city].filter(Boolean).join(', ') ||
                      item.formattedAddress;
                    const distLabel = formatDistanceMiles(
                      getItemDistanceMiles(item, userLocation)
                    );
                    const isAlreadyBookmarked = bookmarkedPlaceIds?.has(item.placeId);
                    const friendMatches =
                      friendLists.length > 0 ? getFriendMatchesForSpot(item, friendLists) : [];
                    const socialMetrics =
                      existingRestaurants.length > 0 ||
                      friendLists.length > 0 ||
                      communityLists.length > 0
                        ? getSpotSocialMetrics(item, {
                            myUid,
                            myRestaurants: existingRestaurants,
                            friendLists,
                            communityLists,
                          })
                        : null;

                    return (
                      <div
                        key={item.placeId}
                        className="w-full py-2.5 px-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-xl transition-colors flex items-center justify-between gap-2 group"
                      >
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
                                    : '· Want to Try'}
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
                                onAddBookmark(item);
                              }}
                              className={`p-2 rounded-full transition-colors ${
                                isAlreadyBookmarked
                                  ? 'text-rose-500 bg-rose-50 dark:bg-rose-950/40'
                                  : 'text-zinc-400 hover:text-rose-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                              }`}
                              title="Save to Want to Try"
                              aria-label="Save to Want to Try"
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
                  <span>Add &ldquo;{searchQuery.trim()}&rdquo; as a custom spot</span>
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}

              {searchQuery.trim().length < 2 && (
                <div className="py-10 text-center text-xs text-zinc-400 dark:text-zinc-500">
                  Type a restaurant name to rate &amp; rank it, or tap the bookmark icon to save for later.
                </div>
              )}
            </div>
          )}

          {/* Q1: Numberless Red-to-Green Gut-Feeling Spectrum Line */}
          {step === 'q1_rating' && selectedCandidate && (
            <div className="py-3 space-y-5">
              <div className="text-center space-y-1">
                <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                  {selectedCandidate.name}
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center justify-center gap-1">
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span className="truncate max-w-xs">
                    {[selectedCandidate.neighborhood, selectedCandidate.city]
                      .filter(Boolean)
                      .join(', ') || selectedCandidate.formattedAddress}
                  </span>
                </p>
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
                      getGutVibeMeta(previewRating).pillClass
                    }`}
                  >
                    {getGutVibeMeta(previewRating).label}
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
                      backgroundImage: linearRatingScale
                        ? 'linear-gradient(90deg, #f43f5e 0%, #fb7185 22%, #f59e0b 44%, #06b6d4 60%, #14b8a6 73%, #10b981 86%, #047857 100%)'
                        : 'linear-gradient(90deg, #f43f5e 0%, #fb7185 16%, #f59e0b 30%, #06b6d4 47%, #14b8a6 63%, #10b981 80%, #047857 100%)',
                      backgroundOrigin: 'border-box',
                      backgroundRepeat: 'no-repeat',
                    }}
                  >
                    {/* Subtle Zone Boundary Dividers along the number line (5 equal 20% divisions by default, or linear 1-10) */}
                    {(linearRatingScale ? [33.3, 55.6, 72.2, 86.7] : [20, 40, 60, 80]).map(
                      (leftPct) => (
                        <div
                          key={leftPct}
                          className="absolute top-2 bottom-2 w-px bg-white/35 dark:bg-black/25 pointer-events-none"
                          style={{ left: `${leftPct}%` }}
                        />
                      )
                    )}

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
                          borderColor: getGutVibeMeta(previewRating).thumbBorder,
                        }}
                      >
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: getGutVibeMeta(previewRating).thumbBorder }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Vibe Zone Labels aligned under the spectrum line */}
                  <div className="relative h-6 mt-2 select-none text-[11px] font-semibold">
                    {(linearRatingScale
                      ? [
                          { label: 'Skip', rating: 2.5, leftPct: '16.7%', color: 'text-rose-500 dark:text-rose-400' },
                          { label: 'Mid', rating: 5.0, leftPct: '44.4%', color: 'text-amber-600 dark:text-amber-400' },
                          { label: 'Good', rating: 6.8, leftPct: '63.9%', color: 'text-cyan-600 dark:text-cyan-400' },
                          { label: 'Great', rating: 8.2, leftPct: '79.4%', color: 'text-teal-600 dark:text-teal-400' },
                          { label: 'Incredible', rating: 9.4, leftPct: '93.3%', color: 'text-emerald-600 dark:text-emerald-400' },
                        ]
                      : [
                          { label: 'Skip', rating: 2.5, leftPct: '10%', color: 'text-rose-500 dark:text-rose-400' },
                          { label: 'Mid', rating: 5.0, leftPct: '30%', color: 'text-amber-600 dark:text-amber-400' },
                          { label: 'Good', rating: 6.8, leftPct: '50%', color: 'text-cyan-600 dark:text-cyan-400' },
                          { label: 'Great', rating: 8.2, leftPct: '70%', color: 'text-teal-600 dark:text-teal-400' },
                          { label: 'Incredible', rating: 9.4, leftPct: '90%', color: 'text-emerald-600 dark:text-emerald-400' },
                        ]
                    ).map((zone) => (
                      <button
                        key={zone.label}
                        type="button"
                        onMouseEnter={() => setPreviewRating(zone.rating)}
                        onMouseLeave={() =>
                          setPreviewRating(
                            reRankingEntry
                              ? Math.round(reRankingEntry.initialRating * 10) / 10
                              : null
                          )
                        }
                        onClick={() => handlePickRating(zone.rating)}
                        style={{ left: zone.leftPct }}
                        className={`absolute -translate-x-1/2 px-1 py-0.5 rounded hover:opacity-100 transition-opacity ${zone.color} opacity-85 hover:underline`}
                      >
                        {zone.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {!reRankingEntry && onAddBookmark && (
                <div className="pt-1 text-center">
                  <button
                    type="button"
                    onClick={() => onAddBookmark(selectedCandidate)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-rose-500 dark:hover:text-rose-400 transition-colors"
                  >
                    <Bookmark className="w-3.5 h-3.5" />
                    <span>Haven&rsquo;t been yet? Save to Want to Try</span>
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

              {!showAllCategories && displayedCategories.length < ALL_CATEGORIES.length && (
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

import React, { useEffect, useState } from 'react';
import { ArrowLeft, Bookmark, Loader2, MapPin, Plus, Search, X } from 'lucide-react';
import {
  ALL_MEAL_CATEGORIES,
  MEAL_EMOJI,
  MealCategory,
  PlaceCandidate,
  RestaurantEntry,
} from '../types';
import { createManualPlaceCandidate, searchRestaurants } from '../lib/placesService';
import { formatDistanceMiles, getItemDistanceMiles, UserCoordinates } from '../lib/geo';
import { trackEvent } from '../firebase';

interface AddAndRateModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRestaurants: RestaurantEntry[];
  bookmarkedPlaceIds?: Set<string>;
  reRankingEntry?: RestaurantEntry | null;
  defaultCity?: string;
  customPlacesApiKey?: string;
  userLocation?: UserCoordinates | null;
  onCompleteQuestions: (
    candidate: PlaceCandidate,
    initialRating: number,
    selectedMeal: MealCategory,
    existingIdToReplace?: string
  ) => void;
  onAddBookmark?: (candidate: PlaceCandidate) => void;
}

export const AddAndRateModal: React.FC<AddAndRateModalProps> = ({
  isOpen,
  onClose,
  existingRestaurants,
  bookmarkedPlaceIds,
  reRankingEntry,
  defaultCity = '',
  customPlacesApiKey = '',
  userLocation = null,
  onCompleteQuestions,
  onAddBookmark,
}) => {
  const [step, setStep] = useState<'search' | 'q1_rating' | 'q2_meal'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceCandidate[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [selectedCandidate, setSelectedCandidate] = useState<PlaceCandidate | null>(null);
  const [selectedRating, setSelectedRating] = useState<number>(8.0);
  const [previewRating, setPreviewRating] = useState<number | null>(null);
  const [isDraggingLine, setIsDraggingLine] = useState(false);
  const [showAllMeals, setShowAllMeals] = useState(false);

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
        meals: reRankingEntry.meals?.length ? reRankingEntry.meals : [reRankingEntry.meal],
        cuisines: reRankingEntry.cuisines,
        primaryTypeDisplay: reRankingEntry.primaryTypeDisplay,
        source: 'google_places',
      });
      const roundedPrev = Math.round(reRankingEntry.initialRating * 10) / 10;
      setSelectedRating(roundedPrev);
      setPreviewRating(roundedPrev);
      setStep('q1_rating');
      setShowAllMeals(false);
    } else {
      setStep('search');
      setSearchQuery('');
      setSearchResults([]);
      setSelectedCandidate(null);
      setSelectedRating(8.0);
      setPreviewRating(null);
      setShowAllMeals(false);
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
        defaultCity,
        userLocation
      );
      if (!cancelled) {
        setSearchResults(results);
        setIsSearching(false);
      }
    }, 240);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, isOpen, step, customPlacesApiKey, defaultCity, userLocation]);

  const finishWithMeal = (candidate: PlaceCandidate, rating: number, meal: MealCategory) => {
    // Check if this exact (placeId + meal) or (name + address + meal) already exists in the list
    const existingMatch =
      reRankingEntry ||
      existingRestaurants.find(
        (r) =>
          r.meal === meal &&
          ((r.placeId && candidate.placeId && r.placeId === candidate.placeId) ||
            (r.name.toLowerCase() === candidate.name.toLowerCase() &&
              r.formattedAddress === candidate.formattedAddress))
      );

    onCompleteQuestions(candidate, rating, meal, existingMatch?.id);
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

    // If re-ranking an existing entry, its meal is already fixed -> go straight to Q3+ (SxS)
    if (reRankingEntry) {
      finishWithMeal(selectedCandidate, rating, reRankingEntry.meal);
      return;
    }

    const detectedMeals =
      selectedCandidate.meals.length > 0 ? selectedCandidate.meals : (['Dinner'] as MealCategory[]);

    // If this place only serves 1 meal type, skip Q2 and go straight to Q3+ (SxS)
    if (detectedMeals.length === 1) {
      finishWithMeal(selectedCandidate, rating, detectedMeals[0]);
      return;
    }

    setStep('q2_meal');
  };

  const computeRatingFromClientX = (clientX: number, rect: DOMRect): number => {
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return Math.max(1.0, Math.min(10.0, Math.round((1 + pct * 9) * 10) / 10));
  };

  const getGutVibeMeta = (rating: number | null) => {
    if (rating === null) {
      return {
        label: 'Tap anywhere on the line',
        pillClass:
          'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
        thumbBorder: '#10b981',
      };
    }
    if (rating < 4.0) {
      return {
        label: 'Skip · Not good',
        pillClass:
          'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/70',
        thumbBorder: '#f43f5e',
      };
    }
    if (rating < 6.5) {
      return {
        label: 'Mid · It was okay',
        pillClass:
          'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70',
        thumbBorder: '#f59e0b',
      };
    }
    if (rating < 7.6) {
      return {
        label: 'Good · Liked it',
        pillClass:
          'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800/70',
        thumbBorder: '#14b8a6',
      };
    }
    if (rating < 8.8) {
      return {
        label: 'Great · Really liked it',
        pillClass:
          'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70',
        thumbBorder: '#10b981',
      };
    }
    return {
      label: 'Incredible · Loved it',
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
    setShowAllMeals(false);
    setStep('q1_rating');
  };

  const handleCreateManual = () => {
    if (!searchQuery.trim()) return;
    const manual = createManualPlaceCandidate(searchQuery, defaultCity);
    handleSelectCandidate(manual);
  };

  const candidateMeals =
    selectedCandidate && selectedCandidate.meals.length > 0
      ? selectedCandidate.meals
      : (['Dinner', 'Lunch'] as MealCategory[]);

  const displayedMeals = showAllMeals
    ? Array.from(new Set([...candidateMeals, ...ALL_MEAL_CATEGORIES]))
    : candidateMeals;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800 overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Minimal Top Bar */}
        <div className="px-5 pt-4 pb-3 flex items-center justify-between">
          {step !== 'search' && !reRankingEntry ? (
            <button
              type="button"
              onClick={() => setStep(step === 'q2_meal' ? 'q1_rating' : 'search')}
              className="p-1.5 -ml-1.5 rounded-full text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : (
            <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
              {reRankingEntry
                ? `Re-rank · ${reRankingEntry.meal}`
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

        {/* Content */}
        <div className="px-5 pb-6 overflow-y-auto flex-1">
          {step === 'search' && (
            <div className="space-y-3">
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
                      backgroundImage:
                        'linear-gradient(90deg, #f43f5e 0%, #fb7185 24%, #f59e0b 45%, #14b8a6 68%, #10b981 84%, #059669 100%)',
                      backgroundOrigin: 'border-box',
                      backgroundRepeat: 'no-repeat',
                    }}
                  >
                    {/* Subtle Zone Boundary Dividers along the number line (<4 | 4-6 Mid | 7 Good | 8 Great | 9-10 Incredible) */}
                    {[33.3, 61.1, 73.3, 86.7].map((leftPct) => (
                      <div
                        key={leftPct}
                        className="absolute top-2 bottom-2 w-px bg-white/35 dark:bg-black/25 pointer-events-none"
                        style={{ left: `${leftPct}%` }}
                      />
                    ))}

                    {/* Center baseline axis line */}
                    <div className="w-full h-0.5 bg-white/30 mx-3 rounded-full pointer-events-none" />

                    {/* Active / Preview Thumb Marker */}
                    {previewRating !== null && (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-white shadow-lg pointer-events-none flex items-center justify-center transition-transform duration-75"
                        style={{
                          left: `${Math.max(4, Math.min(96, ((previewRating - 1) / 9) * 100))}%`,
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
                    {[
                      { label: 'Skip', rating: 2.5, leftPct: '16%', color: 'text-rose-500 dark:text-rose-400' },
                      { label: 'Mid', rating: 5.2, leftPct: '47%', color: 'text-amber-600 dark:text-amber-400' },
                      { label: 'Good', rating: 7.0, leftPct: '67%', color: 'text-teal-600 dark:text-teal-400' },
                      { label: 'Great', rating: 8.1, leftPct: '80%', color: 'text-emerald-600 dark:text-emerald-400' },
                      { label: 'Incredible', rating: 9.5, leftPct: '93%', color: 'text-emerald-700 dark:text-emerald-300' },
                    ].map((zone) => (
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

          {/* Q2: Pick One Meal (when a restaurant works for multiple meals) */}
          {step === 'q2_meal' && selectedCandidate && (
            <div className="py-3 space-y-5">
              <div className="text-center space-y-1">
                <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                  {selectedCandidate.name}
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Which meal was this for?
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {displayedMeals.map((meal) => {
                  const existingForMeal = existingRestaurants.find(
                    (r) =>
                      r.meal === meal &&
                      ((r.placeId &&
                        selectedCandidate.placeId &&
                        r.placeId === selectedCandidate.placeId) ||
                        (r.name.toLowerCase() === selectedCandidate.name.toLowerCase() &&
                          r.formattedAddress === selectedCandidate.formattedAddress))
                  );

                  return (
                    <button
                      key={meal}
                      type="button"
                      onClick={() => finishWithMeal(selectedCandidate, selectedRating, meal)}
                      className="w-full py-3.5 px-4 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-800/60 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/30 hover:border-emerald-500/60 dark:hover:border-emerald-500/60 text-zinc-900 dark:text-zinc-100 font-semibold text-sm flex items-center justify-between transition-all active:scale-[0.99]"
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="text-base">{MEAL_EMOJI[meal]}</span>
                        <span>{meal}</span>
                      </span>
                      {existingForMeal && (
                        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                          Already ranked ({existingForMeal.magicScore.toFixed(1)}) · Re-rank
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {!showAllMeals && displayedMeals.length < ALL_MEAL_CATEGORIES.length && (
                <button
                  type="button"
                  onClick={() => setShowAllMeals(true)}
                  className="w-full text-center text-xs font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 pt-1"
                >
                  Show other meal options...
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

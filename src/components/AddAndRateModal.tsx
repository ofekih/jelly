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
import { trackEvent } from '../firebase';

interface AddAndRateModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRestaurants: RestaurantEntry[];
  bookmarkedPlaceIds?: Set<string>;
  reRankingEntry?: RestaurantEntry | null;
  defaultCity?: string;
  customPlacesApiKey?: string;
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
  onCompleteQuestions,
  onAddBookmark,
}) => {
  const [step, setStep] = useState<'search' | 'q1_rating' | 'q2_meal'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceCandidate[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [selectedCandidate, setSelectedCandidate] = useState<PlaceCandidate | null>(null);
  const [selectedRating, setSelectedRating] = useState<number>(8);
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
      setSelectedRating(Math.round(reRankingEntry.initialRating));
      setStep('q1_rating');
      setShowAllMeals(false);
    } else {
      setStep('search');
      setSearchQuery('');
      setSearchResults([]);
      setSelectedCandidate(null);
      setSelectedRating(8);
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
      const { results } = await searchRestaurants(trimmed, customPlacesApiKey, defaultCity);
      if (!cancelled) {
        setSearchResults(results);
        setIsSearching(false);
      }
    }, 240);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, isOpen, step, customPlacesApiKey, defaultCity]);

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

  const handlePickRating = (rating: number) => {
    if (!selectedCandidate) return;
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

  // Keyboard support for Q1 (keys 1-9, 0 for 10)
  useEffect(() => {
    if (!isOpen || step !== 'q1_rating') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        handlePickRating( Number(e.key) );
      } else if (e.key === '0') {
        e.preventDefault();
        handlePickRating(10);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!isOpen) return null;

  const handleSelectCandidate = (candidate: PlaceCandidate) => {
    trackEvent('select_search_result', {
      restaurant_name: candidate.name,
      city: candidate.city || '',
      source: candidate.source,
    });
    setSelectedCandidate(candidate);
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
                            {primaryCuisine} · {locationShort}
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

          {/* Q1: Rate 1 to 10 (Integer only, zero clutter) */}
          {step === 'q1_rating' && selectedCandidate && (
            <div className="py-3 space-y-6">
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

              <div className="space-y-3">
                <p className="text-center text-sm font-medium text-zinc-600 dark:text-zinc-300">
                  How would you rate it from 1 to 10?
                </p>

                <div className="grid grid-cols-5 gap-2.5 pt-1">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                    const isCurrent = reRankingEntry && Math.round(selectedRating) === num;
                    return (
                      <button
                        key={num}
                        type="button"
                        onClick={() => handlePickRating(num)}
                        className={`h-13 rounded-2xl font-bold text-base transition-all active:scale-95 ${
                          isCurrent
                            ? 'bg-emerald-600 text-white ring-2 ring-emerald-500/40'
                            : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-900 hover:text-white dark:hover:bg-emerald-500 dark:hover:text-zinc-950 text-zinc-800 dark:text-zinc-100'
                        }`}
                      >
                        {num}
                      </button>
                    );
                  })}
                </div>

                <div className="flex justify-between px-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                  <span>1 · Skip it</span>
                  <span>10 · All-time favorite</span>
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

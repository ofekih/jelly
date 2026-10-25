import React, { useState } from 'react';
import { Bookmark, MapPin, X } from 'lucide-react';
import { BackIcon } from './PlatformIcons';
import {
  CATEGORY_EMOJI,
  CATEGORY_GROUP,
  CATEGORY_LABEL,
  GROUP_CATEGORIES,
  PlaceCandidate,
  RestaurantEntry,
  SpotCategory,
} from '../types';
import { hasSquareCover, posterUrl, spotPlaceLabel } from '../lib/media';
import { GROUP_COPY } from '../lib/groups';
import { categoryOptions, findExistingInCategory } from '../lib/addFlow';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import { useSwipeDownDismiss } from '../lib/useSwipeDownDismiss';
import { pctToSpectrumRating, spectrumGradient, spectrumRatingToPct } from '../lib/rankingEngine';
import { RATING_TIERS, getRatingTier, getVibeLabel } from '../lib/ratingTiers';
import { trackEvent } from '../firebase';
import { PosterThumb } from './PosterThumb';

interface RatingSheetProps {
  candidate: PlaceCandidate;
  /** The list it was searched from (its group bounds the list choice); the entry's own list when re-ranking */
  searchCategory: SpotCategory;
  /** Re-ranking your entry, or ranking a bookmark / For you pick: the list is fixed */
  reRankingEntry?: RestaurantEntry | null;
  existingRestaurants: RestaurantEntry[];
  linearRatingScale: boolean;
  onClose: () => void;
  onComplete: (
    candidate: PlaceCandidate,
    initialRating: number,
    category: SpotCategory,
    existingIdToReplace?: string
  ) => void;
  /** Shows "Haven't been yet? Save to Want to Try" */
  onSaveForLater?: () => void;
}

/**
 * The rating steps as a bottom sheet: the gut-feeling spectrum, then (when the spot fits more than
 * one list) which list it goes in. A sheet rather than a page: it's short, has no text field (so
 * the iOS keyboard never gets involved), and closing it drops you back on the search results or
 * place page it was opened from. Only its top edge drags it down, so sliding along the line never
 * dismisses it.
 */
export const RatingSheet: React.FC<RatingSheetProps> = ({
  candidate,
  searchCategory,
  reRankingEntry,
  existingRestaurants,
  linearRatingScale,
  onClose,
  onComplete,
  onSaveForLater,
}) => {
  const group = CATEGORY_GROUP[reRankingEntry?.category ?? searchCategory];
  const copy = GROUP_COPY[group];
  const isTitles = !copy.hasLocation;
  useBodyScrollLock();
  const swipe = useSwipeDownDismiss({ onClose });
  const previous = reRankingEntry ? Math.round(reRankingEntry.initialRating * 10) / 10 : null;
  const [step, setStep] = useState<'q1_rating' | 'q2_category'>('q1_rating');
  const [selectedRating, setSelectedRating] = useState<number>(previous ?? 8);
  const [previewRating, setPreviewRating] = useState<number | null>(previous);
  const [isDraggingLine, setIsDraggingLine] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);

  const candidateCategories = reRankingEntry ? [reRankingEntry.category] : categoryOptions(candidate, searchCategory);
  const displayedCategories = showAllCategories
    ? Array.from(new Set([...candidateCategories, ...GROUP_CATEGORIES[group]]))
    : candidateCategories;

  const finishWithCategory = (rating: number, category: SpotCategory) => {
    // This exact (placeId + list) or (name + address + list) may already be ranked: replace it
    const existingMatch = reRankingEntry || findExistingInCategory(candidate, category, existingRestaurants);
    onComplete(candidate, rating, category, existingMatch?.id);
  };

  const handlePickRating = (rawRating: number) => {
    const rating = Math.max(1.0, Math.min(10.0, Math.round(rawRating * 10) / 10));
    setSelectedRating(rating);
    trackEvent('rate_initial_score', {
      restaurant_name: candidate.name,
      initial_rating: rating,
      is_rerank: Boolean(reRankingEntry),
    });
    // One list fits (always when re-ranking): straight to the side-by-side
    if (candidateCategories.length === 1) {
      finishWithCategory(rating, candidateCategories[0]);
      return;
    }
    setStep('q2_category');
  };

  const computeRatingFromClientX = (clientX: number, rect: DOMRect): number => {
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return pctToSpectrumRating(pct, linearRatingScale);
  };

  const previewTier = previewRating === null ? null : getRatingTier(previewRating);
  const where = isTitles
    ? spotPlaceLabel(candidate)
    : [candidate.neighborhood, candidate.city].filter(Boolean).join(', ') || candidate.formattedAddress;

  return (
    <div
      data-group={group}
      style={swipe.backdropStyle}
      className="fixed inset-0 z-50 flex justify-center items-end sm:items-center p-0 sm:p-4 bg-black/50 backdrop-blur-xs animate-jelly-backdrop overscroll-contain"
      onClick={onClose}
    >
      <div
        ref={swipe.sheetRef}
        style={swipe.sheetStyle}
        role="dialog"
        aria-modal="true"
        aria-label={`Rank ${candidate.name}`}
        className="w-full max-w-md max-h-[88dvh] bg-white dark:bg-zinc-900 shadow-2xl border border-zinc-200/80 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col overscroll-contain animate-jelly-sheet text-zinc-900 dark:text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          {...swipe.bindHandleTouch}
          className="w-full pt-2.5 pb-1 flex justify-center sm:hidden shrink-0 touch-none select-none cursor-grab active:cursor-grabbing"
        >
          <div className="w-10 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700 pointer-events-none" />
        </div>

        <div
          {...swipe.bindHandleTouch}
          className="px-5 pt-1 sm:pt-4 pb-2 flex items-center justify-between shrink-0 touch-none select-none"
        >
          {step === 'q2_category' ? (
            <button
              type="button"
              onClick={() => setStep('q1_rating')}
              className="p-1.5 -ml-1.5 rounded-full text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              aria-label="Back"
            >
              <BackIcon className="w-5 h-5" />
            </button>
          ) : (
            <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
              {reRankingEntry
                ? `${existingRestaurants.some((r) => r.id === reRankingEntry.id) ? 'Re-rank' : 'Rank'} · ${
                    CATEGORY_LABEL[reRankingEntry.category]
                  }`
                : candidateCategories.length > 1
                ? 'Step 1 of 2'
                : `Rank · ${CATEGORY_LABEL[candidateCategories[0]]}`}
            </span>
          )}
          {step === 'q2_category' && (
            <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
              Step 2 of 2
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

        <div className="px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-6 overflow-y-auto flex-1">
          {step === 'q1_rating' && (
            <div className="py-2 space-y-5">
              <div className="text-center space-y-1">
                {candidate.media?.poster && (
                  <PosterThumb
                    src={posterUrl(candidate.media, 185)}
                    square={hasSquareCover(candidate.placeId)}
                    className="w-20 h-[120px] mx-auto mb-2 shadow-md"
                  />
                )}
                <h2 className="text-xl font-bold">{candidate.name}</h2>
                {where && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center justify-center gap-1">
                    {!isTitles && <MapPin className="w-3 h-3 shrink-0" />}
                    <span className="truncate max-w-xs">{where}</span>
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

                {/* Live vibe pill */}
                <div className="flex justify-center pt-0.5">
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                      previewTier?.pillClass ??
                      'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700'
                    }`}
                  >
                    {previewRating === null
                      ? 'Slide or tap anywhere on the line'
                      : getVibeLabel(previewRating, group, reRankingEntry?.category ?? candidateCategories[0])}
                  </span>
                </div>

                {/* The numberless red-to-green spectrum */}
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
                      setPreviewRating(computeRatingFromClientX(e.clientX, e.currentTarget.getBoundingClientRect()));
                    }}
                    onPointerMove={(e) => {
                      setPreviewRating(computeRatingFromClientX(e.clientX, e.currentTarget.getBoundingClientRect()));
                    }}
                    onPointerUp={(e) => {
                      const val = computeRatingFromClientX(e.clientX, e.currentTarget.getBoundingClientRect());
                      setIsDraggingLine(false);
                      handlePickRating(val);
                    }}
                    onPointerLeave={() => {
                      if (!isDraggingLine) setPreviewRating(previous);
                    }}
                    className="relative h-14 w-full rounded-2xl cursor-pointer select-none touch-none shadow-inner ring-1 ring-inset ring-black/10 dark:ring-white/15 bg-no-repeat flex items-center transition-transform active:scale-[0.995]"
                    style={{
                      backgroundImage: spectrumGradient(linearRatingScale),
                      backgroundOrigin: 'border-box',
                      backgroundRepeat: 'no-repeat',
                    }}
                  >
                    {/* Tier boundaries (or linear 1–10) */}
                    {RATING_TIERS.slice(1).map((tier) => (
                      <div
                        key={tier.name}
                        className="absolute top-2 bottom-2 w-px bg-white/35 dark:bg-black/25 pointer-events-none"
                        style={{ left: `${spectrumRatingToPct(tier.from, linearRatingScale)}%` }}
                      />
                    ))}
                    <div className="w-full h-0.5 bg-white/30 mx-3 rounded-full pointer-events-none" />
                    {previewRating !== null && (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-white shadow-lg pointer-events-none flex items-center justify-center transition-transform duration-75"
                        style={{
                          left: `${Math.max(4, Math.min(96, spectrumRatingToPct(previewRating, linearRatingScale)))}%`,
                          borderWidth: '3px',
                          borderStyle: 'solid',
                          borderColor: previewTier?.thumbColor,
                        }}
                      >
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: previewTier?.thumbColor }} />
                      </div>
                    )}
                  </div>

                  {/* Tier names under the line */}
                  <div className="relative h-6 mt-2 select-none text-[11px] font-semibold">
                    {RATING_TIERS.map((zone) => (
                      <button
                        key={zone.name}
                        type="button"
                        onMouseEnter={() => setPreviewRating(zone.zoneRating)}
                        onMouseLeave={() => setPreviewRating(previous)}
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

              {onSaveForLater && (
                <div className="pt-1 text-center">
                  <button
                    type="button"
                    onClick={onSaveForLater}
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

          {step === 'q2_category' && (
            <div className="py-2 space-y-5">
              <div className="text-center space-y-1">
                <h2 className="text-xl font-bold">{candidate.name}</h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Which list does this go in?</p>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {displayedCategories.map((category) => {
                  const existing = findExistingInCategory(candidate, category, existingRestaurants);
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => finishWithCategory(selectedRating, category)}
                      className="w-full py-3.5 px-4 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-800/60 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/30 hover:border-emerald-500/60 dark:hover:border-emerald-500/60 font-semibold text-sm flex items-center justify-between transition-all active:scale-[0.99]"
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="text-base">{CATEGORY_EMOJI[category]}</span>
                        <span>{CATEGORY_LABEL[category]}</span>
                      </span>
                      {existing && (
                        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                          Already ranked ({existing.magicScore.toFixed(1)}) · Re-rank
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

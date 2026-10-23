import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { CATEGORY_LABEL, RestaurantEntry } from '../types';
import { PendingPlacement, placementPool, PlacementResult } from '../lib/rankingActions';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import { useSwipeDownDismiss } from '../lib/useSwipeDownDismiss';
import {
  getBestInsertionIndex,
  getSearchProgress,
  initSxSSearch,
  pickNextOpponent,
  recordSxSComparison,
  SxSOutcome,
  SxSSearchState,
  undoLastSxSStep,
} from '../lib/rankingEngine';
import { PosterThumb } from './PosterThumb';
import { hasSquareCover, posterUrl, spotPlaceLabel } from '../lib/media';
import { trackEvent } from '../firebase';

interface SxSArenaModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRestaurants: RestaurantEntry[]; // All lists; filtered to the candidate's category
  pendingPlacement: PendingPlacement | null;
  onFinishPlacement: (placement: PendingPlacement, result: PlacementResult) => void;
}

export const SxSArenaModal: React.FC<SxSArenaModalProps> = ({
  isOpen,
  onClose,
  existingRestaurants,
  pendingPlacement,
  onFinishPlacement,
}) => {
  useBodyScrollLock(isOpen);
  const swipe = useSwipeDownDismiss({ onClose });
  const [searchState, setSearchState] = useState<SxSSearchState | null>(null);

  const pool = useMemo(() => {
    return pendingPlacement ? placementPool(existingRestaurants, pendingPlacement) : [];
  }, [existingRestaurants, pendingPlacement]);

  useEffect(() => {
    if (!isOpen || !pendingPlacement) return;
    const initial = initSxSSearch(
      pool,
      pendingPlacement.initialRating,
      pendingPlacement.cuisines
    );
    setSearchState(initial);
  }, [isOpen, pendingPlacement, pool]);

  const currentMatch = useMemo(() => {
    if (!searchState) return null;
    return pickNextOpponent(searchState, pool);
  }, [searchState, pool]);

  const finishWithState = (state: SxSSearchState) => {
    if (!pendingPlacement) return;
    const { insertIndex } = getBestInsertionIndex(state);
    onFinishPlacement(pendingPlacement, {
      insertIndex,
      comparisonsDone: state.completedComparisons,
      answers: state.history.flatMap((h) =>
        h.outcome === 'skip'
          ? []
          : [{ opponentId: h.opponentId, result: h.outcome === 'new_wins' ? 1 : h.outcome === 'tie' ? 0.5 : 0 }]
      ),
    });
  };

  // Auto-finish if pool is empty or no opponent needed
  useEffect(() => {
    if (!isOpen || !pendingPlacement || !searchState) return;
    if (pool.length === 0) {
      finishWithState(searchState);
    }
    // finishWithState is rebuilt every render; this only reacts to the search itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pendingPlacement, searchState, pool.length]);

  const handleChoice = (outcome: SxSOutcome) => {
    if (!searchState || !currentMatch || !pendingPlacement) return;
    trackEvent('sxs_choice', {
      outcome,
      step: searchState.completedComparisons + 1,
      candidate_name: pendingPlacement.candidate.name,
      opponent_name: currentMatch.opponent.name,
    });
    const nextState = recordSxSComparison(
      searchState,
      currentMatch.opponentIndex,
      currentMatch.opponent,
      outcome
    );
    setSearchState(nextState);

    const nextOpponent = pickNextOpponent(nextState, pool);
    if (!nextOpponent) {
      finishWithState(nextState);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen || !currentMatch) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleChoice('new_wins');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleChoice('opponent_wins');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleChoice('tie');
      } else if (e.key === ' ') {
        e.preventDefault();
        handleChoice('skip');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!isOpen || !pendingPlacement || !searchState || !currentMatch) return null;

  // How sure jelly already is of the spot (log scale), with a sliver shown from the start
  const progressPct = Math.round(8 + 92 * getSearchProgress(searchState));

  // A title's genre is already in the card's label, so its sub is just the year and director
  const candidateSub = pendingPlacement.candidate.media
    ? spotPlaceLabel(pendingPlacement.candidate)
    : [
        pendingPlacement.cuisines[0] || pendingPlacement.candidate.primaryTypeDisplay,
        pendingPlacement.candidate.neighborhood || pendingPlacement.candidate.city,
      ]
        .filter(Boolean)
        .join(' · ');

  const opponentSub = currentMatch.opponent.media
    ? spotPlaceLabel(currentMatch.opponent)
    : [
        currentMatch.opponent.cuisines[0] || currentMatch.opponent.primaryTypeDisplay,
        currentMatch.opponent.neighborhood || currentMatch.opponent.city,
      ]
        .filter(Boolean)
        .join(' · ');

  return (
    <div
      style={swipe.backdropStyle}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-xs p-0 sm:p-4 animate-jelly-backdrop"
    >
      <div
        ref={swipe.sheetRef}
        style={swipe.sheetStyle}
        className="w-full max-w-xl bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800 overflow-hidden flex flex-col animate-jelly-sheet sm:animate-jelly-dialog overscroll-contain"
      >
        {/* Subtle Progress Line */}
        <div className="w-full h-1 bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Mobile swipe-down handle: dragging the top edge down closes the sheet */}
        <div
          {...swipe.bindHandleTouch}
          className="w-full pt-2.5 pb-1 flex justify-center sm:hidden cursor-grab active:cursor-grabbing shrink-0 touch-none select-none"
        >
          <div className="w-10 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700 pointer-events-none" />
        </div>

        {/* Minimal Top Header */}
        <div {...swipe.bindHandleTouch} className="px-5 pt-2 sm:pt-4 pb-2 flex items-center justify-between touch-none select-none">
          <div className="w-8">
            {searchState.history.length > 0 && (
              <button
                type="button"
                onClick={() => setSearchState(undoLastSxSStep(searchState))}
                className="p-1.5 -ml-1.5 rounded-full text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                title="Undo last pick"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
          </div>

          <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
            Which do you prefer?
          </span>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 -mr-1.5 rounded-full text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Clean Two-Card Comparison */}
        <div className="p-5 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Left Option: New / Re-ranking Spot */}
            <button
              type="button"
              onClick={() => handleChoice('new_wins')}
              className="group text-left p-5 sm:p-6 rounded-2xl border-2 border-zinc-200/90 dark:border-zinc-800 hover:border-emerald-500 dark:hover:border-emerald-400 bg-zinc-50/50 dark:bg-zinc-800/40 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/20 transition-all flex flex-col justify-between min-h-[136px] sm:min-h-[168px] active:scale-[0.99]"
            >
              <div className="flex items-start gap-3">
                {pendingPlacement.candidate.media && (
                  <PosterThumb src={posterUrl(pendingPlacement.candidate.media, 154)} square={hasSquareCover(pendingPlacement.candidate.placeId)} className="w-12 h-[72px]" />
                )}
                <div className="space-y-1.5 min-w-0">
                  <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    {[CATEGORY_LABEL[pendingPlacement.category], pendingPlacement.cuisines[0]]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <h3 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 leading-snug group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                    {pendingPlacement.candidate.name}
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                    {candidateSub || pendingPlacement.candidate.formattedAddress}
                  </p>
                </div>
              </div>

              <div className="pt-4 text-xs font-semibold text-zinc-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                Tap to pick ←
              </div>
            </button>

            {/* Right Option: Existing Spot */}
            <button
              type="button"
              onClick={() => handleChoice('opponent_wins')}
              className="group text-left p-5 sm:p-6 rounded-2xl border-2 border-zinc-200/90 dark:border-zinc-800 hover:border-emerald-500 dark:hover:border-emerald-400 bg-zinc-50/50 dark:bg-zinc-800/40 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/20 transition-all flex flex-col justify-between min-h-[136px] sm:min-h-[168px] active:scale-[0.99]"
            >
              <div className="flex items-start gap-3">
                {currentMatch.opponent.media && (
                  <PosterThumb src={posterUrl(currentMatch.opponent.media, 154)} square={hasSquareCover(currentMatch.opponent.placeId)} className="w-12 h-[72px]" />
                )}
                <div className="space-y-1.5 min-w-0">
                  <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    {[
                      currentMatch.opponent.cuisines[0],
                      `#${currentMatch.opponent.rankIndex + 1}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <h3 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 leading-snug group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                    {currentMatch.opponent.name}
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                    {opponentSub || currentMatch.opponent.formattedAddress}
                  </p>
                </div>
              </div>

              <div className="pt-4 text-xs font-semibold text-zinc-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors sm:text-right">
                Tap to pick →
              </div>
            </button>
          </div>

          {/* Minimal Secondary Actions */}
          <div className="flex items-center justify-center gap-6 pt-1 text-xs font-medium text-zinc-400 dark:text-zinc-500">
            <button
              type="button"
              onClick={() => handleChoice('tie')}
              className="hover:text-zinc-800 dark:hover:text-zinc-200 py-1 px-2 rounded-lg transition-colors"
            >
              Too tough to call
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => handleChoice('skip')}
              className="hover:text-zinc-800 dark:hover:text-zinc-200 py-1 px-2 rounded-lg transition-colors"
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

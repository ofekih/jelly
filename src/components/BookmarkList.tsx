import React from 'react';
import { Bookmark, ExternalLink, Plus, Sparkles, Trash2 } from 'lucide-react';
import { BookmarkEntry, MealCategory } from '../types';
import { formatDistanceMiles, getItemDistanceMiles, UserCoordinates } from '../lib/geo';
import { JellyBeanIcon } from './JellyBeanIcon';

interface BookmarkListProps {
  bookmarks: BookmarkEntry[];
  isFiltered: boolean;
  selectedMealFilter: MealCategory | 'ALL';
  totalUnfilteredCount: number;
  userLocation?: UserCoordinates | null;
  readOnly?: boolean;
  onRankBookmark: (bookmark: BookmarkEntry) => void;
  onDeleteBookmark: (id: string) => void;
  onOpenAddModal: () => void;
}

export const BookmarkList: React.FC<BookmarkListProps> = ({
  bookmarks,
  isFiltered,
  selectedMealFilter,
  totalUnfilteredCount,
  userLocation = null,
  readOnly = false,
  onRankBookmark,
  onDeleteBookmark,
  onOpenAddModal,
}) => {
  if (totalUnfilteredCount === 0) {
    return (
      <div className="py-16 px-6 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 space-y-4">
        <div className="flex justify-center">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 dark:bg-rose-500/15 flex items-center justify-center">
            <Bookmark className="w-5 h-5 text-rose-500" />
          </div>
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            Your Want to Try list is empty
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto">
            Search any spot and tap the bookmark icon to save places friends recommend before you go.
          </p>
        </div>

        {!readOnly && (
          <div className="pt-1">
            <button
              type="button"
              onClick={onOpenAddModal}
              className="px-4 py-2.5 rounded-full bg-zinc-900 hover:bg-zinc-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-zinc-950 font-semibold text-xs inline-flex items-center gap-1.5 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Find a Place to Save</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  if (bookmarks.length === 0 && isFiltered) {
    return (
      <div className="py-12 px-4 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          No saved spots match this filter.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 divide-y divide-zinc-100 dark:divide-zinc-800/80 overflow-hidden shadow-2xs">
      {bookmarks.map((item) => {
        const primaryCuisine = item.cuisines[0] || item.primaryTypeDisplay;
        const locationLabel = item.neighborhood || item.city;
        const rawMiles = getItemDistanceMiles(item, userLocation);
        const distLabel = formatDistanceMiles(rawMiles);
        const subtitleParts = [
          selectedMealFilter === 'ALL' ? item.meal : null,
          primaryCuisine,
          locationLabel,
          distLabel,
        ].filter(Boolean);

        return (
          <div
            key={item.id}
            className="flex items-center gap-3 px-3.5 sm:px-4 py-3.5 hover:bg-zinc-50/90 dark:hover:bg-zinc-800/50 transition-colors"
          >
            <div className="w-6 flex items-center justify-center shrink-0">
              <JellyBeanIcon size={18} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm sm:text-[15px] truncate leading-snug">
                {item.name}
              </div>
              <div className="text-xs text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                {subtitleParts.length > 0 ? subtitleParts.join(' · ') : item.formattedAddress}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {item.googleMapsUri && (
                <a
                  href={item.googleMapsUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  title="Open in Google Maps"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}

              {!readOnly && (
                <>
                  <button
                    type="button"
                    onClick={() => onRankBookmark(item)}
                    className="px-3 py-1.5 rounded-full bg-zinc-900 hover:bg-zinc-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-zinc-950 text-xs font-bold inline-flex items-center gap-1 transition-colors"
                    title="Been here! Rate & rank it now"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Rank</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onDeleteBookmark(item.id)}
                    className="p-1.5 rounded-full text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                    title="Remove from Want to Try"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

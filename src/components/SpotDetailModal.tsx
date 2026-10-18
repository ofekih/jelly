import React, { useEffect, useState } from 'react';
import {
  Bookmark,
  Calendar,
  ExternalLink,
  MapPin,
  Pencil,
  RefreshCw,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  ALL_MEAL_CATEGORIES,
  COMMON_CUISINES,
  FriendSpotMatch,
  MealCategory,
  RankedHistoryEvent,
  RestaurantEntry,
} from '../types';
import { SpotSocialMetrics } from '../lib/friendsService';
import { ScoreBadge } from './ScoreBadge';

function formatRankedDate(ts: number): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(ts));
  } catch {
    return '';
  }
}

interface SpotDetailModalProps {
  restaurant: RestaurantEntry | null;
  readOnly?: boolean;
  friendOwnerName?: string;
  friendMatches?: FriendSpotMatch[];
  socialMetrics?: SpotSocialMetrics | null;
  isBookmarkedInMyList?: boolean;
  onSaveFromFriendToBookmark?: (restaurant: RestaurantEntry) => void;
  onClose: () => void;
  onReRank: (restaurant: RestaurantEntry) => void;
  onSaveEdits: (
    id: string,
    updates: {
      meal: MealCategory;
      cuisines: string[];
      priceLevel?: number;
      notes?: string;
    }
  ) => void;
  onDelete: (id: string) => void;
}

export const SpotDetailModal: React.FC<SpotDetailModalProps> = ({
  restaurant,
  readOnly = false,
  friendOwnerName,
  friendMatches = [],
  socialMetrics = null,
  isBookmarkedInMyList = false,
  onSaveFromFriendToBookmark,
  onClose,
  onReRank,
  onSaveEdits,
  onDelete,
}) => {
  const [isEditMode, setIsEditMode] = useState(false);
  const [meal, setMeal] = useState<MealCategory>('Dinner');
  const [cuisines, setCuisines] = useState<string[]>([]);
  const [priceLevel, setPriceLevel] = useState<number | undefined>(undefined);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!restaurant) return;
    setIsEditMode(false);
    setMeal(restaurant.meal || 'Dinner');
    setCuisines(restaurant.cuisines || []);
    setPriceLevel(restaurant.priceLevel);
    setNotes(restaurant.notes || '');
  }, [restaurant]);

  if (!restaurant) return null;

  const toggleCuisine = (c: string) => {
    setCuisines((prev) => (prev.includes(c) ? prev.filter((item) => item !== c) : [...prev, c]));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveEdits(restaurant.id, {
      meal,
      cuisines,
      priceLevel,
      notes: notes.trim() || undefined,
    });
    setIsEditMode(false);
    onClose();
  };

  const allCuisineOptions = Array.from(new Set([...cuisines, ...COMMON_CUISINES]));

  // Build chronological ranking history (newest first)
  const historyEvents: RankedHistoryEvent[] =
    restaurant.rankedHistory && restaurant.rankedHistory.length > 0
      ? [...restaurant.rankedHistory].sort((a, b) => b.timestamp - a.timestamp)
      : [
          {
            timestamp: restaurant.updatedAt || restaurant.createdAt,
            initialRating: restaurant.initialRating,
            magicScore: restaurant.magicScore,
          },
        ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800 overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              <span>#{restaurant.rankIndex + 1} Overall</span>
              <span>·</span>
              <span className="text-emerald-600 dark:text-emerald-400">{restaurant.meal}</span>
            </div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mt-0.5 leading-snug">
              {restaurant.name}
            </h2>
            {restaurant.formattedAddress && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{restaurant.formattedAddress}</span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <ScoreBadge score={restaurant.magicScore} size="md" />
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {!isEditMode ? (
          <div className="px-5 pb-6 space-y-4 overflow-y-auto">
            {/* Subtle Metadata Row */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              {restaurant.priceLevel && (
                <span className="px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 font-semibold text-zinc-700 dark:text-zinc-300">
                  {'$'.repeat(restaurant.priceLevel)}
                </span>
              )}
              {restaurant.cuisines.map((c) => (
                <span
                  key={c}
                  className="px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 font-medium text-zinc-700 dark:text-zinc-300"
                >
                  {c}
                </span>
              ))}
              <span className="px-2.5 py-1 rounded-lg bg-zinc-100/70 dark:bg-zinc-800/60 text-zinc-400 dark:text-zinc-500">
                {restaurant.elo} ELO · Gut {Number(restaurant.initialRating).toFixed(1)}/10
              </span>
            </div>

            {/* Ranking Date / History Section */}
            <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 px-3.5 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-300">
                <span className="flex items-center gap-1.5 font-medium">
                  <Calendar className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  <span>
                    {historyEvents.length > 1 ? 'Last ranked' : 'Ranked'}{' '}
                    {formatRankedDate(historyEvents[0].timestamp)}
                  </span>
                </span>
                {historyEvents.length > 1 && (
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    Ranked {historyEvents.length} times
                  </span>
                )}
              </div>

              {historyEvents.length > 1 && (
                <div className="pt-1 border-t border-zinc-200/60 dark:border-zinc-700/60 space-y-1">
                  {historyEvents.map((ev, idx) => (
                    <div
                      key={`${ev.timestamp}_${idx}`}
                      className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400"
                    >
                      <span>{formatRankedDate(ev.timestamp)}</span>
                      <span>Gut {Number(ev.initialRating).toFixed(1)}/10</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {restaurant.notes && (
              <p className="text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-xl">
                {restaurant.notes}
              </p>
            )}

            {/* Community Averages & Personalized Taste Prediction */}
            {socialMetrics &&
              (socialMetrics.friendsAvg !== null ||
                socialMetrics.communityAvg !== null ||
                socialMetrics.predictedScore !== null) && (
                <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 p-3.5 space-y-2.5 bg-zinc-50/50 dark:bg-zinc-800/30">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-white dark:bg-zinc-900/90 border border-zinc-200/60 dark:border-zinc-800 p-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                        Friends Avg
                      </div>
                      <div className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100 mt-0.5 tabular-nums">
                        {socialMetrics.friendsAvg !== null
                          ? socialMetrics.friendsAvg.toFixed(1)
                          : '—'}
                      </div>
                      <div className="text-[10px] text-zinc-400">
                        {socialMetrics.friendsCount > 0
                          ? `${socialMetrics.friendsCount} ${
                              socialMetrics.friendsCount === 1 ? 'friend' : 'friends'
                            }`
                          : 'None yet'}
                      </div>
                    </div>

                    <div className="rounded-xl bg-white dark:bg-zinc-900/90 border border-zinc-200/60 dark:border-zinc-800 p-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                        jelly Avg
                      </div>
                      <div className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100 mt-0.5 tabular-nums">
                        {socialMetrics.communityAvg !== null
                          ? socialMetrics.communityAvg.toFixed(1)
                          : '—'}
                      </div>
                      <div className="text-[10px] text-zinc-400">
                        {socialMetrics.communityCount > 0
                          ? `${socialMetrics.communityCount} ${
                              socialMetrics.communityCount === 1 ? 'user' : 'users'
                            }`
                          : 'None yet'}
                      </div>
                    </div>

                    <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                        For You
                      </div>
                      <div className="text-sm font-extrabold text-emerald-700 dark:text-emerald-300 mt-0.5 tabular-nums">
                        {socialMetrics.predictedScore !== null
                          ? `~${socialMetrics.predictedScore.toFixed(1)}`
                          : '—'}
                      </div>
                      <div className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80">
                        Predicted
                      </div>
                    </div>
                  </div>

                  {socialMetrics.predictionBasis && socialMetrics.predictedScore !== null && (
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 text-center">
                      {socialMetrics.predictionBasis}
                    </div>
                  )}
                </div>
              )}

            {/* Friends Who Ranked or Saved This Spot */}
            {friendMatches.length > 0 && (
              <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    <Users className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Friends ({friendMatches.length})</span>
                  </div>
                  {socialMetrics?.friendsAvg !== null && socialMetrics?.friendsAvg !== undefined && (
                    <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      Avg {socialMetrics.friendsAvg.toFixed(1)}
                    </span>
                  )}
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                  {friendMatches.map((fm) => (
                    <div key={fm.friendUid} className="py-2 first:pt-0 last:pb-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold flex items-center justify-center shrink-0">
                            {fm.friendName.slice(0, 1).toUpperCase()}
                          </div>
                          <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                            {fm.friendName}
                          </span>
                          <span className="text-[11px] text-zinc-400">
                            {fm.status === 'ranked' && fm.rankIndex !== undefined
                              ? `#${fm.rankIndex + 1} · ${fm.meal}`
                              : `Want to Try · ${fm.meal}`}
                          </span>
                        </div>

                        {fm.status === 'ranked' && fm.magicScore !== undefined ? (
                          <ScoreBadge score={fm.magicScore} size="sm" />
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-500 text-[10px] font-semibold">
                            Bookmarked
                          </span>
                        )}
                      </div>
                      {fm.notes && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 pl-8 italic">
                          &ldquo;{fm.notes}&rdquo;
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Primary Action: Beli-style Re-Rank (or Save to Want to Try + Maps in Friend Read-Only mode) */}
            {!readOnly ? (
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onReRank(restaurant);
                  }}
                  className="w-full py-3 px-4 rounded-2xl bg-zinc-900 hover:bg-zinc-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-zinc-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Re-rank {restaurant.name}</span>
                </button>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsEditMode(true)}
                    className="py-2.5 px-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Edit Details</span>
                  </button>

                  {restaurant.googleMapsUri ? (
                    <a
                      href={restaurant.googleMapsUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-2.5 px-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Maps</span>
                    </a>
                  ) : (
                    <div />
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      onDelete(restaurant.id);
                      onClose();
                    }}
                    className="py-2.5 px-3 rounded-xl bg-zinc-100 hover:bg-rose-50 dark:bg-zinc-800 dark:hover:bg-rose-950/40 text-zinc-500 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-400 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                {onSaveFromFriendToBookmark && (
                  <button
                    type="button"
                    onClick={() => {
                      onSaveFromFriendToBookmark(restaurant);
                      onClose();
                    }}
                    className={`w-full py-3 px-4 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors ${
                      isBookmarkedInMyList
                        ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }`}
                  >
                    <Bookmark
                      className={`w-4 h-4 ${isBookmarkedInMyList ? 'fill-current' : ''}`}
                    />
                    <span>
                      {isBookmarkedInMyList
                        ? 'Saved in Your Want to Try'
                        : `Save to Want to Try${
                            friendOwnerName ? ` (Rec by ${friendOwnerName})` : ''
                          }`}
                    </span>
                  </button>
                )}

                {restaurant.googleMapsUri && (
                  <a
                    href={restaurant.googleMapsUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-2.5 px-4 rounded-2xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open in Google Maps</span>
                  </a>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Hidden Edit Menu — Only visible when user explicitly clicks "Edit Details" */
          <form onSubmit={handleSave} className="px-5 pb-6 space-y-4 overflow-y-auto">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 block mb-1.5">
                Meal
              </label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_MEAL_CATEGORIES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMeal(m)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                      meal === m
                        ? 'bg-zinc-900 text-white dark:bg-emerald-500 dark:text-zinc-950'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Cuisine
                </label>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriceLevel(priceLevel === p ? undefined : p)}
                      className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        priceLevel === p
                          ? 'bg-zinc-900 text-white dark:bg-emerald-500 dark:text-zinc-950'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      {'$'.repeat(p)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                {allCuisineOptions.map((c) => {
                  const active = cuisines.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleCuisine(c)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                        active
                          ? 'bg-zinc-900 text-white dark:bg-emerald-500 dark:text-zinc-950'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 block mb-1">
                Personal Note (Optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add a private note..."
                className="w-full px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsEditMode(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-zinc-900 dark:bg-emerald-500 text-white dark:text-zinc-950 text-xs font-semibold"
              >
                Save
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

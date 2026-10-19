import React, { useEffect, useState } from 'react';
import {
  Bookmark,
  Calendar,
  Check,
  ExternalLink,
  MapPin,
  Pencil,
  RefreshCw,
  Share2,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  CATEGORY_LABEL,
  COMMON_CUISINES,
  FriendSpotMatch,
  RankedHistoryEvent,
  RestaurantEntry,
} from '../types';
import { SpotSocialMetrics } from '../lib/friendsService';
import { useSwipeDownDismiss } from '../lib/useSwipeDownDismiss';
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
  const [isEditingNoteInline, setIsEditingNoteInline] = useState(false);
  const [cuisines, setCuisines] = useState<string[]>([]);
  const [priceLevel, setPriceLevel] = useState<number | undefined>(undefined);
  const [notes, setNotes] = useState('');
  const [copiedSpotShare, setCopiedSpotShare] = useState(false);

  const {
    sheetStyle,
    backdropStyle,
    sheetRef,
    scrollContainerRef,
    bindSheetTouch,
    bindHandleTouch,
  } = useSwipeDownDismiss({ onClose });

  useEffect(() => {
    if (!restaurant) return;
    setIsEditMode(false);
    setIsEditingNoteInline(false);
    setCuisines(restaurant.cuisines || []);
    setPriceLevel(restaurant.priceLevel);
    setNotes(restaurant.notes || '');
    setCopiedSpotShare(false);
  }, [restaurant]);

  if (!restaurant) return null;

  const toggleCuisine = (c: string) => {
    setCuisines((prev) => (prev.includes(c) ? prev.filter((item) => item !== c) : [...prev, c]));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveEdits(restaurant.id, {
      cuisines,
      priceLevel,
      notes: notes.trim() || undefined,
    });
    setIsEditMode(false);
    onClose();
  };

  const handleSaveInlineNote = () => {
    onSaveEdits(restaurant.id, {
      cuisines: restaurant.cuisines || [],
      priceLevel: restaurant.priceLevel,
      notes: notes.trim() || undefined,
    });
    setIsEditingNoteInline(false);
  };

  const handleShareSpot = async () => {
    const shareTitle = `${restaurant.name} on jelly`;
    const sub = [
      CATEGORY_LABEL[restaurant.category],
      restaurant.cuisines[0] || restaurant.primaryTypeDisplay,
      restaurant.neighborhood || restaurant.city,
    ]
      .filter(Boolean)
      .join(' · ');
    const shareText = `${restaurant.name} (${restaurant.magicScore.toFixed(1)}/10)${
      sub ? ` — ${sub}` : ''
    }${restaurant.notes ? `\n"${restaurant.notes}"` : ''}`;
    const shareUrl = restaurant.googleMapsUri || window.location.origin;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      setCopiedSpotShare(true);
      setTimeout(() => setCopiedSpotShare(false), 2200);
    } catch {
      // Ignore
    }
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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-0 sm:p-4 animate-jelly-backdrop overscroll-contain"
      style={backdropStyle}
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        {...bindSheetTouch}
        style={sheetStyle}
        className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800 overflow-hidden flex flex-col max-h-[88vh] animate-jelly-sheet overscroll-contain touch-manipulation"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile Swipe-Down Handle Pill */}
        <div
          {...bindHandleTouch}
          className="w-full pt-2.5 pb-1 flex justify-center sm:hidden cursor-grab active:cursor-grabbing shrink-0 touch-none select-none"
        >
          <div className="w-10 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700 pointer-events-none" />
        </div>

        <div className="px-5 pt-3 sm:pt-5 pb-4 flex items-start justify-between gap-3 touch-none select-none">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              <span>
                #{restaurant.rankIndex + 1} in{' '}
                <span className="text-emerald-600 dark:text-emerald-400">
                  {CATEGORY_LABEL[restaurant.category]}
                </span>
              </span>
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
          <div ref={scrollContainerRef} className="px-5 pb-6 space-y-4 overflow-y-auto">
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

            {/* Multi-line Personal Note Section (inline editable for your own spots) */}
            {!readOnly ? (
              isEditingNoteInline ? (
                <div className="space-y-2 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 p-3 border border-zinc-200/80 dark:border-zinc-700">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 block">
                    Personal Note
                  </label>
                  <textarea
                    rows={4}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="What did you order? What stood out? Would you come back?"
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 leading-relaxed resize-y min-h-[96px] focus:outline-none focus:border-emerald-500"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setNotes(restaurant.notes || '');
                        setIsEditingNoteInline(false);
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs font-medium text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveInlineNote}
                      className="px-3.5 py-1.5 rounded-xl bg-zinc-900 dark:bg-emerald-500 text-white dark:text-zinc-950 text-xs font-semibold"
                    >
                      Save Note
                    </button>
                  </div>
                </div>
              ) : restaurant.notes ? (
                <button
                  type="button"
                  onClick={() => setIsEditingNoteInline(true)}
                  className="w-full text-left group rounded-xl bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100/80 dark:hover:bg-zinc-800 p-3.5 transition-colors space-y-1"
                  title="Click to edit note"
                >
                  <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    <span>Your Note</span>
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <Pencil className="w-2.5 h-2.5" />
                      Edit
                    </span>
                  </div>
                  <p className="text-xs text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed">
                    {restaurant.notes}
                  </p>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingNoteInline(true)}
                  className="w-full py-2.5 px-3.5 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-left flex items-center gap-2 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5 shrink-0" />
                  <span>Add a note (favorite dishes, thoughts...)</span>
                </button>
              )
            ) : (
              restaurant.notes && (
                <p className="text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/50 p-3.5 rounded-xl whitespace-pre-wrap leading-relaxed">
                  {restaurant.notes}
                </p>
              )
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
                              ? `#${fm.rankIndex + 1} in ${CATEGORY_LABEL[fm.category]}`
                              : `Want to Try · ${CATEGORY_LABEL[fm.category]}`}
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
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 pl-8 italic whitespace-pre-wrap">
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

                <div className="grid grid-cols-4 gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsEditMode(true)}
                    className="py-2.5 px-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-medium flex items-center justify-center gap-1 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5 shrink-0" />
                    <span>Edit</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleShareSpot}
                    className="py-2.5 px-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-medium flex items-center justify-center gap-1 transition-colors"
                  >
                    {copiedSpotShare ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Share2 className="w-3.5 h-3.5 shrink-0" />
                        <span>Share</span>
                      </>
                    )}
                  </button>

                  <a
                    href={
                      restaurant.googleMapsUri ||
                      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                        `${restaurant.name} ${restaurant.formattedAddress || restaurant.city || ''}`
                      )}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-2.5 px-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-medium flex items-center justify-center gap-1 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    <span>Maps</span>
                  </a>

                  <button
                    type="button"
                    onClick={() => {
                      onDelete(restaurant.id);
                    }}
                    className="py-2.5 px-2 rounded-xl bg-zinc-100 hover:bg-rose-50 dark:bg-zinc-800 dark:hover:bg-rose-950/40 text-zinc-500 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-400 text-xs font-medium flex items-center justify-center gap-1 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
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
                        ? 'Remove from Want to Try'
                        : `Save to Want to Try${
                            friendOwnerName ? ` (Rec by ${friendOwnerName})` : ''
                          }`}
                    </span>
                  </button>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleShareSpot}
                    className="py-2.5 px-4 rounded-2xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
                  >
                    {copiedSpotShare ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Share2 className="w-3.5 h-3.5" />
                        <span>Share Spot</span>
                      </>
                    )}
                  </button>

                  <a
                    href={
                      restaurant.googleMapsUri ||
                      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                        `${restaurant.name} ${restaurant.formattedAddress || restaurant.city || ''}`
                      )}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-2.5 px-4 rounded-2xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Google Maps</span>
                  </a>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Edit Menu */
          <form ref={scrollContainerRef} onSubmit={handleSave} className="px-5 pb-6 space-y-4 overflow-y-auto">
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
              <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 block mb-1.5">
                Personal Note (Optional)
              </label>
              <textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What did you order? Favorite dishes, vibe, or notes..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-100 leading-relaxed resize-y min-h-[96px] focus:outline-none"
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

import React, { useEffect, useRef, useState } from 'react';
import { Bookmark, Copy, ExternalLink, Plus, Sparkles, Trash2 } from 'lucide-react';
import { BookmarkEntry, CATEGORY_GROUP, CATEGORY_LABEL, RestaurantEntry, SharedListPayload, SpotCategory } from '../types';
import { GROUP_COPY, hasLocation, spotPrice, wantLabel } from '../lib/groups';
import { hasSquareCover, posterUrl, spotLink, spotPlaceLabel } from '../lib/media';
import { PosterThumb } from './PosterThumb';
import { CommunityStat, getSpotSocialMetrics } from '../lib/friendsService';
import { placeStatKey } from '../lib/socialService';
import { usePlaceStats } from '../lib/usePlaceStats';
import { usePredictions } from '../lib/usePredictions';
import type { TastePrediction } from '../lib/tasteModel';
import { formatDistanceMiles, getItemDistanceMiles, UserCoordinates } from '../lib/geo';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { JellyBeanIcon } from './JellyBeanIcon';

interface SwipeableBookmarkRowProps {
  item: BookmarkEntry;
  userLocation: UserCoordinates | null;
  readOnly: boolean;
  myUid?: string | null;
  myRestaurants?: RestaurantEntry[];
  friendLists?: SharedListPayload[];
  communityStat?: CommunityStat | null;
  serverPrediction?: TastePrediction | null;
  openSwipeId: string | null;
  onSetOpenSwipeId: (id: string | null) => void;
  onRankBookmark: (bookmark: BookmarkEntry) => void;
  onDeleteBookmark: (id: string) => void;
  onSaveFromFriendBookmark?: (bookmark: BookmarkEntry) => void;
  isAlreadySavedByMe?: boolean;
  friendName?: string;
  onContextMenu?: (e: React.MouseEvent, item: BookmarkEntry) => void;
}

const SwipeableBookmarkRow: React.FC<SwipeableBookmarkRowProps> = ({
  item,
  userLocation,
  readOnly,
  myUid = null,
  myRestaurants = [],
  friendLists = [],
  communityStat = null,
  serverPrediction = null,
  openSwipeId,
  onSetOpenSwipeId,
  onRankBookmark,
  onDeleteBookmark,
  onSaveFromFriendBookmark,
  isAlreadySavedByMe = false,
  friendName,
  onContextMenu,
}) => {
  const [swipeX, setSwipeX] = useState(0);
  const [isTouchTracking, setIsTouchTracking] = useState(false);
  const touchStateRef = useRef<{
    startX: number;
    startY: number;
    baseSwipeX: number;
    mode: 'undecided' | 'horizontal' | 'vertical';
  } | null>(null);

  useEffect(() => {
    if (openSwipeId !== item.id && swipeX !== 0 && !isTouchTracking) {
      setSwipeX(0);
    }
  }, [openSwipeId, item.id, swipeX, isTouchTracking]);

  const primaryCuisine = item.cuisines[0] || item.primaryTypeDisplay;
  const want = wantLabel(item.category);
  const locationLabel = spotPlaceLabel(item);
  const rawMiles = getItemDistanceMiles(item, userLocation);
  const distLabel = formatDistanceMiles(rawMiles);
  const subtitleParts = [
    primaryCuisine,
    spotPrice(item, item.category),
    locationLabel,
    distLabel,
  ].filter(Boolean);

  const socialMetrics =
    myRestaurants.length > 0 || friendLists.length > 0 || communityStat
      ? getSpotSocialMetrics(item, {
          myUid,
          myRestaurants,
          friendLists,
          communityStat,
          serverPrediction,
        })
      : null;

  const link = spotLink(item);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (readOnly || e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStateRef.current = {
      startX: t.clientX,
      startY: t.clientY,
      baseSwipeX: openSwipeId === item.id ? swipeX : 0,
      mode: 'undecided',
    };
    if (openSwipeId && openSwipeId !== item.id) {
      onSetOpenSwipeId(null);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (readOnly || !touchStateRef.current || e.touches.length !== 1) return;
    const t = e.touches[0];
    const state = touchStateRef.current;
    const dx = t.clientX - state.startX;
    const dy = t.clientY - state.startY;

    if (state.mode === 'undecided') {
      if (Math.abs(dx) > 11 && Math.abs(dx) > Math.abs(dy) * 1.25) {
        state.mode = 'horizontal';
        setIsTouchTracking(true);
      } else if (Math.abs(dy) > 11) {
        state.mode = 'vertical';
      }
    }

    if (state.mode === 'horizontal') {
      const rawNext = state.baseSwipeX + dx;
      const clamped = Math.max(-156, Math.min(128, rawNext));
      setSwipeX(clamped);
    }
  };

  const handleTouchEnd = () => {
    if (!touchStateRef.current) return;
    const state = touchStateRef.current;
    touchStateRef.current = null;
    setIsTouchTracking(false);

    if (state.mode !== 'horizontal') return;

    // Full swipe right -> trigger Rank It Now immediately
    if (swipeX >= 96) {
      setSwipeX(0);
      onSetOpenSwipeId(null);
      onRankBookmark(item);
      return;
    }

    // Partial swipe right -> snap open Rank It button
    if (swipeX >= 44) {
      setSwipeX(88);
      onSetOpenSwipeId(item.id);
      return;
    }

    // Swipe left -> snap open Maps + Remove buttons
    if (swipeX <= -44) {
      setSwipeX(-144);
      onSetOpenSwipeId(item.id);
      return;
    }

    setSwipeX(0);
    if (openSwipeId === item.id) {
      onSetOpenSwipeId(null);
    }
  };

  return (
    <div className="relative overflow-hidden select-none">
      {/* Background Swipe Actions Layer */}
      {!readOnly && swipeX !== 0 && (
        <div className="absolute inset-0 flex items-stretch justify-between pointer-events-auto">
          {/* Left Action (Swipe Right): Rank It Now */}
          <div
            className={`flex items-center pl-3 pr-4 bg-emerald-600 text-white transition-opacity ${
              swipeX > 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            style={{ width: Math.max(88, swipeX) }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSwipeX(0);
                onSetOpenSwipeId(null);
                onRankBookmark(item);
              }}
              className="flex flex-col items-center justify-center gap-1 w-full h-full text-[11px] font-bold tracking-tight"
            >
              <Sparkles className="w-4 h-4" />
              <span>Rank It</span>
            </button>
          </div>

          {/* Right Actions (Swipe Left): Google Maps + Remove */}
          <div
            className={`flex items-stretch ml-auto transition-opacity ${
              swipeX < 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            style={{ width: Math.max(144, Math.abs(swipeX)) }}
          >
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.stopPropagation();
                setSwipeX(0);
                onSetOpenSwipeId(null);
              }}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white flex flex-col items-center justify-center gap-1 text-[11px] font-bold tracking-tight"
            >
              <ExternalLink className="w-4 h-4" />
              <span>{link.label}</span>
            </a>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSwipeX(0);
                onSetOpenSwipeId(null);
                onDeleteBookmark(item.id);
              }}
              className="flex-1 bg-rose-600 hover:bg-rose-500 text-white flex flex-col items-center justify-center gap-1 text-[11px] font-bold tracking-tight"
            >
              <Trash2 className="w-4 h-4" />
              <span>Remove</span>
            </button>
          </div>
        </div>
      )}

      {/* Foreground Card Content */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => {
          if (swipeX !== 0) {
            setSwipeX(0);
            onSetOpenSwipeId(null);
          }
        }}
        onContextMenu={(e) => onContextMenu?.(e, item)}
        style={{
          transform: swipeX !== 0 ? `translate3d(${swipeX}px, 0, 0)` : undefined,
          transition: isTouchTracking ? 'none' : 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          WebkitTouchCallout: 'none',
        }}
        className="relative flex items-center gap-3 px-3.5 sm:px-4 py-3.5 bg-white dark:bg-zinc-900 hover:bg-zinc-50/90 dark:hover:bg-zinc-800/50 transition-colors touch-pan-y"
      >
        {item.media ? (
          <PosterThumb src={posterUrl(item.media)} square={hasSquareCover(item.placeId)} className="w-8 h-12 -my-1" />
        ) : (
          <div className="w-6 flex items-center justify-center shrink-0">
            <JellyBeanIcon size={18} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm sm:text-[15px] truncate leading-snug">
              {item.name}
            </div>
            {item.recommendedBy && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold shrink-0">
                Rec by {item.recommendedBy}
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-400 dark:text-zinc-500 truncate mt-0.5 flex items-center gap-1.5">
            <span className="truncate">
              {subtitleParts.length > 0 ? subtitleParts.join(' · ') : item.formattedAddress}
            </span>
            {socialMetrics && socialMetrics.predictedScore !== null && (
              <span
                className="px-1.5 py-0.2 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold shrink-0"
                title={socialMetrics.predictionBasis || 'Predicted score for you'}
              >
                ~{socialMetrics.predictedScore.toFixed(1)} for you
              </span>
            )}
            {socialMetrics && socialMetrics.friendsAvg !== null && (
              <span className="px-1.5 py-0.2 rounded-md bg-teal-500/10 text-teal-700 dark:text-teal-300 text-[10px] font-semibold shrink-0">
                Friends {socialMetrics.friendsAvg.toFixed(1)}
              </span>
            )}
            {socialMetrics && socialMetrics.communityAvg !== null && (
              <span className="px-1.5 py-0.2 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-[10px] font-semibold shrink-0">
                jelly {socialMetrics.communityAvg.toFixed(1)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {(item.googleMapsUri || item.media) && (
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title={`Open in ${link.site}`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}

          {readOnly && onSaveFromFriendBookmark && (
            <button
              type="button"
              onClick={() => onSaveFromFriendBookmark(item)}
              className={`p-1.5 rounded-full transition-colors ${
                isAlreadySavedByMe
                  ? 'text-rose-500 bg-rose-500/10'
                  : 'text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10'
              }`}
              title={
                isAlreadySavedByMe
                  ? `Saved in your ${want}`
                  : `Save to your ${want}${friendName ? ` (Rec by ${friendName})` : ''}`
              }
            >
              <Bookmark className={`w-4 h-4 ${isAlreadySavedByMe ? 'fill-rose-500' : ''}`} />
            </button>
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
                title={`Remove from ${want}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

interface BookmarkListProps {
  bookmarks: BookmarkEntry[];
  isFiltered: boolean;
  selectedCategory: SpotCategory;
  totalUnfilteredCount: number;
  userLocation?: UserCoordinates | null;
  readOnly?: boolean;
  myUid?: string | null;
  myRestaurants?: RestaurantEntry[];
  friendLists?: SharedListPayload[];
  onRankBookmark: (bookmark: BookmarkEntry) => void;
  onDeleteBookmark: (id: string) => void;
  onOpenAddModal: () => void;
  onSaveFromFriendBookmark?: (bookmark: BookmarkEntry) => void;
  myBookmarkedPlaceIds?: Set<string>;
  myBookmarkedNames?: Set<string>;
  friendName?: string;
}

export const BookmarkList: React.FC<BookmarkListProps> = ({
  bookmarks,
  isFiltered,
  selectedCategory,
  totalUnfilteredCount,
  userLocation = null,
  readOnly = false,
  myUid = null,
  myRestaurants = [],
  friendLists = [],
  onRankBookmark,
  onDeleteBookmark,
  onOpenAddModal,
  onSaveFromFriendBookmark,
  myBookmarkedPlaceIds,
  myBookmarkedNames,
  friendName,
}) => {
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const statFor = usePlaceStats(
    bookmarks.map((b) => placeStatKey(b.placeId, b.category)).filter((k): k is string => Boolean(k))
  );
  const predictionFor = usePredictions();
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
    bookmark: BookmarkEntry | null;
  }>({ isOpen: false, x: 0, y: 0, bookmark: null });

  const handleContextMenu = (e: React.MouseEvent, item: BookmarkEntry) => {
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) {
      return;
    }
    e.preventDefault();
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      bookmark: item,
    });
  };

  const contextMenuItems: ContextMenuItem[] = contextMenu.bookmark
    ? [
        ...(!readOnly
          ? [
              {
                label: `${GROUP_COPY[CATEGORY_GROUP[contextMenu.bookmark.category]].done}, Rank It!`,
                icon: <Sparkles className="w-4 h-4 text-emerald-500" />,
                onClick: () => onRankBookmark(contextMenu.bookmark!),
              },
            ]
          : []),
        {
          label: `Open in ${spotLink(contextMenu.bookmark).site}`,
          icon: <ExternalLink className="w-4 h-4 text-blue-500" />,
          onClick: () => window.open(spotLink(contextMenu.bookmark!).href, '_blank'),
        },
        ...(contextMenu.bookmark.formattedAddress && !contextMenu.bookmark.media
          ? [
              {
                label: 'Copy Address',
                icon: <Copy className="w-4 h-4 text-zinc-400" />,
                onClick: () => {
                  navigator.clipboard.writeText(contextMenu.bookmark!.formattedAddress || '');
                },
              },
            ]
          : []),
        ...(readOnly && onSaveFromFriendBookmark
          ? [
              {
                label:
                  (contextMenu.bookmark.placeId &&
                    myBookmarkedPlaceIds?.has(contextMenu.bookmark.placeId)) ||
                  myBookmarkedNames?.has(contextMenu.bookmark.name.trim().toLowerCase())
                    ? `Remove from ${wantLabel(contextMenu.bookmark.category)}`
                    : `Save to ${wantLabel(contextMenu.bookmark.category)}`,
                icon: <Bookmark className="w-4 h-4 text-rose-500" />,
                onClick: () => onSaveFromFriendBookmark(contextMenu.bookmark!),
              },
            ]
          : []),
        ...(!readOnly
          ? [
              {
                label: `Remove from ${wantLabel(contextMenu.bookmark.category)}`,
                icon: <Trash2 className="w-4 h-4 text-rose-500" />,
                danger: true,
                onClick: () => onDeleteBookmark(contextMenu.bookmark!.id),
              },
            ]
          : []),
      ]
    : [];

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
            No {CATEGORY_LABEL[selectedCategory]} to try yet
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto">
            {hasLocation(selectedCategory)
              ? 'Search any spot and tap the bookmark icon to save places friends recommend before you go.'
              : 'Search any title and tap the bookmark icon to save what friends recommend for later.'}
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
    <>
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 divide-y divide-zinc-100 dark:divide-zinc-800/80 overflow-hidden shadow-2xs">
        {bookmarks.map((item) => {
          const isAlreadySavedByMe = Boolean(
            (item.placeId && myBookmarkedPlaceIds?.has(item.placeId)) ||
              myBookmarkedNames?.has(item.name.trim().toLowerCase())
          );
          return (
            <SwipeableBookmarkRow
              key={item.id}
              item={item}
              userLocation={userLocation}
              readOnly={readOnly}
              myUid={myUid}
              myRestaurants={myRestaurants}
              friendLists={friendLists}
              communityStat={statFor(placeStatKey(item.placeId, item.category)) ?? null}
              serverPrediction={predictionFor(item)}
              openSwipeId={openSwipeId}
              onSetOpenSwipeId={setOpenSwipeId}
              onRankBookmark={onRankBookmark}
              onDeleteBookmark={onDeleteBookmark}
              onSaveFromFriendBookmark={onSaveFromFriendBookmark}
              isAlreadySavedByMe={isAlreadySavedByMe}
              friendName={friendName}
              onContextMenu={handleContextMenu}
            />
          );
        })}
      </div>

      <ContextMenu
        isOpen={contextMenu.isOpen}
        x={contextMenu.x}
        y={contextMenu.y}
        items={contextMenuItems}
        onClose={() => setContextMenu((prev) => ({ ...prev, isOpen: false }))}
      />
    </>
  );
};

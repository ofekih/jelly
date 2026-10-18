import React, { useEffect, useRef, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bookmark, ExternalLink, GripVertical, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { MealCategory, RestaurantEntry, SharedListPayload } from '../types';
import { getFriendMatchesForSpot, getSpotSocialMetrics, isSameSpot } from '../lib/friendsService';
import { formatDistanceMiles, getItemDistanceMiles, UserCoordinates } from '../lib/geo';
import { JellyBeanIcon } from './JellyBeanIcon';
import { ScoreBadge } from './ScoreBadge';

interface SortableRestaurantRowProps {
  restaurant: RestaurantEntry;
  displayPosition: number;
  isFiltered: boolean;
  sortByNearest?: boolean;
  readOnly?: boolean;
  selectedMealFilter: MealCategory | 'ALL';
  userLocation?: UserCoordinates | null;
  myUid?: string | null;
  myRestaurants?: RestaurantEntry[];
  friendLists?: SharedListPayload[];
  communityLists?: SharedListPayload[];
  isBookmarkedInMyList?: boolean;
  onBookmarkFromFriend?: (restaurant: RestaurantEntry) => void;
  openSwipeId: string | null;
  onSetOpenSwipeId: (id: string | null) => void;
  onSelectSpot: (restaurant: RestaurantEntry) => void;
  onReRankSpot?: (restaurant: RestaurantEntry) => void;
  onDeleteSpot?: (id: string) => void;
}

const SortableRestaurantRow: React.FC<SortableRestaurantRowProps> = ({
  restaurant,
  displayPosition,
  isFiltered,
  sortByNearest = false,
  readOnly = false,
  selectedMealFilter,
  userLocation = null,
  myUid = null,
  myRestaurants = [],
  friendLists = [],
  communityLists = [],
  isBookmarkedInMyList = false,
  onBookmarkFromFriend,
  openSwipeId,
  onSetOpenSwipeId,
  onSelectSpot,
  onReRankSpot,
  onDeleteSpot,
}) => {
  const isDragDisabled = isFiltered || sortByNearest || readOnly;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: restaurant.id,
    disabled: isDragDisabled,
  });

  const [swipeX, setSwipeX] = useState(0);
  const [isTouchTracking, setIsTouchTracking] = useState(false);
  const touchStateRef = useRef<{
    startX: number;
    startY: number;
    baseSwipeX: number;
    mode: 'undecided' | 'horizontal' | 'vertical';
    didSwipe: boolean;
  } | null>(null);

  // Close this row's swipe drawer if another row is swiped open or if dragging starts
  useEffect(() => {
    if (isDragging) {
      setSwipeX(0);
      setIsTouchTracking(false);
      touchStateRef.current = null;
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(10);
        } catch {
          // Ignore vibration errors on unsupported browsers
        }
      }
      return;
    }
    if (openSwipeId !== restaurant.id && swipeX !== 0 && !isTouchTracking) {
      setSwipeX(0);
    }
  }, [openSwipeId, restaurant.id, isDragging, swipeX, isTouchTracking]);

  const dndStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : 1,
  };

  const rankNum =
    sortByNearest
      ? restaurant.rankIndex + 1
      : isFiltered
      ? displayPosition
      : restaurant.rankIndex + 1;

  const primaryCuisine = restaurant.cuisines[0] || restaurant.primaryTypeDisplay;
  const locationLabel =
    restaurant.neighborhood ||
    restaurant.city ||
    restaurant.formattedAddress.split(',')[1]?.trim() ||
    restaurant.formattedAddress.split(',')[0]?.trim();

  const rawMiles = getItemDistanceMiles(restaurant, userLocation);
  const distLabel =
    rawMiles !== null
      ? sortByNearest && rawMiles >= 100
        ? `${Math.round(rawMiles)} mi`
        : formatDistanceMiles(rawMiles)
      : null;

  const subtitleParts = [
    selectedMealFilter === 'ALL' ? restaurant.meal : null,
    primaryCuisine,
    locationLabel,
    distLabel,
  ].filter(Boolean);

  const rankedFriends =
    !readOnly && friendLists.length > 0
      ? getFriendMatchesForSpot(restaurant, friendLists).filter((f) => f.status === 'ranked')
      : [];

  const socialMetrics =
    friendLists.length > 0 || communityLists.length > 0
      ? getSpotSocialMetrics(restaurant, {
          myUid,
          myRestaurants,
          friendLists,
          communityLists,
        })
      : null;

  const alreadyRankedByMe =
    readOnly && myRestaurants.some((r) => isSameSpot(r, restaurant));

  const mapsHref =
    restaurant.googleMapsUri ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${restaurant.name} ${restaurant.formattedAddress || restaurant.city || ''}`
    )}`;

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    // Always invoke @dnd-kit TouchSensor's onTouchStart first so drag-to-reorder works on iOS & Android
    if (!isDragDisabled && listeners?.onTouchStart) {
      listeners.onTouchStart(e);
    }
    if (readOnly || e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStateRef.current = {
      startX: t.clientX,
      startY: t.clientY,
      baseSwipeX: openSwipeId === restaurant.id ? swipeX : 0,
      mode: 'undecided',
      didSwipe: false,
    };
    if (openSwipeId && openSwipeId !== restaurant.id) {
      onSetOpenSwipeId(null);
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (readOnly || isDragging || !touchStateRef.current || e.touches.length !== 1) return;
    const t = e.touches[0];
    const state = touchStateRef.current;
    const dx = t.clientX - state.startX;
    const dy = t.clientY - state.startY;

    if (state.mode === 'undecided') {
      // Require >14px horizontal movement (>10px TouchSensor tolerance) before entering swipe mode
      if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        state.mode = 'horizontal';
        state.didSwipe = true;
        setIsTouchTracking(true);
      } else if (Math.abs(dy) > 12) {
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

    if (state.mode !== 'horizontal' || isDragging) {
      return;
    }

    // Full swipe right -> trigger Re-rank immediately
    if (swipeX >= 96 && onReRankSpot) {
      setSwipeX(0);
      onSetOpenSwipeId(null);
      onReRankSpot(restaurant);
      return;
    }

    // Partial swipe right -> snap open Re-rank button
    if (swipeX >= 44) {
      setSwipeX(88);
      onSetOpenSwipeId(restaurant.id);
      return;
    }

    // Swipe left -> snap open Maps + Remove buttons
    if (swipeX <= -44) {
      setSwipeX(-144);
      onSetOpenSwipeId(restaurant.id);
      return;
    }

    setSwipeX(0);
    if (openSwipeId === restaurant.id) {
      onSetOpenSwipeId(null);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={dndStyle}
      className={`relative overflow-hidden select-none ${
        isDragging ? 'rounded-2xl z-30 shadow-2xl ring-2 ring-emerald-500/60' : ''
      }`}
    >
      {/* Background Swipe Actions Layer (visible when swiping left or right on mobile) */}
      {!readOnly && swipeX !== 0 && !isDragging && (
        <div className="absolute inset-0 flex items-stretch justify-between pointer-events-auto">
          {/* Left Action (Swipe Right): Re-rank */}
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
                onReRankSpot?.(restaurant);
              }}
              className="flex flex-col items-center justify-center gap-1 w-full h-full text-[11px] font-bold tracking-tight"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Re-rank</span>
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
              href={mapsHref}
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
              <span>Maps</span>
            </a>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSwipeX(0);
                onSetOpenSwipeId(null);
                onDeleteSpot?.(restaurant.id);
              }}
              className="flex-1 bg-rose-600 hover:bg-rose-500 text-white flex flex-col items-center justify-center gap-1 text-[11px] font-bold tracking-tight"
            >
              <Trash2 className="w-4 h-4" />
              <span>Remove</span>
            </button>
          </div>
        </div>
      )}

      {/* Foreground Card Content (draggable anywhere + swipeable horizontally on mobile) */}
      <div
        {...(!isDragDisabled ? attributes : {})}
        {...(!isDragDisabled ? listeners : {})}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onClick={() => {
          if (isDragging) return;
          if (swipeX !== 0) {
            setSwipeX(0);
            onSetOpenSwipeId(null);
            return;
          }
          onSelectSpot(restaurant);
        }}
        style={{
          transform: swipeX !== 0 && !isDragging ? `translate3d(${swipeX}px, 0, 0)` : undefined,
          transition: isTouchTracking ? 'none' : 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
        }}
        className={`group relative flex items-center justify-between gap-3 px-3.5 sm:px-4 py-3.5 bg-white dark:bg-zinc-900 hover:bg-zinc-50/90 dark:hover:bg-zinc-800/60 transition-colors ${
          !isDragDisabled
            ? 'cursor-grab active:cursor-grabbing touch-manipulation'
            : 'cursor-pointer'
        } ${isDragging ? 'scale-[1.01] opacity-95 touch-none' : ''}`}
      >
        {/* Left: Subtle Grip Indicator + Rank Number + Name/Subtitle */}
        <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0 flex-1">
          <div
            data-drag-handle={!isDragDisabled ? 'true' : undefined}
            className={`flex items-center gap-2 sm:gap-2.5 shrink-0 py-1 -my-1 ${
              !isDragDisabled ? 'touch-none' : ''
            }`}
          >
            {!isDragDisabled && (
              <span
                className="p-1 -ml-1.5 rounded-lg text-zinc-300 dark:text-zinc-700 group-hover:text-zinc-400 dark:group-hover:text-zinc-500 transition-colors pointer-events-none"
                aria-hidden="true"
              >
                <GripVertical className="w-4 h-4" />
              </span>
            )}

            <span
              className="w-6 text-right font-bold text-sm tabular-nums text-zinc-400 dark:text-zinc-500 shrink-0"
              title={sortByNearest ? `Overall Rank #${rankNum}` : undefined}
            >
              {sortByNearest ? `#${rankNum}` : rankNum}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="font-semibold text-[15px] sm:text-base text-zinc-900 dark:text-zinc-100 truncate leading-snug">
              {restaurant.name}
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5 flex items-center gap-1.5">
              <span className="truncate">{subtitleParts.join(' · ')}</span>
              {rankedFriends.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold shrink-0">
                  {rankedFriends.length <= 2
                    ? rankedFriends
                        .map((rf) => `${rf.friendName} ${rf.magicScore?.toFixed(1)}`)
                        .join(' · ')
                    : `Friends ${socialMetrics?.friendsAvg?.toFixed(1)} (${rankedFriends.length})`}
                </span>
              )}
              {socialMetrics &&
                socialMetrics.communityAvg !== null &&
                socialMetrics.communityCount >= 2 && (
                  <span
                    className="px-1.5 py-0.2 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-[10px] font-semibold shrink-0"
                    title={`Average across ${socialMetrics.communityCount} jelly users`}
                  >
                    jelly {socialMetrics.communityAvg.toFixed(1)}
                  </span>
                )}
              {readOnly &&
                !alreadyRankedByMe &&
                socialMetrics &&
                socialMetrics.predictedScore !== null && (
                  <span
                    className="px-1.5 py-0.2 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold shrink-0"
                    title={socialMetrics.predictionBasis || 'Predicted score for you'}
                  >
                    ~{socialMetrics.predictedScore.toFixed(1)} for you
                  </span>
                )}
            </div>
          </div>
        </div>

        {/* Right: 1-tap Bookmark when viewing a friend's list + Circular Score Badge */}
        <div className="flex items-center gap-2 shrink-0">
          {readOnly && onBookmarkFromFriend && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onBookmarkFromFriend(restaurant);
              }}
              className={`p-2 rounded-full transition-colors ${
                isBookmarkedInMyList
                  ? 'text-rose-500 bg-rose-50 dark:bg-rose-950/40'
                  : 'text-zinc-400 hover:text-rose-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
              title={isBookmarkedInMyList ? 'Saved in your Want to Try' : 'Save to Want to Try'}
              aria-label="Save to Want to Try"
            >
              <Bookmark className={`w-4 h-4 ${isBookmarkedInMyList ? 'fill-rose-500' : ''}`} />
            </button>
          )}

          <ScoreBadge score={restaurant.magicScore} size="md" />
        </div>
      </div>
    </div>
  );
};

interface RestaurantListProps {
  restaurants: RestaurantEntry[];
  isFiltered: boolean;
  sortByNearest?: boolean;
  readOnly?: boolean;
  selectedMealFilter: MealCategory | 'ALL';
  totalUnfilteredCount: number;
  userLocation?: UserCoordinates | null;
  myUid?: string | null;
  myRestaurants?: RestaurantEntry[];
  friendLists?: SharedListPayload[];
  communityLists?: SharedListPayload[];
  bookmarkedPlaceIds?: Set<string>;
  onBookmarkFromFriend?: (restaurant: RestaurantEntry) => void;
  onReorderDragEnd: (activeId: string, overId: string) => void;
  onSelectSpot: (restaurant: RestaurantEntry) => void;
  onReRankSpot?: (restaurant: RestaurantEntry) => void;
  onDeleteSpot?: (id: string) => void;
  onOpenAddModal: () => void;
}

export const RestaurantList: React.FC<RestaurantListProps> = ({
  restaurants,
  isFiltered,
  sortByNearest = false,
  readOnly = false,
  selectedMealFilter,
  totalUnfilteredCount,
  userLocation = null,
  myUid = null,
  myRestaurants = [],
  friendLists = [],
  communityLists = [],
  bookmarkedPlaceIds,
  onBookmarkFromFriend,
  onReorderDragEnd,
  onSelectSpot,
  onReRankSpot,
  onDeleteSpot,
  onOpenAddModal,
}) => {
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 130, tolerance: 10 },
      bypassActivationConstraint: ({ event }) => {
        const target = event.target as HTMLElement | null;
        return Boolean(target?.closest?.('[data-drag-handle="true"]'));
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    setOpenSwipeId(null);
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onReorderDragEnd(String(active.id), String(over.id));
    }
  };

  if (restaurants.length === 0) {
    return (
      <div className="py-16 px-6 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 space-y-4">
        <div className="flex justify-center">
          <JellyBeanIcon size={36} />
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {totalUnfilteredCount === 0
            ? 'No places ranked yet.'
            : 'No places match this filter.'}
        </p>
        {totalUnfilteredCount === 0 && !readOnly && (
          <button
            type="button"
            onClick={onOpenAddModal}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-zinc-900 dark:bg-emerald-500 text-white dark:text-zinc-950 text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            <span>Add your first place</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={restaurants.map((r) => r.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/90 divide-y divide-zinc-100 dark:divide-zinc-800/80 overflow-hidden shadow-2xs">
          {restaurants.map((restaurant, idx) => {
            const isBookmarked = Boolean(
              restaurant.placeId && bookmarkedPlaceIds?.has(restaurant.placeId)
            );
            return (
              <SortableRestaurantRow
                key={restaurant.id}
                restaurant={restaurant}
                displayPosition={idx + 1}
                isFiltered={isFiltered}
                sortByNearest={sortByNearest}
                readOnly={readOnly}
                selectedMealFilter={selectedMealFilter}
                userLocation={userLocation}
                myUid={myUid}
                myRestaurants={myRestaurants}
                friendLists={friendLists}
                communityLists={communityLists}
                isBookmarkedInMyList={isBookmarked}
                onBookmarkFromFriend={onBookmarkFromFriend}
                openSwipeId={openSwipeId}
                onSetOpenSwipeId={setOpenSwipeId}
                onSelectSpot={onSelectSpot}
                onReRankSpot={onReRankSpot}
                onDeleteSpot={onDeleteSpot}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
};


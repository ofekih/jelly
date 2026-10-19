import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Check, ExternalLink, Navigation, Sparkles, Users } from 'lucide-react';
import {
  ALL_CATEGORIES,
  BookmarkEntry,
  CATEGORY_EMOJI,
  CATEGORY_LABEL,
  DEFAULT_CATEGORY,
  FriendProfile,
  SpotCategory,
  PlaceCandidate,
  RestaurantEntry,
  SharedListPayload,
} from '../types';
import { BlendSpotItem, computeGroupBlend } from '../lib/friendsService';
import { formatDistanceMiles, getItemDistanceMiles, UserCoordinates } from '../lib/geo';
import { Sheet, SheetHeader } from './Sheet';
import { ScoreBadge } from './ScoreBadge';

interface EatTogetherModalProps {
  isOpen: boolean;
  onClose: () => void;
  friends: FriendProfile[];
  friendListsMap: Record<string, SharedListPayload>;
  initialSelectedFriendUid?: string | null;
  myRestaurants: RestaurantEntry[];
  myBookmarks: BookmarkEntry[];
  bookmarkedPlaceIds: Set<string>;
  userLocation?: UserCoordinates | null;
  onSaveFriendSpotToBookmarks: (
    candidate: PlaceCandidate,
    recommendedByLabel: string,
    recommendedByUid?: string
  ) => void;
  onOpenFriendsModal: () => void;
}

export const EatTogetherModal: React.FC<EatTogetherModalProps> = ({
  isOpen,
  onClose,
  friends,
  friendListsMap,
  initialSelectedFriendUid,
  myRestaurants,
  myBookmarks,
  bookmarkedPlaceIds,
  userLocation = null,
  onSaveFriendSpotToBookmarks,
  onOpenFriendsModal,
}) => {
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [activeSection, setActiveSection] = useState<
    'both_want' | 'shared_favorites' | 'from_friends'
  >('shared_favorites');
  // Lists are never mixed: the blend always shows a single category
  const [categoryFilter, setCategoryFilter] = useState<SpotCategory>(DEFAULT_CATEGORY);
  const [sortByNearest, setSortByNearest] = useState(false);

  const hasInitializedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      hasInitializedRef.current = false;
      return;
    }
    if (initialSelectedFriendUid) {
      setSelectedFriendIds([initialSelectedFriendUid]);
    } else if (friends.length > 0 && selectedFriendIds.length === 0) {
      setSelectedFriendIds([friends[0].uid]);
    }
  }, [isOpen, initialSelectedFriendUid, friends]);

  const activeFriendLists = useMemo(() => {
    return selectedFriendIds
      .map((uid) => friendListsMap[uid])
      .filter((fl): fl is SharedListPayload => Boolean(fl));
  }, [selectedFriendIds, friendListsMap]);

  const blend = useMemo(() => {
    return computeGroupBlend(myRestaurants, myBookmarks, activeFriendLists);
  }, [myRestaurants, myBookmarks, activeFriendLists]);

  // Auto-select the first non-empty tab only when opening
  useEffect(() => {
    if (!isOpen) return;
    if (hasInitializedRef.current) return;
    if (blend.bothWantToTry.length > 0) {
      setActiveSection('both_want');
      hasInitializedRef.current = true;
    } else if (blend.sharedFavorites.length > 0) {
      setActiveSection('shared_favorites');
      hasInitializedRef.current = true;
    } else if (blend.forYouFromFriends.length > 0) {
      setActiveSection('from_friends');
      hasInitializedRef.current = true;
    }
  }, [isOpen, blend]);

  if (!isOpen) return null;

  const toggleFriend = (uid: string) => {
    setSelectedFriendIds((prev) => {
      if (prev.includes(uid)) {
        if (prev.length === 1) return prev; // Keep at least 1 selected
        return prev.filter((id) => id !== uid);
      }
      return [...prev, uid];
    });
  };

  const rawList: BlendSpotItem[] =
    activeSection === 'both_want'
      ? blend.bothWantToTry
      : activeSection === 'shared_favorites'
      ? blend.sharedFavorites
      : blend.forYouFromFriends;

  const filteredList = rawList
    .filter((item) => item.category === categoryFilter)
    .slice()
    .sort((a, b) => {
      if (sortByNearest && userLocation) {
        const da = getItemDistanceMiles(a, userLocation) ?? 999999;
        const db = getItemDistanceMiles(b, userLocation) ?? 999999;
        if (da !== db) return da - db;
      }
      return (b.combinedScore || 0) - (a.combinedScore || 0);
    });

  return (
    <Sheet onClose={onClose} maxWidthClassName="max-w-lg" maxHeightClassName="max-h-[88vh]">
      {(scrollContainerRef) => (
        <>
          <SheetHeader
            icon={<Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
            title="Eat Together · Blend"
            onClose={onClose}
          >
            {blend.tasteMatchPct !== null && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold">
                {blend.tasteMatchPct}% Taste Match
              </span>
            )}
          </SheetHeader>

          {friends.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <Users className="w-8 h-8 text-zinc-400 mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Add a friend to blend your lists
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto">
                  Follow a friend to see overlapping Want to Try spots, shared favorites, and their top recommendations.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenFriendsModal();
                }}
                className="px-4 py-2 rounded-full bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 transition-colors"
              >
                Add Friends
              </button>
            </div>
          ) : (
            <div ref={scrollContainerRef} className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1">
              {/* Select Friends to Blend With */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                <span className="px-2.5 py-1 rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-xs font-semibold shrink-0">
                  You
                </span>
                <span className="text-xs text-zinc-400 font-bold">+</span>
                {friends.map((f) => {
                  const active = selectedFriendIds.includes(f.uid);
                  return (
                    <button
                      key={f.uid}
                      type="button"
                      onClick={() => toggleFriend(f.uid)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold shrink-0 flex items-center gap-1.5 transition-colors ${
                        active
                          ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                      }`}
                    >
                      <span>{f.name}</span>
                      {active && <Check className="w-3 h-3" />}
                    </button>
                  );
                })}
              </div>

              {/* 3 Blend Mode Tabs */}
              <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-zinc-100 dark:bg-zinc-800/80">
                <button
                  type="button"
                  onClick={() => setActiveSection('both_want')}
                  className={`py-2 px-2 rounded-xl text-xs font-semibold transition-all ${
                    activeSection === 'both_want'
                      ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  Both Want ({blend.bothWantToTry.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSection('shared_favorites')}
                  className={`py-2 px-2 rounded-xl text-xs font-semibold transition-all ${
                    activeSection === 'shared_favorites'
                      ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  Shared ({blend.sharedFavorites.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSection('from_friends')}
                  className={`py-2 px-2 rounded-xl text-xs font-semibold transition-all ${
                    activeSection === 'from_friends'
                      ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  Try Next ({blend.forYouFromFriends.length})
                </button>
              </div>

              {/* Category & Near Me Filter Bar */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {userLocation && (
                  <button
                    type="button"
                    onClick={() => setSortByNearest((p) => !p)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 flex items-center gap-1 transition-colors ${
                      sortByNearest
                        ? 'bg-blue-600 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    <Navigation className="w-3 h-3" />
                    <span>Near Me</span>
                  </button>
                )}
                {ALL_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategoryFilter(c)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 flex items-center gap-1 transition-colors ${
                      categoryFilter === c
                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    <span aria-hidden="true">{CATEGORY_EMOJI[c]}</span>
                    <span>{CATEGORY_LABEL[c]}</span>
                  </button>
                ))}
              </div>

              {/* Results List */}
              {filteredList.length === 0 ? (
                <div className="py-10 px-4 text-center rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {activeSection === 'both_want'
                      ? 'No overlapping Want to Try spots yet—try the "Try Next" tab to bookmark your friend’s top picks!'
                      : activeSection === 'shared_favorites'
                      ? 'No overlapping ranked spots for this filter yet.'
                      : 'No unvisited top picks for this filter.'}
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800/80 overflow-hidden">
                  {filteredList.map((item) => {
                    const primaryCuisine = item.cuisines[0] || item.primaryTypeDisplay;
                    const locationShort = item.neighborhood || item.city;
                    const distLabel = formatDistanceMiles(getItemDistanceMiles(item, userLocation));
                    const subParts = [primaryCuisine, locationShort, distLabel].filter(
                      Boolean
                    );

                    const isBookmarked =
                      item.myWantToTry ||
                      (item.placeId ? bookmarkedPlaceIds.has(item.placeId) : false);

                    const topFriend = item.friendBreakdown[0];
                    const recLabel = topFriend
                      ? topFriend.score
                        ? `${topFriend.friendName} (${topFriend.score.toFixed(1)})`
                        : topFriend.friendName
                      : 'Friend';

                    return (
                      <div
                        key={item.key}
                        className="px-3.5 py-3 flex items-center justify-between gap-3 bg-white dark:bg-zinc-900"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate">
                            {item.name}
                          </div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                            {subParts.join(' · ') || item.formattedAddress}
                          </div>

                          {/* Individual Score / Status Chips */}
                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                            {item.myScore !== undefined && (
                              <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                                You {item.myScore.toFixed(1)}
                              </span>
                            )}
                            {item.myWantToTry && item.myScore === undefined && (
                              <span className="px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[11px] font-semibold">
                                You: Want to Try
                              </span>
                            )}
                            {item.friendBreakdown.map((fb) => (
                              <span
                                key={fb.friendUid}
                                className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold"
                              >
                                {fb.friendName}{' '}
                                {fb.status === 'ranked' && fb.score !== undefined
                                  ? fb.score.toFixed(1)
                                  : '· Want to Try'}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.myScore === undefined && (
                            <button
                              type="button"
                              onClick={() =>
                                onSaveFriendSpotToBookmarks(
                                  {
                                    placeId: item.placeId || `bm_${Date.now()}`,
                                    name: item.name,
                                    formattedAddress: item.formattedAddress,
                                    neighborhood: item.neighborhood,
                                    city: item.city,
                                    lat: item.lat,
                                    lng: item.lng,
                                    googleMapsUri: item.googleMapsUri,
                                    priceLevel: item.priceLevel,
                                    categories: item.categories,
                                    cuisines: item.cuisines,
                                    primaryTypeDisplay: item.primaryTypeDisplay,
                                    source: 'google_places',
                                  },
                                  recLabel,
                                  topFriend?.friendUid
                                )
                              }
                              className={`p-2 rounded-full transition-colors ${
                                isBookmarked
                                  ? 'text-rose-500 bg-rose-50 dark:bg-rose-950/40'
                                  : 'text-zinc-400 hover:text-rose-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                              }`}
                              title={
                                isBookmarked
                                  ? 'Remove from Want to Try'
                                  : `Save to Want to Try (Rec by ${recLabel})`
                              }
                              aria-label={
                                isBookmarked
                                  ? 'Remove from Want to Try'
                                  : `Save to Want to Try (Rec by ${recLabel})`
                              }
                            >
                              <Bookmark
                                className={`w-4 h-4 ${isBookmarked ? 'fill-rose-500' : ''}`}
                              />
                            </button>
                          )}

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

                          {item.combinedScore !== undefined && (
                            <ScoreBadge score={item.combinedScore} size="sm" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
};

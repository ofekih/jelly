import React, { useEffect, useState } from 'react';
import {
  Bell,
  Check,
  Copy,
  Eye,
  Loader2,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { ShareIcon } from './PlatformIcons';
import { FriendProfile, RestaurantEntry, SharedListPayload } from '../types';
import { computeUserTasteSimilarity, sanitizeHandle } from '../lib/friendsService';
import { shareIdFromText } from '../lib/shareLinks';
import { FollowCounts } from './FollowCounts';
import { Sheet, SheetHeader } from './Sheet';

interface FriendsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isSignedIn: boolean;
  userUid?: string;
  userHandle: string;
  myRestaurants?: RestaurantEntry[];
  onUpdateHandle: (newHandle: string) => Promise<void>;
  friends: FriendProfile[];
  friendListsMap: Record<string, SharedListPayload>;
  followers?: SharedListPayload[];
  newFollowerIds?: Set<string>;
  onOpenFollowList?: (title: string, users: SharedListPayload[]) => void;
  onSearchDirectory: (query: string) => Promise<SharedListPayload[]>;
  onFollowFriend: (listPayload: SharedListPayload) => Promise<void>;
  onFollowByShareId: (shareId: string) => Promise<boolean>;
  onUnfollowFriend: (friendUid: string) => void;
  onViewFriendList: (friendUid: string) => void;
  onOpenBlendWithFriend: (friendUid: string) => void;
  onPublishMyProfile: () => Promise<string | null>;
}

export const FriendsModal: React.FC<FriendsModalProps> = ({
  isOpen,
  onClose,
  isSignedIn,
  userUid,
  userHandle,
  myRestaurants = [],
  onUpdateHandle,
  friends,
  friendListsMap,
  followers = [],
  newFollowerIds = new Set(),
  onOpenFollowList,
  onSearchDirectory,
  onFollowFriend,
  onFollowByShareId,
  onUnfollowFriend,
  onViewFriendList,
  onOpenBlendWithFriend,
  onPublishMyProfile,
}) => {
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<SharedListPayload[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [handleDraft, setHandleDraft] = useState(userHandle);
  const [isSavingHandle, setIsSavingHandle] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const canNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    setHandleDraft(userHandle);
  }, [userHandle, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const trimmed = searchInput.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    const timer = setTimeout(async () => {
      // A handle, a name, or a pasted share link (the search opens that list directly)
      const results = await onSearchDirectory(trimmed);
      if (!cancelled) {
        setSearchResults(results);
        setIsSearching(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchInput, isOpen, onSearchDirectory]);

  if (!isOpen) return null;

  const followedIds = new Set(friends.map((f) => f.uid));

  const handleCopyMyInvite = async () => {
    const url = await onPublishMyProfile();
    if (!url) return;
    if (canNativeShare) {
      try {
        await navigator.share({
          title: `Follow ${userHandle ? `@${userHandle}` : 'me'} on jelly`,
          text: `Check out my ranked lists on jelly!`,
          url,
        });
        return;
      } catch {
        // User dismissed native share sheet or unsupported; fall back to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handleSaveHandle = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = sanitizeHandle(handleDraft);
    if (!clean) return;
    setIsSavingHandle(true);
    await onUpdateHandle(clean);
    setIsSavingHandle(false);
  };

  const handleQuickAddFromInput = async () => {
    const trimmed = searchInput.trim();
    if (!trimmed) return;
    const listId = shareIdFromText(trimmed);
    if (listId && (await onFollowByShareId(listId))) setSearchInput('');
  };

  return (
    <Sheet onClose={onClose} maxWidthClassName="max-w-md" maxHeightClassName="max-h-[88vh]">
      {(scrollContainerRef) => (
        <>
          <SheetHeader
            icon={<Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
            title="Friends on jelly"
            onClose={onClose}
          />

          <div ref={scrollContainerRef} className="p-5 space-y-5 overflow-y-auto flex-1">
            {/* Your Handle & Shareable Friend Link */}
            {isSignedIn ? (
              <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-800 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                      Your jelly handle
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      Friends can search you by @{userHandle || 'handle'} or use your link
                    </div>
                    {userUid && (
                      <div className="flex items-center gap-2.5 text-xs text-zinc-500 pt-1">
                        <FollowCounts
                          uid={userUid}
                          followersTitle="Your Followers"
                          followingTitle="You Are Following"
                          onOpenFollowList={onOpenFollowList}
                          refreshKey={friends.length}
                          buttonClassName="hover:underline hover:text-emerald-600 dark:hover:text-emerald-400 font-medium"
                          numberClassName="font-bold text-zinc-900 dark:text-zinc-100"
                        />
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyMyInvite}
                    className="px-3 py-1.5 rounded-full bg-zinc-900 hover:bg-zinc-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-zinc-950 text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors"
                  >
                    {copiedLink ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        {canNativeShare ? (
                          <ShareIcon className="w-3.5 h-3.5" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>Invite Link</span>
                      </>
                    )}
                  </button>
                </div>

                <form onSubmit={handleSaveHandle} className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-400">
                      @
                    </span>
                    <input
                      type="text"
                      value={handleDraft}
                      onChange={(e) => setHandleDraft(sanitizeHandle(e.target.value))}
                      placeholder="yourhandle"
                      className="w-full pl-7 pr-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-medium text-zinc-900 dark:text-zinc-100 focus:outline-none"
                    />
                  </div>
                  {sanitizeHandle(handleDraft) !== userHandle && sanitizeHandle(handleDraft).length >= 2 && (
                    <button
                      type="submit"
                      disabled={isSavingHandle}
                      className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 transition-colors"
                    >
                      {isSavingHandle ? 'Saving...' : 'Save'}
                    </button>
                  )}
                </form>
              </div>
            ) : (
              <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-500 dark:text-zinc-400">
                Sign in with Google in the header so friends can find your live list by @handle.
              </div>
            )}

            {/* Search by @handle, Name, or Paste Link */}
            <div className="space-y-2.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 block">
                Add a Friend
              </label>
              <div className="relative flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search @handle, name, or paste link..."
                    className="w-full pl-9 pr-8 py-2.5 bg-zinc-100/80 dark:bg-zinc-800/80 rounded-2xl text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none"
                  />
                  {searchInput && (
                    <button
                      type="button"
                      onClick={() => setSearchInput('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {shareIdFromText(searchInput) && (
                  <button
                    type="button"
                    onClick={handleQuickAddFromInput}
                    className="px-3 py-2.5 rounded-2xl bg-emerald-600 text-white text-xs font-semibold shrink-0"
                  >
                    Add
                  </button>
                )}
              </div>

              {isSearching && (
                <div className="py-4 flex items-center justify-center gap-2 text-xs text-zinc-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Searching jelly users...</span>
                </div>
              )}

              {!isSearching && searchResults.length > 0 && (
                <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800/80 overflow-hidden">
                  {searchResults.map((res) => {
                    const isMe = userUid && (res.ownerUid === userUid || res.id === userUid);
                    const isAlreadyFollowed = followedIds.has(res.id);
                    return (
                      <div
                        key={res.id}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-3 bg-white dark:bg-zinc-900"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 truncate">
                            {res.ownerName || 'Friend'}
                            {res.handle && (
                              <span className="ml-1.5 font-normal text-zinc-400">@{res.handle}</span>
                            )}
                          </div>
                          <div className="text-[11px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5 flex-wrap">
                            <span>{res.rankedCount ?? res.restaurants?.length ?? 0} ranked</span>
                            <span>·</span>
                            <FollowCounts
                              uid={res.ownerUid || res.id}
                              followersTitle={`${res.ownerName || 'Friend'}'s Followers`}
                              followingTitle={`${res.ownerName || 'Friend'} is Following`}
                              onOpenFollowList={onOpenFollowList}
                              buttonClassName="hover:underline hover:text-zinc-700 dark:hover:text-zinc-300"
                            />
                          </div>
                        </div>

                        {isMe ? (
                          <span className="text-[11px] font-medium text-zinc-400">You</span>
                        ) : isAlreadyFollowed ? (
                          <span className="px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] font-semibold text-zinc-500">
                            Following
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={async () => {
                              await onFollowFriend(res);
                              setSearchInput('');
                            }}
                            className="px-3 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 transition-colors"
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            <span>Follow</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {!isSearching && searchInput.trim().length >= 2 && searchResults.length === 0 && (
                <p className="text-center text-xs text-zinc-400 py-2">
                  No public profile found for &ldquo;{searchInput.trim()}&rdquo;. Ask your friend to copy their Invite Link!
                </p>
              )}
            </div>

            {/* Followers / People who added you */}
            {followers.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                    <Bell className="w-3 h-3 text-emerald-500" />
                    <span>Added You ({followers.length})</span>
                  </span>
                </div>

                <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800/80 overflow-hidden">
                  {followers.map((follower) => {
                    const isMutual = followedIds.has(follower.id);
                    const isNew = newFollowerIds.has(follower.id);
                    const displayName = follower.ownerName || 'Friend';

                    return (
                      <div
                        key={follower.id}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-2.5 bg-white dark:bg-zinc-900"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onViewFriendList(follower.id);
                            onClose();
                          }}
                          className="flex items-center gap-2.5 min-w-0 flex-1 text-left group"
                        >
                          <div className="w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold text-xs flex items-center justify-center shrink-0">
                            {displayName.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors flex items-center gap-1.5">
                              <span className="truncate">
                                {displayName}
                                {follower.handle && (
                                  <span className="ml-1 font-normal text-zinc-400">
                                    @{follower.handle}
                                  </span>
                                )}
                              </span>
                              {isNew && (
                                <span className="px-1.5 py-0.2 rounded-full bg-emerald-500 text-zinc-950 text-[9px] font-bold uppercase tracking-wider shrink-0">
                                  New
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                              {follower.rankedCount ?? follower.restaurants?.length ?? 0} ranked
                              {friendListsMap[follower.id]?.bookmarks &&
                                ` · ${friendListsMap[follower.id].bookmarks!.length} saved`}
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isMutual ? (
                            <span className="px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] font-semibold text-zinc-500">
                              Mutual
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onFollowFriend(follower)}
                              className="px-2.5 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold flex items-center gap-1 transition-colors"
                            >
                              <UserPlus className="w-3 h-3" />
                              <span>Follow back</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Following List */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Following ({friends.length})
                </span>
              </div>

              {friends.length === 0 ? (
                <div className="py-8 px-4 text-center rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 space-y-1.5">
                  <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    No friends added yet
                  </p>
                  <p className="text-[11px] text-zinc-400 max-w-xs mx-auto">
                    Search a friend&rsquo;s @handle above, or open any friend&rsquo;s shared link and tap &ldquo;Follow&rdquo;.
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800/80 overflow-hidden">
                  {friends.map((friend) => {
                    const listData = friendListsMap[friend.uid];
                    const rankedCount = listData?.restaurants?.length ?? 0;
                    const sim =
                      myRestaurants.length > 0 && listData?.restaurants?.length
                        ? computeUserTasteSimilarity(myRestaurants, listData.restaurants)
                        : null;
                    const viewList = () => {
                      onViewFriendList(friend.uid);
                      onClose();
                    };

                    return (
                      <div
                        key={friend.uid}
                        className="px-3.5 py-3 flex items-center justify-between gap-2.5 bg-white dark:bg-zinc-900"
                      >
                        {/* The follow counts are buttons of their own, so only the avatar and name open the list */}
                        <div className="flex items-center gap-2.5 min-w-0 flex-1 text-left group">
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-hidden="true"
                            onClick={viewList}
                            className="w-8 h-8 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold text-xs flex items-center justify-center shrink-0"
                          >
                            {friend.name.slice(0, 1).toUpperCase()}
                          </button>
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={viewList}
                              className="w-full text-left font-semibold text-xs text-zinc-900 dark:text-zinc-100 truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors flex items-center gap-1.5"
                            >
                              <span className="truncate">
                                {friend.name}
                                {friend.handle && (
                                  <span className="ml-1 font-normal text-zinc-400">@{friend.handle}</span>
                                )}
                              </span>
                              {sim && sim.tasteMatchPct !== null && (
                                <span
                                  className="px-1.5 py-0.2 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold shrink-0"
                                  title={`Based on ${sim.sharedCount} shared ${
                                    sim.sharedCount === 1 ? 'spot' : 'spots'
                                  }`}
                                >
                                  {sim.tasteMatchPct}% match
                                </span>
                              )}
                            </button>
                            <div className="text-[11px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5 flex-wrap">
                              <span>{rankedCount} ranked</span>
                              <span>·</span>
                              <FollowCounts
                                uid={friend.uid}
                                followersTitle={`${friend.name}'s Followers`}
                                followingTitle={`${friend.name} is Following`}
                                onOpenFollowList={onOpenFollowList}
                                buttonClassName="hover:underline hover:text-zinc-700 dark:hover:text-zinc-300"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              onViewFriendList(friend.uid);
                              onClose();
                            }}
                            className="px-2.5 py-1.5 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-[11px] font-semibold flex items-center gap-1 transition-colors"
                            title={`View ${friend.name}'s list`}
                          >
                            <Eye className="w-3 h-3" />
                            <span>List</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              onOpenBlendWithFriend(friend.uid);
                              onClose();
                            }}
                            className="px-2.5 py-1.5 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold flex items-center gap-1 transition-colors"
                            title={`Blend lists with ${friend.name}`}
                          >
                            <Sparkles className="w-3 h-3" />
                            <span>Blend</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onUnfollowFriend(friend.uid)}
                            className="p-1.5 rounded-full text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                            title={`Unfollow ${friend.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </Sheet>
  );
};

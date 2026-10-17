import React, { useEffect, useState } from 'react';
import {
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
import { FriendProfile, SharedListPayload } from '../types';
import { sanitizeHandle } from '../lib/friendsService';

interface FriendsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isSignedIn: boolean;
  userUid?: string;
  userHandle: string;
  onUpdateHandle: (newHandle: string) => Promise<void>;
  friends: FriendProfile[];
  friendListsMap: Record<string, SharedListPayload>;
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
  onUpdateHandle,
  friends,
  friendListsMap,
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
      // Check if user pasted a full URL with ?list=...
      try {
        if (trimmed.includes('list=')) {
          const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
          const listParam = url.searchParams.get('list');
          if (listParam) {
            const results = await onSearchDirectory(listParam);
            if (!cancelled) {
              setSearchResults(results);
              setIsSearching(false);
            }
            return;
          }
        }
      } catch {
        // Not a URL, proceed with handle/name search
      }

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
    try {
      if (trimmed.includes('list=')) {
        const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
        const listId = url.searchParams.get('list');
        if (listId) {
          const ok = await onFollowByShareId(listId);
          if (ok) setSearchInput('');
          return;
        }
      }
    } catch {
      // Ignore
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-xs p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800 overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">Friends on Jelly</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 -mr-1.5 rounded-full text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* Your Handle & Shareable Friend Link */}
          {isSignedIn ? (
            <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-800 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Your Jelly Handle
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Friends can search you by @{userHandle || 'handle'} or use your link
                  </div>
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
                      <Copy className="w-3.5 h-3.5" />
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
              {searchInput.includes('list=') && (
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
                <span>Searching Jelly users...</span>
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
                        <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                          {res.restaurants?.length || 0} ranked · {res.bookmarks?.length || 0} want to try
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
                  const bookmarkCount = listData?.bookmarks?.length ?? 0;

                  return (
                    <div
                      key={friend.uid}
                      className="px-3.5 py-3 flex items-center justify-between gap-2.5 bg-white dark:bg-zinc-900"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onViewFriendList(friend.uid);
                          onClose();
                        }}
                        className="flex items-center gap-2.5 min-w-0 flex-1 text-left group"
                      >
                        <div className="w-8 h-8 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold text-xs flex items-center justify-center shrink-0">
                          {friend.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                            {friend.name}
                            {friend.handle && (
                              <span className="ml-1 font-normal text-zinc-400">@{friend.handle}</span>
                            )}
                          </div>
                          <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                            {rankedCount} ranked · {bookmarkCount} want to try
                          </div>
                        </div>
                      </button>

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
                          title={`Eat Together blend with ${friend.name}`}
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
      </div>
    </div>
  );
};

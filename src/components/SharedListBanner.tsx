import React from 'react';
import { Check, Sparkles, UserPlus, X } from 'lucide-react';
import { SharedListPayload } from '../types';
import { Avatar } from './Avatar';
import { FollowCounts } from './FollowCounts';

interface SharedListBannerProps {
  list: SharedListPayload;
  /** The list is your own (opened from your share link) */
  isOwn: boolean;
  isFollowed: boolean;
  onToggleFollow: () => void;
  onBlend: () => void;
  onExit: () => void;
  onOpenFollowList: (title: string, users: SharedListPayload[]) => void;
}

/** Whose list you're looking at (someone's share link or a friend's list): a card at the top of the feed. */
export const SharedListBanner: React.FC<SharedListBannerProps> = ({
  list,
  isOwn,
  isFollowed,
  onToggleFollow,
  onBlend,
  onExit,
  onOpenFollowList,
}) => (
  <section
    aria-label={`${list.ownerName}’s list`}
    className="relative rounded-3xl p-3.5 pr-12 bg-emerald-500/10 dark:bg-emerald-500/[0.12] border border-emerald-500/20"
  >
    <button
      type="button"
      onClick={onExit}
      aria-label="Back to my list"
      title="My List"
      className="absolute top-2 right-2 w-10 h-10 rounded-full flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-emerald-500/15 active:scale-95 transition"
    >
      <X className="w-[18px] h-[18px]" />
    </button>

    <div className="flex items-center gap-3 min-w-0">
      <Avatar photoURL={list.photoURL} name={list.ownerName} size={44} />
      <div className="min-w-0">
        <div className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100 truncate">
          {list.ownerName}&rsquo;s lists
        </div>
        <div className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400 flex-wrap">
          {list.handle && <span className="mr-0.5">@{list.handle} ·</span>}
          <span className="tabular-nums">{list.restaurants.length} ranked ·</span>
          <FollowCounts
            uid={list.ownerUid || list.id}
            followersTitle={`${list.ownerName}'s Followers`}
            followingTitle={`${list.ownerName} is Following`}
            onOpenFollowList={onOpenFollowList}
            buttonClassName="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            numberClassName="font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums"
          />
        </div>
      </div>
    </div>

    <div className="mt-3 flex items-center gap-2">
      {!isOwn && (
        <button
          type="button"
          onClick={onToggleFollow}
          className={`h-9 px-3.5 rounded-full text-xs font-bold inline-flex items-center gap-1.5 active:scale-[0.97] transition ${
            isFollowed
              ? 'bg-white/70 dark:bg-zinc-900/70 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700'
              : 'bg-emerald-500 text-white dark:text-zinc-950 shadow-2xs'
          }`}
        >
          {isFollowed ? <Check className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
          <span className="max-w-[10rem] truncate">{isFollowed ? 'Following' : `Follow ${list.ownerName}`}</span>
        </button>
      )}
      <button
        type="button"
        onClick={onBlend}
        title={`Compare & blend lists with ${list.ownerName}`}
        className="h-9 px-3.5 rounded-full bg-white/70 dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-bold inline-flex items-center gap-1.5 active:scale-[0.97] transition"
      >
        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
        <span>Blend</span>
      </button>
    </div>
  </section>
);

import React from 'react';
import { Check, UserPlus, Users } from 'lucide-react';
import { SharedListPayload } from '../types';
import { Sheet, SheetHeader } from './Sheet';

interface FollowListModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  users: SharedListPayload[];
  myUid?: string;
  followedUids: Set<string>;
  onFollowUser: (user: SharedListPayload) => void;
  onUnfollowUser: (userUid: string) => void;
  onSelectUser: (user: SharedListPayload) => void;
}

export const FollowListModal: React.FC<FollowListModalProps> = ({
  isOpen,
  onClose,
  title,
  users,
  myUid,
  followedUids,
  onFollowUser,
  onUnfollowUser,
  onSelectUser,
}) => {
  if (!isOpen) return null;

  return (
    <Sheet onClose={onClose} maxWidthClassName="max-w-md" maxHeightClassName="max-h-[85vh]">
      {(scrollContainerRef) => (
        <>
          <SheetHeader
            icon={<Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
            title={title}
            onClose={onClose}
          />

          {/* User list */}
          <div ref={scrollContainerRef} className="p-4 overflow-y-auto flex-1 divide-y divide-zinc-100 dark:divide-zinc-800/80">
            {users.length === 0 ? (
              <div className="text-center py-10 text-xs text-zinc-400">
                No users to show
              </div>
            ) : (
              users.map((item) => {
                const itemUid = item.ownerUid || item.id;
                const isMe = Boolean(myUid && (item.ownerUid === myUid || item.id === myUid));
                const isFollowing = followedUids.has(itemUid) || followedUids.has(item.id);
                const displayName = item.ownerName || item.displayName || 'jelly user';

                return (
                  <div
                    key={item.id}
                    className="py-3 flex items-center justify-between gap-3 first:pt-0 last:pb-0"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectUser(item);
                        onClose();
                      }}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left group"
                    >
                      {item.photoURL ? (
                        <img
                          src={item.photoURL}
                          alt={displayName}
                          className="w-8 h-8 rounded-full border border-zinc-200 dark:border-zinc-700 object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold text-xs flex items-center justify-center shrink-0">
                          {displayName.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                          {displayName}
                          {item.handle && (
                            <span className="ml-1.5 font-normal text-zinc-400 dark:text-zinc-500">
                              @{item.handle}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                          {item.rankedCount ?? item.restaurants?.length ?? 0} ranked spots
                        </div>
                      </div>
                    </button>

                    {!isMe && (
                      <button
                        type="button"
                        onClick={() => {
                          if (isFollowing) {
                            onUnfollowUser(itemUid);
                          } else {
                            onFollowUser(item);
                          }
                        }}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 transition-colors ${
                          isFollowing
                            ? 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        }`}
                      >
                        {isFollowing ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Following</span>
                          </>
                        ) : (
                          <>
                            <UserPlus className="w-3.5 h-3.5" />
                            <span>Follow</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </Sheet>
  );
};

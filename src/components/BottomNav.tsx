import React, { useEffect } from 'react';
import { ListOrdered, Plus, Users } from 'lucide-react';
import { ShareIcon } from './PlatformIcons';
import { Avatar } from './Avatar';

export type BottomNavTab = 'lists' | 'profile';

interface BottomNavProps {
  active: BottomNavTab;
  onLists: () => void;
  onFriends: () => void;
  onShare: () => void;
  onProfile: () => void;
  /** Opens the add flow; the round button is left out when omitted (e.g. viewing a friend's list) */
  onAdd?: () => void;
  newFollowerCount: number;
  friendCount: number;
  /** Something new behind the profile tab (unseen release notes) */
  profileDot: boolean;
  /** Signed-in account for the profile tab's picture; null shows a generic person */
  account: { photoURL?: string | null; name?: string | null; email?: string | null } | null;
}

/**
 * The app's bottom bar: Lists · Friends · (+) · Share · Profile. Full-width and edge-to-edge on
 * phones (above the home indicator), a centered floating pill from `sm` up. While mounted it sets
 * `data-bottom-bar` on <html>, which turns on `--jelly-bottom-bar` (its height incl. the safe
 * area) for anything else pinned to the bottom (see index.css).
 */
export const BottomNav: React.FC<BottomNavProps> = ({
  active,
  onLists,
  onFriends,
  onShare,
  onProfile,
  onAdd,
  newFollowerCount,
  friendCount,
  profileDot,
  account,
}) => {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.bottomBar = '';
    return () => {
      delete root.dataset.bottomBar;
    };
  }, []);

  const profileLabel = account
    ? profileDot
      ? 'Profile · new features'
      : 'Profile'
    : profileDot
    ? 'Profile · not signed in · new features'
    : 'Profile · not signed in';

  return (
    <nav
      aria-label="Main"
      className="jelly-bottom-nav fixed z-40 inset-x-0 bottom-0 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:bottom-[calc(1rem+env(safe-area-inset-bottom))] sm:w-[25rem] select-none"
    >
      <div className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl backdrop-saturate-150 border-t border-zinc-900/10 dark:border-white/10 pb-[env(safe-area-inset-bottom)] sm:pb-0 sm:rounded-full sm:border sm:shadow-[0_8px_30px_rgba(0,0,0,0.12)] sm:dark:shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
        <div className="h-16 max-w-md mx-auto grid grid-cols-5 items-center px-1 sm:px-2">
          <NavButton label="Lists" active={active === 'lists'} onClick={onLists}>
            <ListOrdered className="w-[22px] h-[22px]" strokeWidth={active === 'lists' ? 2.4 : 2} />
          </NavButton>

          <NavButton
            label="Friends"
            ariaLabel={
              newFollowerCount > 0
                ? `Friends · ${newFollowerCount} new follower${newFollowerCount === 1 ? '' : 's'}`
                : 'Friends'
            }
            onClick={onFriends}
            badge={
              newFollowerCount > 0 ? (
                <span className="absolute -top-1.5 left-1/2 ml-1.5 min-w-[17px] h-[17px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-white dark:ring-zinc-900 tabular-nums">
                  +{newFollowerCount}
                </span>
              ) : friendCount > 0 ? (
                <span className="absolute -top-1.5 left-1/2 ml-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-[9px] font-extrabold flex items-center justify-center ring-2 ring-white dark:ring-zinc-900 tabular-nums">
                  {friendCount}
                </span>
              ) : null
            }
          >
            <Users className="w-[22px] h-[22px]" />
          </NavButton>

          <div className="flex items-center justify-center">
            {onAdd && (
              <button
                type="button"
                onClick={onAdd}
                aria-label="Add"
                title="Add"
                className="jelly-fab w-14 h-14 sm:w-[52px] sm:h-[52px] -translate-y-2.5 sm:translate-y-0 rounded-full bg-emerald-500 text-white dark:text-zinc-950 flex items-center justify-center shadow-[0_6px_16px_-4px_rgba(0,0,0,0.35)] ring-4 ring-zinc-50 dark:ring-zinc-950 sm:ring-0 transition-[transform,background-color] duration-150 hover:bg-emerald-600 dark:hover:bg-emerald-400 active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
              >
                <Plus className="w-7 h-7" strokeWidth={2.6} />
              </button>
            )}
          </div>

          <NavButton label="Share" ariaLabel="Share list" onClick={onShare}>
            <ShareIcon className="w-[22px] h-[22px]" />
          </NavButton>

          <NavButton
            label="Profile"
            ariaLabel={profileLabel}
            title={account?.email ? `Signed in as ${account.email}` : 'Profile'}
            active={active === 'profile'}
            onClick={onProfile}
            badge={
              profileDot ? (
                <span className="absolute -top-0.5 left-1/2 ml-2 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-zinc-900" />
              ) : null
            }
          >
            <Avatar
              photoURL={account?.photoURL}
              name={account ? account.name || account.email : null}
              size={24}
              className={
                active === 'profile'
                  ? 'ring-2 ring-emerald-500 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900'
                  : ''
              }
            />
          </NavButton>
        </div>
      </div>
    </nav>
  );
};

interface NavButtonProps {
  label: string;
  ariaLabel?: string;
  title?: string;
  active?: boolean;
  onClick: () => void;
  badge?: React.ReactNode;
  children: React.ReactNode;
}

const NavButton: React.FC<NavButtonProps> = ({ label, ariaLabel, title, active, onClick, badge, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel ?? label}
    aria-current={active ? 'page' : undefined}
    title={title ?? label}
    className={`group h-full min-w-11 flex flex-col items-center justify-center gap-1 rounded-2xl transition-colors focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-emerald-500 ${
      active
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
    }`}
  >
    <span className="relative flex items-center justify-center h-6 transition-transform duration-150 group-active:scale-90 motion-reduce:transition-none motion-reduce:group-active:scale-100">
      {children}
      {badge}
    </span>
    <span className="text-[10px] leading-none font-semibold tracking-tight">{label}</span>
  </button>
);

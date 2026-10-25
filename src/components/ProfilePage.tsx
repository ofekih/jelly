import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ChevronRight,
  CirclePlay,
  Info,
  LogIn,
  LogOut,
  MessageSquare,
  Moon,
  Pencil,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  ALL_GROUPS,
  BookmarkEntry,
  CATEGORY_GROUP,
  GROUP_EMOJI,
  GROUP_LABEL,
  RestaurantEntry,
  SharedListPayload,
  SpotGroup,
} from '../types';
import { sanitizeHandle } from '../lib/friendsService';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import { Avatar } from './Avatar';
import { ProfilePhotoButton } from './ProfilePhotoButton';
import { FollowCounts } from './FollowCounts';
import { BackIcon, ShareIcon } from './PlatformIcons';

/** How long the slide-out runs before the page unmounts (matches `.animate-jelly-page-out`). */
const EXIT_MS = 220;

interface ProfilePageProps {
  open: boolean;
  onClose: () => void;
  user: User | null;
  authLoading: boolean;
  handle: string;
  onUpdateHandle: (handle: string) => Promise<void>;
  restaurants: RestaurantEntry[];
  bookmarks: BookmarkEntry[];
  friendCount: number;
  newFollowerCount: number;
  hasUnseenChangelog: boolean;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  /** Jump to a group's lists (closes the page) */
  onSelectGroup: (group: SpotGroup) => void;
  onOpenShare: () => void;
  onOpenFriends: () => void;
  onOpenSettings: () => void;
  onOpenWhatsNew: () => void;
  onOpenFollowList: (title: string, users: SharedListPayload[]) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  /** Shows a "Send feedback" row when passed */
  onOpenFeedback?: () => void;
  /** Shows a "Replay intro" row when passed */
  onReplayTour?: () => void;
  /** Your photo as everyone sees it (`displayPhotoURL`) */
  photoURL: string | null;
  /** An uploaded picture is in use (`users/{uid}.customPhotoURL`) */
  hasCustomPhoto: boolean;
  onSavePhoto: (photo: Blob) => Promise<boolean>;
  onRemovePhoto: () => Promise<void>;
  onPhotoError: (message: string) => void;
}

interface GroupStat {
  group: SpotGroup;
  ranked: number;
  want: number;
  top?: RestaurantEntry;
}

/** Stays mounted through the exit animation; `visible` drives the enter/exit class. */
function usePresence(open: boolean, exitMs: number): { mounted: boolean; visible: boolean } {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, exitMs]);
  return { mounted: mounted || open, visible: open };
}

/**
 * Your profile: a full-screen page pushed in from the side (opened from the bottom bar's
 * avatar). Picture, name, @handle, follower counts and per-group stats, then the app's rows:
 * share, friends, settings, appearance, what's new, sign in/out.
 */
export const ProfilePage: React.FC<ProfilePageProps> = (props) => {
  const { mounted, visible } = usePresence(props.open, EXIT_MS);
  if (!mounted) return null;
  return <ProfileScreen {...props} visible={visible} />;
};

const ProfileScreen: React.FC<ProfilePageProps & { visible: boolean }> = ({
  visible,
  onClose,
  user,
  authLoading,
  handle,
  onUpdateHandle,
  restaurants,
  bookmarks,
  friendCount,
  newFollowerCount,
  hasUnseenChangelog,
  darkMode,
  onToggleDarkMode,
  onSelectGroup,
  onOpenShare,
  onOpenFriends,
  onOpenSettings,
  onOpenWhatsNew,
  onOpenFollowList,
  onSignIn,
  onSignOut,
  onOpenFeedback,
  onReplayTour,
  photoURL,
  hasCustomPhoto,
  onSavePhoto,
  onRemovePhoto,
  onPhotoError,
}) => {
  useBodyScrollLock();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  // Move focus into the page so keyboard and screen-reader users land on it
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Sheets opened from here handle their own Escape
      if (e.key === 'Escape' && !document.querySelector('.animate-jelly-backdrop')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stats = useMemo(() => {
    const byGroup = new Map<SpotGroup, GroupStat>(
      ALL_GROUPS.map((group) => [group, { group, ranked: 0, want: 0 }])
    );
    for (const r of restaurants) {
      const stat = byGroup.get(CATEGORY_GROUP[r.category]);
      if (!stat) continue;
      stat.ranked += 1;
      if (
        !stat.top ||
        r.magicScore > stat.top.magicScore ||
        (r.magicScore === stat.top.magicScore && r.rankIndex < stat.top.rankIndex)
      ) {
        stat.top = r;
      }
    }
    for (const b of bookmarks) {
      const stat = byGroup.get(CATEGORY_GROUP[b.category]);
      if (stat) stat.want += 1;
    }
    return [...byGroup.values()];
  }, [restaurants, bookmarks]);

  const usedGroups = stats.filter((s) => s.ranked > 0 || s.want > 0);
  const totalRanked = restaurants.length;
  const totalWant = bookmarks.length;
  const listsUsed = new Set(restaurants.map((r) => r.category)).size;
  const displayName = user?.displayName || user?.email?.split('@')[0] || '';

  return (
    <div
      role="region"
      aria-label="Profile"
      className={`fixed inset-0 z-[35] bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 ${
        visible ? 'animate-jelly-page-in' : 'animate-jelly-page-out pointer-events-none'
      }`}
    >
      <div
        ref={scrollRef}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}
        className="h-full overflow-y-auto overscroll-contain pb-[calc(var(--jelly-bottom-bar,0px)+2rem)]"
      >
        {/* Top bar: back on the left, the title fades in once the big header scrolls away */}
        <div
          className={`sticky top-0 z-10 pt-[env(safe-area-inset-top)] bg-zinc-50/85 dark:bg-zinc-950/85 backdrop-blur-xl border-b transition-colors ${
            scrolled ? 'border-zinc-900/10 dark:border-white/10' : 'border-transparent'
          }`}
        >
          <div className="max-w-xl mx-auto h-12 px-1.5 grid grid-cols-[3rem_1fr_3rem] items-center">
            <button
              ref={backRef}
              type="button"
              onClick={onClose}
              aria-label="Back"
              className="w-11 h-11 rounded-full flex items-center justify-center text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 active:scale-95 transition"
            >
              <BackIcon className="w-6 h-6" />
            </button>
            <h1
              className={`text-center text-[15px] font-bold truncate transition-opacity duration-200 ${
                scrolled ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {user ? displayName : 'Profile'}
            </h1>
            <span />
          </div>
        </div>

        <div className="max-w-xl mx-auto px-4 space-y-6">
          {/* Identity */}
          <section className="pt-2 flex flex-col items-center text-center">
            {user ? (
              <ProfilePhotoButton
                photoURL={photoURL}
                name={displayName || user.email}
                size={88}
                className="shadow-sm ring-4 ring-white dark:ring-zinc-900"
                hasCustomPhoto={hasCustomPhoto}
                onSave={onSavePhoto}
                onRemove={onRemovePhoto}
                onError={onPhotoError}
              />
            ) : (
              <Avatar photoURL={null} name={null} size={88} className="shadow-sm ring-4 ring-white dark:ring-zinc-900" />
            )}
            {user ? (
              <>
                <h2 className="mt-3 text-xl font-extrabold tracking-tight">{displayName}</h2>
                <HandleEditor handle={handle} onSave={onUpdateHandle} />
                <div className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <FollowCounts
                    uid={user.uid}
                    followersTitle="Your Followers"
                    followingTitle="You're Following"
                    onOpenFollowList={onOpenFollowList}
                    refreshKey={friendCount}
                    buttonClassName="px-1 py-1.5 rounded-md hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                    numberClassName="font-bold text-zinc-900 dark:text-zinc-100 tabular-nums"
                  />
                </div>
              </>
            ) : (
              <>
                <h2 className="mt-3 text-xl font-extrabold tracking-tight">
                  {authLoading ? 'Profile' : 'You’re not signed in'}
                </h2>
                <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                  Sign in to back up your lists, use them on all your devices and share them with friends.
                  Everything you’ve ranked here comes with you.
                </p>
                {!authLoading && (
                  <button
                    type="button"
                    onClick={onSignIn}
                    className="mt-4 h-11 px-5 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-bold flex items-center gap-2 shadow-sm active:scale-[0.97] transition"
                  >
                    <LogIn className="w-4 h-4" />
                    Sign in with Google
                  </button>
                )}
              </>
            )}
          </section>

          {/* Totals */}
          <section className="grid grid-cols-3 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 divide-x divide-zinc-200/70 dark:divide-zinc-800">
            <Stat value={totalRanked} label="Ranked" />
            <Stat value={totalWant} label="Want to try" />
            <Stat value={listsUsed} label={listsUsed === 1 ? 'List' : 'Lists'} />
          </section>

          {/* Per group */}
          {usedGroups.length > 0 && (
            <section>
              <SectionTitle>Your lists</SectionTitle>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {usedGroups.map((s) => (
                  <button
                    key={s.group}
                    type="button"
                    onClick={() => onSelectGroup(s.group)}
                    className="min-h-[6.5rem] p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 text-left flex flex-col gap-1 hover:border-zinc-300 dark:hover:border-zinc-700 active:scale-[0.98] transition"
                  >
                    <div className="flex items-center justify-between">
                      <span aria-hidden="true" className="text-xl leading-none">
                        {GROUP_EMOJI[s.group]}
                      </span>
                      <ChevronRight className="w-4 h-4 text-zinc-300 dark:text-zinc-600" />
                    </div>
                    <div className="mt-1 text-sm font-bold">{GROUP_LABEL[s.group]}</div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                      {s.ranked} ranked{s.want > 0 ? ` · ${s.want} saved` : ''}
                    </div>
                    {s.top && (
                      <div className="mt-auto pt-1 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 truncate">
                        <span className="text-jade-600 dark:text-jade-400 font-bold tabular-nums">
                          {s.top.magicScore.toFixed(1)}
                        </span>{' '}
                        {s.top.name}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Rows */}
          <section className="space-y-2.5">
            <RowGroup>
              <Row icon={<ShareIcon className="w-4 h-4" />} tint="bg-sky-500" label="Share my list" onClick={onOpenShare} />
              <Row
                icon={<Users className="w-4 h-4" />}
                tint="bg-violet-500"
                label="Friends"
                onClick={onOpenFriends}
                accessory={
                  newFollowerCount > 0 ? (
                    <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center tabular-nums">
                      +{newFollowerCount}
                    </span>
                  ) : friendCount > 0 ? (
                    <span className="text-sm text-zinc-400 tabular-nums">{friendCount}</span>
                  ) : undefined
                }
              />
            </RowGroup>

            <RowGroup>
              <Row icon={<Settings className="w-4 h-4" />} tint="bg-zinc-500" label="Settings" onClick={onOpenSettings} />
              <Row
                icon={<Moon className="w-4 h-4" />}
                tint="bg-indigo-500"
                label="Dark mode"
                onClick={onToggleDarkMode}
                role="switch"
                checked={darkMode}
                accessory={<Switch on={darkMode} />}
              />
              <Row
                icon={<Sparkles className="w-4 h-4" />}
                tint="bg-amber-500"
                label="What’s new"
                onClick={onOpenWhatsNew}
                accessory={
                  hasUnseenChangelog ? (
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" aria-label="New" />
                  ) : undefined
                }
              />
            </RowGroup>

            <RowGroup>
              {onOpenFeedback && (
                <Row
                  icon={<MessageSquare className="w-4 h-4" />}
                  tint="bg-teal-500"
                  label="Send feedback"
                  onClick={onOpenFeedback}
                />
              )}
              {onReplayTour && (
                <Row
                  icon={<CirclePlay className="w-4 h-4" />}
                  tint="bg-pink-500"
                  label="Replay intro"
                  onClick={onReplayTour}
                />
              )}
              <Row icon={<Info className="w-4 h-4" />} tint="bg-zinc-400" label="About jelly" href="/about" />
            </RowGroup>

            {user && (
              <RowGroup>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="w-full min-h-[3.25rem] px-4 flex items-center justify-center gap-2 text-sm font-semibold text-rose-600 dark:text-rose-400 active:bg-zinc-100 dark:active:bg-zinc-800 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </RowGroup>
            )}
            {user?.email && (
              <p className="text-center text-[11px] text-zinc-400 dark:text-zinc-500">Signed in as {user.email}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

const HandleEditor: React.FC<{ handle: string; onSave: (handle: string) => Promise<void> }> = ({ handle, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(handle);
  const [saving, setSaving] = useState(false);
  const clean = sanitizeHandle(draft);
  const canSave = clean.length >= 2 && clean !== handle && !saving;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(handle);
          setEditing(true);
        }}
        className="mt-0.5 min-h-8 px-2 rounded-full inline-flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        aria-label={handle ? `Edit handle @${handle}` : 'Choose a handle'}
      >
        <span>{handle ? `@${handle}` : 'Choose your @handle'}</span>
        <Pencil className="w-3 h-3" />
      </button>
    );
  }

  return (
    <form
      className="mt-2 flex items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!canSave) return;
        setSaving(true);
        await onSave(clean);
        setSaving(false);
        setEditing(false);
      }}
    >
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">@</span>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(sanitizeHandle(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setEditing(false);
            }
          }}
          aria-label="Handle"
          placeholder="yourhandle"
          enterKeyHint="done"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-44 h-10 pl-7 pr-3 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-base sm:text-sm focus:outline-none focus:border-emerald-500"
        />
      </div>
      <button
        type="submit"
        disabled={!canSave}
        className="h-10 px-4 rounded-full bg-emerald-500 text-white dark:text-zinc-950 text-sm font-bold disabled:opacity-40 transition-opacity"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="h-10 px-3 rounded-full text-sm font-semibold text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800"
      >
        Cancel
      </button>
    </form>
  );
};

const Stat: React.FC<{ value: number; label: string }> = ({ value, label }) => (
  <div className="py-3.5 flex flex-col items-center gap-0.5">
    <span className="text-lg font-extrabold tabular-nums">{value}</span>
    <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
  </div>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="px-1 pb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
    {children}
  </h3>
);

const RowGroup: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800/80">
    {children}
  </div>
);

interface RowProps {
  icon: React.ReactNode;
  /** Background of the icon tile */
  tint: string;
  label: string;
  onClick?: () => void;
  href?: string;
  accessory?: React.ReactNode;
  role?: 'switch';
  checked?: boolean;
}

const Row: React.FC<RowProps> = ({ icon, tint, label, onClick, href, accessory, role, checked }) => {
  const content = (
    <>
      <span className={`w-8 h-8 rounded-[10px] ${tint} text-white flex items-center justify-center shrink-0`}>
        {icon}
      </span>
      <span className="flex-1 text-left text-[15px] font-medium">{label}</span>
      {accessory}
      {role !== 'switch' && <ChevronRight className="w-4 h-4 text-zinc-300 dark:text-zinc-600 shrink-0" />}
    </>
  );
  const className =
    'w-full min-h-[3.25rem] px-3.5 flex items-center gap-3 active:bg-zinc-100 dark:active:bg-zinc-800 transition-colors';
  if (href) {
    return (
      <a href={href} className={className}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} role={role} aria-checked={role ? checked : undefined} className={className}>
      {content}
    </button>
  );
};

const Switch: React.FC<{ on: boolean }> = ({ on }) => (
  <span
    aria-hidden="true"
    className={`relative inline-flex h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 ${
      on ? 'bg-emerald-500' : 'bg-zinc-200 dark:bg-zinc-700'
    }`}
  >
    <span
      className={`absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.2)] transition-transform duration-200 motion-reduce:transition-none ${
        on ? 'translate-x-5' : 'translate-x-0'
      }`}
    />
  </span>
);

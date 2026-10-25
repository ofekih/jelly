import React from 'react';
import { Search } from 'lucide-react';
import { ALL_GROUPS, GROUP_EMOJI, GROUP_LABEL, SpotGroup } from '../types';
import { useScrollChrome } from '../lib/useScrollChrome';
import { JellyBeanIcon } from './JellyBeanIcon';

interface AppHeaderProps {
  selectedGroup: SpotGroup;
  onSelectGroup: (group: SpotGroup) => void;
  /** Tapping the wordmark: back to the top (and to your own list) */
  onWordmark: () => void;
  /** Offer the list filter (only once there's something to filter) */
  showSearch: boolean;
  searchActive: boolean;
  onToggleSearch: () => void;
  /** Covered by a full-screen page: out of the tab order and the accessibility tree */
  inert?: boolean;
}

/**
 * The slim top bar: wordmark and group switcher (plus the list filter). Sticky, and slides away
 * while you scroll down, back on any scroll up, the way iOS and Android apps tuck their toolbars.
 * It stays in the page flow (only transformed), so hiding never shifts the content. The status-bar
 * strip (safe area) stays put so content never scrolls under the clock.
 */
export const AppHeader: React.FC<AppHeaderProps> = ({
  selectedGroup,
  onSelectGroup,
  onWordmark,
  showSearch,
  searchActive,
  onToggleSearch,
  inert,
}) => {
  const { hidden, scrolled } = useScrollChrome();

  return (
    <header
      inert={inert || undefined}
      className="sticky top-0 z-30 select-none transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
      style={hidden ? { transform: 'translate3d(0, calc(-100% + env(safe-area-inset-top)), 0)' } : undefined}
    >
      <div
        className={`pt-[env(safe-area-inset-top)] bg-zinc-50/85 dark:bg-zinc-950/85 backdrop-blur-xl backdrop-saturate-150 border-b transition-colors duration-200 ${
          scrolled && !hidden ? 'border-zinc-900/10 dark:border-white/10' : 'border-transparent'
        }`}
      >
        <div className="max-w-xl mx-auto px-4 pt-1 pb-2.5 sm:py-0 sm:h-14 flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1.5">
          <button
            type="button"
            onClick={onWordmark}
            className="h-11 -ml-1 pl-1 pr-2 rounded-full flex items-center gap-2 shrink-0"
            aria-label="jelly, scroll to top"
          >
            <JellyBeanIcon size={24} />
            <span className="font-display font-extrabold text-xl tracking-tight text-zinc-900 dark:text-zinc-100">
              jelly
            </span>
          </button>

          {/* Group switcher: its own full-width row on phones, inline from sm up; only the active group is named */}
          <div
            role="tablist"
            aria-label="Group"
            className="order-last w-full flex sm:order-none sm:w-auto sm:mr-auto sm:inline-flex p-[3px] rounded-full bg-zinc-200/70 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/80"
          >
            {ALL_GROUPS.map((group) => {
              const active = group === selectedGroup;
              return (
                <button
                  key={group}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={GROUP_LABEL[group]}
                  title={GROUP_LABEL[group]}
                  onClick={() => onSelectGroup(group)}
                  className={`h-8 rounded-full text-xs font-bold flex items-center justify-center gap-1 transition-all duration-200 motion-reduce:transition-none sm:flex-none ${
                    active
                      ? 'flex-[2] px-3 bg-emerald-500 text-white dark:text-zinc-950 shadow-2xs'
                      : 'flex-1 px-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
                  }`}
                >
                  <span aria-hidden="true" className="text-sm leading-none">
                    {GROUP_EMOJI[group]}
                  </span>
                  <span className={active ? '' : 'hidden'}>{GROUP_LABEL[group]}</span>
                </button>
              );
            })}
          </div>

          {showSearch && (
            <button
              type="button"
              onClick={onToggleSearch}
              className={`ml-auto sm:ml-0 w-11 h-11 -mr-2 rounded-full flex items-center justify-center transition-colors ${
                searchActive
                  ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-900'
              }`}
              aria-label="Filter list"
              aria-pressed={searchActive}
              title="Filter list"
            >
              <Search className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

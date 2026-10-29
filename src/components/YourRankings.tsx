import React, { useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { CATEGORY_EMOJI, CATEGORY_LABEL, RestaurantEntry, SpotCategory } from '../types';
import { addsRankingNote } from '../lib/addFlow';
import { ScoreBadge } from './ScoreBadge';

interface YourRankingsProps {
  /** Your entries for the spot, one per list; never empty */
  rankings: RestaurantEntry[];
  /** Lists that don't hold the spot yet: ranking it there adds a second ranking */
  addable: SpotCategory[];
  /** The ranking the screen is showing (highlighted). With `onSelect`, tapping another row switches to it */
  currentId?: string;
  onSelect?: (entry: RestaurantEntry) => void;
  onReRank: (entry: RestaurantEntry) => void;
  onAdd: (category: SpotCategory) => void;
}

/**
 * Everything you've ranked a spot as, one row per list, shared by the spot sheet and the place
 * page so both say the same thing. Re-rank replaces that one ranking; "Also rank it in another
 * list" adds a separate one and leaves the others as they are.
 */
export const YourRankings: React.FC<YourRankingsProps> = ({
  rankings,
  addable,
  currentId,
  onSelect,
  onReRank,
  onAdd,
}) => {
  const [adding, setAdding] = useState(false);

  return (
    <section className="space-y-2" aria-label={rankings.length > 1 ? 'Your rankings' : 'Your ranking'}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
        {rankings.length > 1 ? 'Your rankings' : 'Your ranking'}
      </h3>

      <ul className="space-y-1.5">
        {rankings.map((entry) => {
          const current = entry.id === currentId;
          const label = CATEGORY_LABEL[entry.category];
          return (
            <li
              key={entry.id}
              className={`flex items-center gap-2 rounded-2xl border p-1.5 pl-3 ${
                current && rankings.length > 1
                  ? 'border-emerald-500/50 bg-emerald-50/60 dark:bg-emerald-950/20'
                  : 'border-zinc-200/80 dark:border-zinc-800'
              }`}
            >
              <button
                type="button"
                disabled={!onSelect || current}
                onClick={() => onSelect?.(entry)}
                className="min-w-0 flex-1 flex items-center gap-2 py-1.5 text-left disabled:cursor-default"
              >
                <span className="text-base shrink-0">{CATEGORY_EMOJI[entry.category]}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">{label}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">#{entry.rankIndex + 1}</span>
                </span>
              </button>
              <ScoreBadge score={entry.magicScore} size="sm" />
              <button
                type="button"
                onClick={() => onReRank(entry)}
                aria-label={`Re-rank in ${label}`}
                className="shrink-0 py-2.5 px-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Re-rank
              </button>
            </li>
          );
        })}
      </ul>

      {addable.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={adding}
            onClick={() => setAdding((v) => !v)}
            className="w-full py-2.5 px-4 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-emerald-500 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Also rank it in another list</span>
          </button>
          {adding && (
            <div className="pt-2 space-y-2">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{addsRankingNote(rankings)}</p>
              <div className="flex flex-wrap gap-1.5">
                {addable.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onAdd(c)}
                    className="px-3 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 hover:border-emerald-500 text-xs font-medium text-zinc-700 dark:text-zinc-200 transition-colors"
                  >
                    {CATEGORY_EMOJI[c]} {CATEGORY_LABEL[c]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

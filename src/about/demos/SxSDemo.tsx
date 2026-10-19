import React, { useMemo, useState } from 'react';
import { Check, Equal, RotateCcw, Undo2, X } from 'lucide-react';
import {
  getBestInsertionIndex,
  initSxSSearch,
  pickNextOpponent,
  recordSxSComparison,
  undoLastSxSStep,
} from '../../lib/rankingEngine';
import { getRatingTier } from '../../lib/ratingTiers';
import { buildList } from '../sample';
import { Button, Demo } from '../ui';

const NEW_SPOT = { name: 'Kiku Ramen', cuisine: 'Japanese' };

const LIST = buildList(
  [
    { name: 'Hanami Omakase', gut: 9.4, cuisines: ['Japanese'] },
    { name: 'Osteria Lucia', gut: 9.0, cuisines: ['Italian'] },
    { name: 'Smoke & Ember', gut: 8.6, cuisines: ['BBQ'] },
    { name: 'Tsuru Udon', gut: 8.2, cuisines: ['Japanese'] },
    { name: 'Casa Verde', gut: 7.9, cuisines: ['Mexican'] },
    { name: 'Pho Saigon', gut: 7.6, cuisines: ['Vietnamese'] },
    { name: 'Bao House', gut: 7.2, cuisines: ['Chinese'] },
    { name: 'Little Bombay', gut: 6.9, cuisines: ['Indian'] },
    { name: 'Sakura Sushi', gut: 6.5, cuisines: ['Japanese'] },
    { name: 'Burger Barn', gut: 6.0, cuisines: ['American'] },
    { name: 'Noodle Express', gut: 5.2, cuisines: ['Chinese'] },
    { name: 'Corner Diner', gut: 4.3, cuisines: ['American'] },
  ],
  'sxs'
);

type Outcome = 'new_wins' | 'opponent_wins' | 'tie' | 'skip';

export const SxSDemo: React.FC = () => {
  const [gut, setGut] = useState(7.8);
  const [state, setState] = useState(() => initSxSSearch(LIST, 7.8, [NEW_SPOT.cuisine]));
  const match = useMemo(() => pickNextOpponent(state, LIST), [state]);
  const { insertIndex, confidence } = getBestInsertionIndex(state);
  const done = !match;
  const maxW = Math.max(...state.slotWeights);

  const reset = (g = gut) => {
    setGut(g);
    setState(initSxSSearch(LIST, g, [NEW_SPOT.cuisine]));
  };
  const answer = (o: Outcome) => match && setState(recordSxSComparison(state, match.opponentIndex, match.opponent, o));
  const outcomeOf = (i: number) => [...state.history].reverse().find((h) => h.opponentIndex === i)?.outcome;

  const slotRow = (k: number) => {
    const w = state.slotWeights[k];
    const live = w >= 0.005;
    const chosen = done && k === insertIndex;
    return (
      <div key={`slot${k}`} className="flex h-4 items-center gap-2 pl-7">
        <div className="relative h-2 flex-1">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
              chosen ? 'bg-jade-500' : live ? 'bg-jade-400/70 dark:bg-jade-500/60' : 'bg-zinc-200 dark:bg-zinc-800'
            }`}
            style={{ width: `${Math.max(1.5, (w / maxW) * 100)}%` }}
          />
        </div>
        <span className={`w-9 text-right text-[10px] tabular-nums ${live ? 'text-zinc-500' : 'text-zinc-300 dark:text-zinc-700'}`}>
          {Math.round(w * 100)}%
        </span>
      </div>
    );
  };

  return (
    <Demo title={`Placing ${NEW_SPOT.name} into a 12-spot list`} hint="You answer, the search adapts">
      <label className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <span>
          Gut feeling: <b style={{ color: getRatingTier(gut).thumbColor }}>{gut.toFixed(1)}</b>
        </span>
        <input
          type="range"
          min={1}
          max={10}
          step={0.1}
          value={gut}
          onChange={(e) => reset(Number(e.target.value))}
          className="min-w-40 flex-1 accent-jade-600"
        />
      </label>

      <div className="mt-4 rounded-2xl bg-zinc-50 p-3 dark:bg-zinc-950/60">
        {done ? (
          <div className="text-center">
            <div className="text-xs text-zinc-400">
              Done after {state.completedComparisons} {state.completedComparisons === 1 ? 'question' : 'questions'}
            </div>
            <div className="mt-0.5 font-display text-lg font-bold text-zinc-900 dark:text-zinc-100">
              {NEW_SPOT.name} goes in at #{insertIndex + 1}
            </div>
          </div>
        ) : (
          <>
            <div className="text-center text-xs text-zinc-400">
              Question {state.completedComparisons + 1} · Which did you like more?
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button tone="primary" onClick={() => answer('new_wins')} className="py-2.5">
                {NEW_SPOT.name}
              </Button>
              <Button tone="primary" onClick={() => answer('opponent_wins')} className="py-2.5">
                {match.opponent.name}
              </Button>
            </div>
            <div className="mt-2 flex justify-center gap-2">
              <Button onClick={() => answer('tie')} className="py-1.5 text-xs">
                About the same
              </Button>
              <Button onClick={() => answer('skip')} className="py-1.5 text-xs">
                Can't compare
              </Button>
            </div>
          </>
        )}
        <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-400">
          <span>
            Best guess #{insertIndex + 1} · {confidence}% sure · Elo {state.candidateElo}
          </span>
          <span className="flex gap-1">
            <button
              type="button"
              aria-label="Undo"
              disabled={!state.history.length}
              onClick={() => setState(undoLastSxSStep(state))}
              className="rounded-full p-1.5 hover:bg-zinc-200 disabled:opacity-30 dark:hover:bg-zinc-800"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Start over"
              onClick={() => reset()}
              className="rounded-full p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      </div>

      <div className="mt-4 text-[11px] text-zinc-400">Bars: how likely each gap is to be the right spot</div>
      <div className="mt-1">
        {LIST.map((spot, i) => {
          const isOpp = match?.opponentIndex === i;
          const out = outcomeOf(i);
          const japanese = spot.cuisines.includes(NEW_SPOT.cuisine);
          return (
            <React.Fragment key={spot.id}>
              {slotRow(i)}
              <div
                className={`flex h-7 items-center gap-2 rounded-lg px-1.5 text-[13px] transition ${
                  isOpp ? 'bg-jade-50 ring-1 ring-jade-300 dark:bg-jade-950/60 dark:ring-jade-700' : ''
                } ${out === 'skip' ? 'opacity-40' : ''}`}
              >
                <span className="w-5 text-right text-[11px] tabular-nums text-zinc-400">{i + 1}</span>
                <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">{spot.name}</span>
                {japanese && (
                  <span className="rounded-full bg-rose-50 px-1.5 text-[10px] font-semibold text-rose-600 dark:bg-rose-950/60 dark:text-rose-300">
                    Japanese
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1.5">
                  {out === 'new_wins' && <Check className="h-3.5 w-3.5 text-jade-600" aria-label="Kiku won" />}
                  {out === 'opponent_wins' && <X className="h-3.5 w-3.5 text-rose-500" aria-label="Kiku lost" />}
                  {out === 'tie' && <Equal className="h-3.5 w-3.5 text-amber-500" aria-label="Tie" />}
                  <span className="w-7 text-right text-[12px] font-semibold tabular-nums" style={{ color: getRatingTier(spot.magicScore).thumbColor }}>
                    {spot.magicScore.toFixed(1)}
                  </span>
                </span>
              </div>
            </React.Fragment>
          );
        })}
        {slotRow(LIST.length)}
      </div>
    </Demo>
  );
};

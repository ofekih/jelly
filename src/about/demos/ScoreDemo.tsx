import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Minus, Plus, RotateCcw } from 'lucide-react';
import { getRatingTier } from '../../lib/ratingTiers';
import { buildList, type SampleSpot } from '../sample';
import { Demo } from '../ui';

const START: SampleSpot[] = [
  { name: 'Osteria Lucia', gut: 9.0 },
  { name: 'Smoke & Ember', gut: 8.5 },
  { name: 'Casa Verde', gut: 7.5 },
  { name: 'Pho Saigon', gut: 8.0 },
  { name: 'Bao House', gut: 6.5 },
  { name: 'Burger Barn', gut: 6.0 },
];

const iconBtn =
  'grid h-6 w-6 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100 disabled:opacity-25 dark:hover:bg-zinc-800';

export const ScoreDemo: React.FC = () => {
  const [spots, setSpots] = useState(START);
  const scored = useMemo(() => buildList(spots, 'score'), [spots]);

  /** Same as dragging in the app: only the order changes, and scores are refit to it */
  const move = (from: number, to: number) => {
    const next = [...spots];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setSpots(next);
  };
  const nudge = (i: number, d: number) =>
    setSpots(spots.map((s, k) => (k === i ? { ...s, gut: Math.min(10, Math.max(1, s.gut + d)) } : s)));

  return (
    <Demo title="Order in, scores out" hint="Reorder or change a gut rating">
      <div className="grid grid-cols-[1.25rem_1fr_auto_auto_2.6rem] items-center gap-x-2 gap-y-1 text-[13px]">
        <span />
        <span className="text-[11px] text-zinc-400">Your order</span>
        <span className="text-center text-[11px] text-zinc-400">Gut</span>
        <span />
        <span className="text-right text-[11px] text-zinc-400">Score</span>
        {scored.map((s, i) => {
          const tier = getRatingTier(s.magicScore);
          return (
            <React.Fragment key={s.name}>
              <span className="text-right text-[11px] tabular-nums text-zinc-400">{i + 1}</span>
              <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">{s.name}</span>
              <span className="flex items-center gap-0.5">
                <button type="button" aria-label="Lower gut rating" className={iconBtn} onClick={() => nudge(i, -0.5)}>
                  <Minus className="h-3 w-3" />
                </button>
                <span className="w-7 text-center tabular-nums" style={{ color: getRatingTier(s.initialRating).thumbColor }}>
                  {s.initialRating.toFixed(1)}
                </span>
                <button type="button" aria-label="Raise gut rating" className={iconBtn} onClick={() => nudge(i, 0.5)}>
                  <Plus className="h-3 w-3" />
                </button>
              </span>
              <span className="flex">
                <button type="button" aria-label="Move up" className={iconBtn} disabled={i === 0} onClick={() => move(i, i - 1)}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  className={iconBtn}
                  disabled={i === scored.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </span>
              <span
                className="justify-self-end rounded-lg px-1.5 py-0.5 text-right font-display text-[15px] font-extrabold tabular-nums"
                style={{ color: tier.thumbColor, background: `${tier.thumbColor}1a` }}
              >
                {s.magicScore.toFixed(1)}
              </span>
            </React.Fragment>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-[12.5px] text-zinc-500">
        <span>
          To start, Pho Saigon felt like an 8.0 but sits below Casa Verde (7.5), so they meet in the middle. Try moving
          Burger Barn up: the further it climbs past its 6.0, the less that 6.0 counts.
        </span>
        <button type="button" aria-label="Reset" className={iconBtn} onClick={() => setSpots(START)}>
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
    </Demo>
  );
};

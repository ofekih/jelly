import React, { useMemo, useState } from 'react';
import { getRatingTier } from '../../lib/ratingTiers';
import { buildList } from '../sample';
import { Demo } from '../ui';

// Both diners would call all six spots "good"; their gut ratings say how good
const ALEX = [9.6, 9.4, 9.3, 9.0, 8.9, 8.8];
const SAM = [7.4, 7.2, 7.0, 6.8, 6.5, 6.2];

/** The fixed-bucket approach: whatever lands in "good" is spread evenly over 6.7–10 by rank */
const bucketScores = (n: number) =>
  Array.from({ length: n }, (_, k) => 10 - (k * (10 - 6.7)) / (n - 1));

const LO = 5;
const HI = 10;
const toPct = (s: number) => ((s - LO) / (HI - LO)) * 100;

const Strip: React.FC<{ label: string; scores: number[]; color: string }> = ({ label, scores, color }) => (
  <div className="grid grid-cols-[3.2rem_1fr] items-center gap-2">
    <span className="text-[12px] font-semibold" style={{ color }}>
      {label}
    </span>
    <div className="relative h-7">
      <div className="absolute inset-x-0 top-1/2 h-px bg-zinc-200 dark:bg-zinc-700" />
      {scores.map((s, i) => (
        <div
          key={i}
          title={s.toFixed(1)}
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-zinc-900 transition-[left] duration-500"
          style={{ left: `${toPct(s)}%`, background: color, opacity: 1 - i * 0.09 }}
        />
      ))}
    </div>
  </div>
);

export const BucketsDemo: React.FC = () => {
  const [mode, setMode] = useState<'buckets' | 'jelly'>('buckets');
  const jelly = useMemo(
    () => ({
      alex: buildList(ALEX.map((gut, i) => ({ name: `a${i}`, gut }))).map((e) => e.magicScore),
      sam: buildList(SAM.map((gut, i) => ({ name: `s${i}`, gut }))).map((e) => e.magicScore),
    }),
    []
  );
  const alex = mode === 'buckets' ? bucketScores(ALEX.length) : jelly.alex;
  const sam = mode === 'buckets' ? bucketScores(SAM.length) : jelly.sam;
  const range = (s: number[]) => `${Math.min(...s).toFixed(1)}–${Math.max(...s).toFixed(1)}`;

  return (
    <Demo title="Two diners, six “good” spots each">
      <div className="mb-4 inline-grid grid-cols-2 rounded-full bg-zinc-100 p-0.5 text-sm font-semibold dark:bg-zinc-800">
        {(['buckets', 'jelly'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-full px-4 py-1.5 transition ${
              mode === m
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50'
                : 'text-zinc-500'
            }`}
          >
            {m === 'buckets' ? 'Fixed buckets' : 'jelly'}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        <Strip label="Alex" scores={alex} color="#7c3aed" />
        <Strip label="Sam" scores={sam} color="#ea580c" />
        <div className="grid grid-cols-[3.2rem_1fr] gap-2">
          <span />
          <div className="relative h-4 text-[10px] text-zinc-400 tabular-nums">
            {[5, 6, 7, 8, 9, 10].map((t) => (
              <span key={t} className="absolute -translate-x-1/2" style={{ left: `${toPct(t)}%` }}>
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-4 text-[13.5px]">
        Alex eats at tasting-menu places; Sam loves neighbourhood spots. Both would put all six in “good”.{' '}
        {mode === 'buckets' ? (
          <>
            Fixed buckets stretch each list over the same <b>6.7–10</b> range, so Sam's favourite taco stand and
            Alex's three-star dinner both come out as a perfect 10.
          </>
        ) : (
          <>
            jelly keeps the order from the comparisons and takes the level from each person's gut ratings: Alex lands
            at <b style={{ color: getRatingTier(9).thumbColor }}>{range(alex)}</b> and Sam at{' '}
            <b style={{ color: getRatingTier(7).thumbColor }}>{range(sam)}</b>, which is what they actually felt.
          </>
        )}
      </p>
    </Demo>
  );
};

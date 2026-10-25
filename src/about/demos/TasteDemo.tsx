import React, { useMemo, useState } from 'react';
import { computeUserTasteSimilarity, getSpotSocialMetrics } from '../../lib/friendsService';
import { getRatingTier } from '../../lib/ratingTiers';
import type { SharedListPayload } from '../../types';
import { scoredEntries } from '../sample';
import { TASTE_MINE, TASTE_PRESETS, TASTE_SPOTS, TasteScatter } from './TasteScatter';
import { Demo, Tex } from '../ui';

const SPOTS = TASTE_SPOTS;
const MINE = TASTE_MINE;
const PRESETS = TASTE_PRESETS;
const NEW_SPOT = 'Tsuru Udon';

const Meter: React.FC<{ label: React.ReactNode; value: number; min?: number; display?: string }> = ({
  label,
  value,
  min = -1,
  display,
}) => {
  const t = (value - min) / (1 - min);
  return (
    <div className="grid grid-cols-[5.5rem_1fr_2.6rem] items-center gap-2 text-[12.5px]">
      <span className="text-zinc-500">{label}</span>
      <div className="relative h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
        {min < 0 && <div className="absolute inset-y-[-3px] left-1/2 w-px bg-zinc-300 dark:bg-zinc-600" />}
        <div
          className={`absolute inset-y-0 rounded-full transition-all duration-300 ${value >= 0 ? 'bg-jade-500' : 'bg-rose-400'}`}
          style={
            min < 0
              ? { left: `${Math.min(50, t * 100)}%`, width: `${Math.abs(t - 0.5) * 100}%` }
              : { left: 0, width: `${t * 100}%` }
          }
        />
      </div>
      <span className="text-right font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
        {display ?? value.toFixed(2)}
      </span>
    </div>
  );
};

export const TasteDemo: React.FC = () => {
  const [friend, setFriend] = useState(PRESETS[0].friend);
  const [shared, setShared] = useState(SPOTS.length);
  const [friendNew, setFriendNew] = useState(7.4);

  const result = useMemo(() => {
    const mine = scoredEntries(SPOTS.map((name, i) => ({ name, score: MINE[i] })), 'me');
    const theirsShared = SPOTS.slice(0, shared).map((name, i) => ({ name, score: friend[i] }));
    const theirs = scoredEntries([...theirsShared, { name: NEW_SPOT, score: friendNew }], 'fr');
    const sim = computeUserTasteSimilarity(mine, theirs);
    const payload: SharedListPayload = {
      id: 'friend',
      ownerUid: 'friend',
      ownerName: 'Your friend',
      restaurants: theirs,
      createdAt: 0,
      updatedAt: 0,
    };
    const metrics = getSpotSocialMetrics(
      { name: NEW_SPOT, category: 'restaurants' },
      { myUid: 'me', myRestaurants: mine, friendLists: [payload] }
    );
    return { sim, predicted: metrics.predictedScore };
  }, [friend, shared, friendNew]);

  const { sim, predicted } = result;
  const shrink = shared / (shared + 3);

  return (
    <Demo title="You vs. a friend" hint="Pick a friend, or drag their scores">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setFriend(p.friend)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
              p.friend.every((v, i) => v === friend[i])
                ? 'border-jade-500 bg-jade-50 text-jade-700 dark:bg-jade-950 dark:text-jade-300'
                : 'border-zinc-200 text-zinc-500 dark:border-zinc-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-5 sm:grid-cols-[200px_1fr]">
        <TasteScatter mine={MINE} friend={friend} shared={shared} />

        <div className="space-y-1.5">
          {SPOTS.map((name, i) => (
            <label key={name} className={`grid grid-cols-[1fr_6.5rem_2rem] items-center gap-2 text-[12.5px] ${i >= shared ? 'opacity-30' : ''}`}>
              <span className="truncate">
                {name} <span className="text-zinc-400">· you {MINE[i].toFixed(1)}</span>
              </span>
              <input
                type="range"
                min={3}
                max={10}
                step={0.1}
                value={friend[i]}
                disabled={i >= shared}
                onChange={(e) => setFriend(friend.map((v, k) => (k === i ? Number(e.target.value) : v)))}
                className="accent-jade-600"
                aria-label={`Friend's score for ${name}`}
              />
              <span className="text-right font-semibold tabular-nums">{friend[i].toFixed(1)}</span>
            </label>
          ))}
          <label className="flex items-center gap-2 pt-1 text-[12.5px] text-zinc-500">
            Spots you've both been to
            <input
              type="range"
              min={1}
              max={SPOTS.length}
              value={shared}
              onChange={(e) => setShared(Number(e.target.value))}
              className="flex-1 accent-jade-600"
            />
            <b className="w-4 tabular-nums text-zinc-800 dark:text-zinc-200">{shared}</b>
          </label>
        </div>
      </div>

      <div className="mt-5 space-y-1.5">
        <Meter label={<>Pearson <Tex>r</Tex></>} value={sim.pearson} />
        <Meter label={<>Kendall <Tex>\tau</Tex></>} value={sim.kendallTau} />
        <Meter label="z-agreement" value={sim.zAgreement} />
        <Meter label={<>Trust <Tex>{'\\tfrac{n}{n+3}'}</Tex></>} value={shrink} min={0} />
      </div>
      <div className="mt-4 flex items-baseline justify-between rounded-2xl bg-jade-50 px-4 py-3 dark:bg-jade-950/50">
        <span className="text-[13px] font-semibold text-jade-800 dark:text-jade-200">Taste match</span>
        <span className="font-display text-3xl font-extrabold tabular-nums text-jade-700 dark:text-jade-300">
          {sim.tasteMatchPct ?? '–'}%
        </span>
      </div>

      <div className="mt-4 rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
        <label className="grid grid-cols-[1fr_6.5rem_2rem] items-center gap-2 text-[12.5px]">
          <span>
            Your friend tried <b>{NEW_SPOT}</b>
          </span>
          <input
            type="range"
            min={3}
            max={10}
            step={0.1}
            value={friendNew}
            onChange={(e) => setFriendNew(Number(e.target.value))}
            className="accent-jade-600"
            aria-label={`Friend's score for ${NEW_SPOT}`}
          />
          <span className="text-right font-semibold tabular-nums">{friendNew.toFixed(1)}</span>
        </label>
        <div className="mt-2 flex items-baseline justify-between text-[13px]">
          <span className="text-zinc-500">jelly's guess for you</span>
          {predicted !== null && (
            <span className="font-display text-2xl font-extrabold tabular-nums" style={{ color: getRatingTier(predicted).thumbColor }}>
              {predicted.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </Demo>
  );
};

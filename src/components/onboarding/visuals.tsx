import React, { useEffect, useMemo, useState } from 'react';
import { Check, Layers, Scale, ShieldCheck, Swords, Users } from 'lucide-react';
import { JellyBeanIcon } from '../JellyBeanIcon';
import { buildList, scoredEntries } from '../../about/sample';
import { TASTE_MINE, TASTE_PRESETS, TASTE_SPOTS, TasteScatter } from '../../about/demos/TasteScatter';
import { computeUserTasteSimilarity, getSpotSocialMetrics } from '../../lib/friendsService';
import { getBestInsertionIndex, initSxSSearch, pickNextOpponent, recordSxSComparison } from '../../lib/rankingEngine';
import { getRatingTier } from '../../lib/ratingTiers';
import { ALL_GROUPS, CATEGORY_LABEL, GROUP_CATEGORIES, GROUP_EMOJI, GROUP_LABEL, SharedListPayload } from '../../types';

interface VisualProps {
  /** The page is on screen: start (or restart) its animation */
  active: boolean;
}

/** Staggered entrance: the animation class only while the page is on screen, so it replays on return */
const rise = (active: boolean, delayMs: number) => ({
  className: active ? 'tour-rise' : '',
  style: active ? { animationDelay: `${delayMs}ms` } : undefined,
});

/** Calls `tick` every `ms` while `active`. Runs with reduced motion too: what it changes crossfades
    or swaps in place, nothing travels across the screen */
function useTicker(active: boolean, ms: number, tick: () => void) {
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(tick, ms);
    return () => clearInterval(id);
  }, [active, ms, tick]);
}

// ---------------------------------------------------------------------------------------------
// 1. Welcome: the beans and the six groups, each cycling through its lists

export const WelcomeVisual: React.FC<VisualProps> = ({ active }) => {
  const [step, setStep] = useState(0);
  const next = React.useCallback(() => setStep((s) => s + 1), []);
  useTicker(active, 1900, next);

  return (
    <div className="flex w-full max-w-sm flex-col items-center">
      <div className={active ? 'tour-pop' : ''}>
        <div className="tour-float">
          <JellyBeanIcon size={124} className="drop-shadow-[0_12px_24px_rgba(5,150,105,0.25)]" />
        </div>
      </div>
      <div className="mt-8 grid w-full grid-cols-3 gap-2.5">
        {ALL_GROUPS.map((g, i) => {
          const lists = GROUP_CATEGORIES[g];
          const list = lists[(step + i) % lists.length];
          const r = rise(active, 180 + i * 70);
          return (
            <div
              key={g}
              className={`rounded-2xl border border-zinc-200/80 bg-white/80 px-2 py-2.5 text-center shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70 ${r.className}`}
              style={r.style}
            >
              <div className="text-2xl leading-none" aria-hidden="true">
                {GROUP_EMOJI[g]}
              </div>
              <div className="mt-1.5 font-display text-[13px] font-bold text-zinc-900 dark:text-zinc-100">{GROUP_LABEL[g]}</div>
              <div key={list} className="tour-fade truncate text-[10.5px] text-zinc-500 dark:text-zinc-400">
                {CATEGORY_LABEL[list]}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// 3. Side-by-side: the real search placing a new spot, answering as someone who loved it

const SXS_LIST = buildList(
  [
    { name: 'Hanami Omakase', gut: 9.4, cuisines: ['Japanese'] },
    { name: 'Osteria Lucia', gut: 9.0, cuisines: ['Italian'] },
    { name: 'Smoke & Ember', gut: 8.6, cuisines: ['BBQ'] },
    { name: 'Tsuru Udon', gut: 8.2, cuisines: ['Japanese'] },
    { name: 'Casa Verde', gut: 7.6, cuisines: ['Mexican'] },
    { name: 'Bao House', gut: 7.0, cuisines: ['Chinese'] },
    { name: 'Burger Barn', gut: 6.0, cuisines: ['American'] },
  ],
  'tour'
);
const NEW_NAME = 'Kiku Ramen';
const NEW_GUT = 7.8;
/** Where the viewer "really" puts it: below Smoke & Ember, above Tsuru Udon */
const TRUE_GAP = 3;

type SxSPhase = 'ask' | 'pick' | 'done';

export const SxSVisual: React.FC<VisualProps> = ({ active }) => {
  // Plays with reduced motion too: each step swaps in place, the bars only change length
  const [state, setState] = useState(() => initSxSSearch(SXS_LIST, NEW_GUT, ['Japanese']));
  const [phase, setPhase] = useState<SxSPhase>('ask');
  const match = useMemo(() => pickNextOpponent(state, SXS_LIST), [state]);
  const { insertIndex } = getBestInsertionIndex(state);
  const newWins = match ? TRUE_GAP <= match.opponentIndex : false;

  // ask → pick → (record) ask … → done → start over
  useEffect(() => {
    if (!active) return;
    const delay = phase === 'ask' ? 1000 : phase === 'pick' ? 750 : 3600;
    const id = window.setTimeout(() => {
      if (phase === 'ask') setPhase(match ? 'pick' : 'done');
      else if (phase === 'pick' && match) {
        const next = recordSxSComparison(state, match.opponentIndex, match.opponent, newWins ? 'new_wins' : 'opponent_wins');
        setState(next);
        setPhase(pickNextOpponent(next, SXS_LIST) ? 'ask' : 'done');
      } else {
        setState(initSxSSearch(SXS_LIST, NEW_GUT, ['Japanese']));
        setPhase('ask');
      }
    }, delay);
    return () => clearTimeout(id);
  }, [active, phase, match, state, newWins]);

  const placed = useMemo(() => {
    const spots = SXS_LIST.map((e) => ({ name: e.name, gut: e.initialRating }));
    spots.splice(insertIndex, 0, { name: NEW_NAME, gut: NEW_GUT });
    return buildList(spots, 'placed');
  }, [insertIndex]);
  const done = phase === 'done';
  const placedScore = placed[insertIndex].magicScore;
  const maxW = Math.max(...state.slotWeights);

  const gapBar = (k: number) => {
    const w = state.slotWeights[k];
    return (
      <div key={`gap${k}`} className="flex h-2.5 items-center pl-6 pr-9">
        <div
          className="h-1.5 rounded-full bg-jade-400/80 transition-all duration-500 dark:bg-jade-500/70"
          style={{ width: `${Math.max(2, (w / maxW) * 100)}%`, opacity: w < 0.01 ? 0.25 : 1 }}
        />
      </div>
    );
  };

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-3xl border border-zinc-200/80 bg-white/90 p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80">
        {done ? (
          <div key="done" className="tour-fade py-1 text-center">
            <div className="text-[11px] text-zinc-400">
              Done after {state.completedComparisons} questions
            </div>
            <div className="font-display text-[15px] font-bold text-zinc-900 dark:text-zinc-100">
              {NEW_NAME} lands at #{insertIndex + 1}
            </div>
            <div className="text-[11.5px] text-zinc-500 dark:text-zinc-400">
              Felt like a {NEW_GUT.toFixed(1)}, scores{' '}
              <b style={{ color: getRatingTier(placedScore).thumbColor }}>{placedScore.toFixed(1)}</b> – your picks win
            </div>
          </div>
        ) : (
          <div>
            <div className="text-center text-[11px] text-zinc-400">
              Question {state.completedComparisons + 1} · Which did you like more?
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {[NEW_NAME, match?.opponent.name ?? ''].map((name, i) => {
                const picked = phase === 'pick' && (i === 0) === newWins;
                return (
                  <div
                    key={`${state.completedComparisons}-${i}`}
                    className={`tour-fade relative truncate rounded-full px-3 py-2 text-center text-[13px] font-semibold transition-all duration-300 ${
                      picked
                        ? 'scale-[1.03] bg-jade-600 text-white shadow-md dark:bg-jade-500 dark:text-jade-950'
                        : phase === 'pick'
                          ? 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500'
                          : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
                    }`}
                  >
                    {picked && <Check className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />}
                    {name}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="mt-3">
        {done
          ? placed.map((spot, i) => {
              const isNew = i === insertIndex;
              return (
                <div
                  key={spot.name}
                  className={`flex h-7 items-center gap-2 rounded-lg px-1.5 text-[13px] ${
                    isNew ? 'tour-pop bg-jade-50 ring-1 ring-jade-300 dark:bg-jade-950/60 dark:ring-jade-700' : ''
                  }`}
                >
                  <span className="w-4 text-right text-[11px] tabular-nums text-zinc-400">{i + 1}</span>
                  <span className={`truncate ${isNew ? 'font-bold text-zinc-900 dark:text-zinc-50' : 'font-medium text-zinc-700 dark:text-zinc-300'}`}>
                    {spot.name}
                  </span>
                  <span
                    className="ml-auto w-8 text-right text-[12px] font-semibold tabular-nums transition-colors"
                    style={{ color: getRatingTier(spot.magicScore).thumbColor }}
                  >
                    {spot.magicScore.toFixed(1)}
                  </span>
                </div>
              );
            })
          : SXS_LIST.map((spot, i) => {
              const isOpp = match?.opponentIndex === i;
              return (
                <React.Fragment key={spot.id}>
                  {gapBar(i)}
                  <div
                    className={`flex h-7 items-center gap-2 rounded-lg px-1.5 text-[13px] transition-colors duration-300 ${
                      isOpp ? 'bg-jade-50 ring-1 ring-jade-300 dark:bg-jade-950/60 dark:ring-jade-700' : ''
                    }`}
                  >
                    <span className="w-4 text-right text-[11px] tabular-nums text-zinc-400">{i + 1}</span>
                    <span className="truncate font-medium text-zinc-700 dark:text-zinc-300">{spot.name}</span>
                    <span
                      className="ml-auto w-8 text-right text-[12px] font-semibold tabular-nums"
                      style={{ color: getRatingTier(spot.magicScore).thumbColor }}
                    >
                      {spot.magicScore.toFixed(1)}
                    </span>
                  </div>
                </React.Fragment>
              );
            })}
        {!done && gapBar(SXS_LIST.length)}
      </div>
      <div className="mt-1.5 text-center text-[10.5px] text-zinc-400">
        {done ? 'Scores refit to your new order' : 'Green bars: where it probably belongs'}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// 4. Friends: taste match on each person's own scale, and the three numbers on every spot

const TRIED = 'Tsuru Udon';
const FRIEND_TRIED = 7.4;

export const FriendsVisual: React.FC<VisualProps> = ({ active }) => {
  const [preset, setPreset] = useState(0);
  const next = React.useCallback(() => setPreset((p) => (p + 1) % TASTE_PRESETS.length), []);
  useTicker(active, 2800, next);

  const { friend, label } = TASTE_PRESETS[preset];
  const { match, predicted } = useMemo(() => {
    const mine = scoredEntries(TASTE_SPOTS.map((name, i) => ({ name, score: TASTE_MINE[i] })), 'me');
    const theirs = scoredEntries(
      [...TASTE_SPOTS.map((name, i) => ({ name, score: friend[i] })), { name: TRIED, score: FRIEND_TRIED }],
      'fr'
    );
    const payload: SharedListPayload = {
      id: 'friend',
      ownerUid: 'friend',
      ownerName: 'Your friend',
      restaurants: theirs,
      createdAt: 0,
      updatedAt: 0,
    };
    const metrics = getSpotSocialMetrics(
      { name: TRIED, category: 'restaurants' },
      { myUid: 'me', myRestaurants: mine, friendLists: [payload] }
    );
    return { match: computeUserTasteSimilarity(mine, theirs).tasteMatchPct, predicted: metrics.predictedScore };
  }, [friend]);

  const tile = 'rounded-xl border p-2 text-center';
  return (
    <div className="w-full max-w-sm space-y-3">
      <div {...rise(active, 0)}>
        <div className="flex items-center gap-3 rounded-3xl border border-zinc-200/80 bg-white/90 p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80">
          <TasteScatter mine={TASTE_MINE} friend={friend} className="w-[46%] max-w-[170px] shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-1">
              {TASTE_PRESETS.map((p, i) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setPreset(i)}
                  className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold transition ${
                    i === preset
                      ? 'border-jade-500 bg-jade-50 text-jade-700 dark:bg-jade-950 dark:text-jade-300'
                      : 'border-zinc-200 text-zinc-400 dark:border-zinc-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="mt-2.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">Taste match</div>
            <div className="font-display text-4xl font-extrabold tabular-nums leading-none text-jade-700 dark:text-jade-300">
              {match ?? '–'}%
            </div>
            <div className="mt-1 text-[10.5px] leading-snug text-zinc-400">
              {label === 'Tougher grader' ? 'Lower numbers, same taste' : label === 'Kindred palate' ? 'Loves what you love' : 'Likes what you skip'}
            </div>
          </div>
        </div>
      </div>

      <div {...rise(active, 120)}>
        <div className="rounded-3xl border border-zinc-200/80 bg-white/90 p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="font-display text-[14px] font-bold text-zinc-900 dark:text-zinc-100">{TRIED}</span>
            <span className="text-[10.5px] text-zinc-400">Want to try</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <div className={`${tile} border-zinc-200/70 dark:border-zinc-800`}>
              <div className="text-[9.5px] font-semibold uppercase tracking-wider text-zinc-400">Friends Avg</div>
              <div className="text-sm font-extrabold tabular-nums text-zinc-900 dark:text-zinc-100">{FRIEND_TRIED.toFixed(1)}</div>
            </div>
            <div className={`${tile} border-zinc-200/70 dark:border-zinc-800`}>
              <div className="text-[9.5px] font-semibold uppercase tracking-wider text-zinc-400">jelly Avg</div>
              <div className="text-sm font-extrabold tabular-nums text-zinc-900 dark:text-zinc-100">7.9</div>
            </div>
            <div className={`${tile} border-jade-500/25 bg-jade-500/10`}>
              <div className="text-[9.5px] font-semibold uppercase tracking-wider text-jade-700 dark:text-jade-300">For You</div>
              <div key={predicted ?? 'none'} className="tour-fade text-sm font-extrabold tabular-nums text-jade-700 dark:text-jade-300">
                {predicted !== null ? `~${predicted.toFixed(1)}` : '–'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div {...rise(active, 240)}>
        <div className="flex items-center justify-center gap-1.5 text-[11.5px] font-semibold text-zinc-500 dark:text-zinc-400">
          <Users className="h-3.5 w-3.5 text-jade-600 dark:text-jade-400" />
          Eat Together · Watch Together · Play Together
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// 5. How jelly is different

const DIFFERENCES = [
  {
    icon: Layers,
    title: 'Every list in one app',
    body: 'Food, places, trips, films, shows, books and games – instead of Beli, Letterboxd and Goodreads side by side.',
  },
  {
    icon: Swords,
    title: 'Compare, don’t bucket',
    body: 'No fixed good/okay/bad ranges: your picks set the order, and a spot can land anywhere.',
  },
  {
    icon: Scale,
    title: 'Your scale, not the crowd’s',
    body: 'Review sites average strangers. Your scores follow your own gut and your own order.',
  },
  {
    icon: ShieldCheck,
    title: 'No ads, no data sales',
    body: 'jelly never shows ads or sells your data.',
  },
];

export const DifferentVisual: React.FC<VisualProps> = ({ active }) => (
  <div className="w-full max-w-sm space-y-2">
    {DIFFERENCES.map((d, i) => {
      const r = rise(active, 80 + i * 110);
      return (
        <div
          key={d.title}
          className={`flex items-start gap-3 rounded-2xl border border-zinc-200/80 bg-white/90 p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80 ${r.className}`}
          style={r.style}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-jade-100 text-jade-700 dark:bg-jade-900/70 dark:text-jade-300">
            <d.icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="font-display text-[14px] font-bold text-zinc-900 dark:text-zinc-100">{d.title}</div>
            <div className="mt-0.5 text-[12.5px] leading-snug text-zinc-500 dark:text-zinc-400">{d.body}</div>
          </div>
        </div>
      );
    })}
  </div>
);

// ---------------------------------------------------------------------------------------------
// 6. Free

/** Counts up to `to` once the page is on screen (a changing number isn't motion, so always) */
function useCountUp(active: boolean, to: number, ms = 900): number {
  const [value, setValue] = useState(active ? 0 : to);
  useEffect(() => {
    if (!active) {
      setValue(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setValue(Math.round(to * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(frame);
    };
    setValue(0);
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active, to, ms]);
  return value;
}

export const FreeVisual: React.FC<VisualProps> = ({ active }) => {
  const cost = useCountUp(active, 50);
  const stats = [
    { value: '$0', label: 'for you' },
    { value: `<$${cost}`, label: 'a year to run' },
    { value: '0', label: 'ads' },
  ];
  return (
    <div className="w-full max-w-sm">
      <div className="grid grid-cols-3 gap-2">
        {stats.map((s, i) => {
          const r = rise(active, 60 + i * 110);
          return (
            <div
              key={s.label}
              className={`rounded-2xl border border-zinc-200/80 bg-white/90 px-2 py-4 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80 ${r.className}`}
              style={r.style}
            >
              <div className="font-display text-[1.7rem] font-extrabold tabular-nums leading-none text-jade-700 dark:text-jade-300">
                {s.value}
              </div>
              <div className="mt-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{s.label}</div>
            </div>
          );
        })}
      </div>
      <div {...rise(active, 400)}>
        <figure className="mt-3 rounded-3xl border border-zinc-200/80 bg-white/90 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80">
          <blockquote className="space-y-2 text-[13.5px] leading-relaxed text-zinc-700 dark:text-zinc-300">
            <p>
              jelly is a pet project I built for family & friends. It costs me under $50 a year to run, so it’s free – no
              ads, no subscriptions.
            </p>
            <p>
              I don’t plan to ever charge for jelly. If usage and costs grew a lot, I might need some other way to cover
              them, but I don’t expect that, and if it ever happens you’ll hear about it clearly, well in advance.
            </p>
          </blockquote>
          <figcaption className="mt-3 flex items-center justify-end gap-2 text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">
            <JellyBeanIcon size={20} /> Ofek
          </figcaption>
        </figure>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// 7. Get started: an empty list waiting for its first spot

export const StartVisual: React.FC<VisualProps> = ({ active }) => (
  <div className="flex w-full max-w-[18rem] flex-col items-center">
    <div className={active ? 'tour-pop' : ''}>
      <div className="tour-float">
        <JellyBeanIcon size={96} />
      </div>
    </div>
    <div className="mt-6 w-full space-y-2">
      {[0, 1, 2].map((i) => {
        const r = rise(active, 150 + i * 110);
        return (
          <div
            key={i}
            className={`flex h-11 items-center gap-3 rounded-2xl border px-3 ${
              i === 0
                ? 'border-jade-400/70 bg-jade-50 dark:border-jade-700 dark:bg-jade-950/50'
                : 'border-dashed border-zinc-300 dark:border-zinc-700'
            } ${r.className}`}
            style={r.style}
          >
            <span className="w-4 text-right text-[11px] font-semibold tabular-nums text-zinc-400">{i + 1}</span>
            {i === 0 ? (
              <span className="text-[13px] font-semibold text-jade-800 dark:text-jade-200">Your first spot</span>
            ) : (
              <span className="h-2 flex-1 rounded-full bg-zinc-200/80 dark:bg-zinc-800" style={{ maxWidth: `${70 - i * 18}%` }} />
            )}
          </div>
        );
      })}
    </div>
  </div>
);

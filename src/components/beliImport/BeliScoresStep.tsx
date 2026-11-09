import React, { useMemo } from 'react';
import { Check } from 'lucide-react';
import { CATEGORY_EMOJI, CATEGORY_LABEL, SpotCategory } from '../../types';
import {
  answerBoundaryQuestion,
  bucketOf,
  continueBoundary,
  finishBoundary,
  mergedOrder,
  nextBoundaryQuestion,
  startBoundaryMerge,
} from '../../lib/beliImport/boundaryMerge';
import { interpolateGuts, suggestAnchors } from '../../lib/beliImport/scores';
import type {
  AnchorLevel,
  BeliBucket,
  BeliRankedRow,
  BoundaryAnswer,
  BoundaryMergeState,
  BucketBounds,
  ScoredList,
} from '../../lib/beliImport/types';
import { RATING_TIERS, getRatingTier } from '../../lib/ratingTiers';
import { ScoreBadge } from '../ScoreBadge';
import { SecondaryButton, SpectrumSlider } from './parts';

/** Lists this short skip the bucket questions: there is nothing to merge */
const MIN_FOR_BUCKETS = 4;

export type ScorePhase = 'fine' | 'disliked' | 'compare' | 'rate';

/** Everything the user said about one list (plain data: saved with the session) */
export interface ListScoreState {
  phase: ScorePhase;
  bounds: BucketBounds;
  merge?: BoundaryMergeState;
  /** Gut ratings by row key */
  ratings: Record<string, number>;
  level: AnchorLevel;
  done: boolean;
  /** "Use suggested scores": no questions, the preset fills in */
  suggested: boolean;
}

export function initialScoreState(rows: BeliRankedRow[]): ListScoreState {
  return {
    phase: rows.length >= MIN_FOR_BUCKETS ? 'fine' : 'rate',
    bounds: {},
    ratings: {},
    level: 'quick',
    done: false,
    suggested: false,
  };
}

export function scoreOrder(rows: BeliRankedRow[], s: ListScoreState): { order: string[]; buckets?: Record<string, BeliBucket> } {
  if (s.merge) return { order: mergedOrder(s.merge), buckets: bucketOf(s.merge) };
  return { order: rows.map((r) => r.key) };
}

/** The engine's input for one list */
export function toScoredList(category: SpotCategory, rows: BeliRankedRow[], s: ListScoreState): ScoredList {
  const { order, buckets } = scoreOrder(rows, s);
  const asked = s.suggested ? [] : suggestAnchors(order, s.level, buckets);
  return {
    category,
    order,
    buckets,
    anchors: s.suggested ? [] : asked.filter((k) => s.ratings[k] !== undefined).map((key) => ({ key, rating: s.ratings[key], source: 'user' as const })),
    answers: s.merge?.answers ?? [],
  };
}

interface Props {
  categories: SpotCategory[];
  active: SpotCategory;
  onActive: (c: SpotCategory) => void;
  rowsFor: (c: SpotCategory) => BeliRankedRow[];
  states: Partial<Record<SpotCategory, ListScoreState>>;
  onState: (c: SpotCategory, s: ListScoreState) => void;
  linear: boolean;
}

export const BeliScoresStep: React.FC<Props> = ({ categories, active, onActive, rowsFor, states, onState, linear }) => {
  const rows = rowsFor(active);
  const s = states[active] ?? initialScoreState(rows);
  const set = (patch: Partial<ListScoreState>) => onState(active, { ...s, ...patch });
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);

  const startMerge = (bounds: BucketBounds) => {
    const merge = startBoundaryMerge(
      rows.map((r) => r.key),
      bounds
    );
    set({ bounds, merge, phase: nextBoundaryQuestion(merge) ? 'compare' : 'rate' });
  };

  return (
    <>
      <div role="tablist" aria-label="Lists" className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 py-0.5">
        {categories.map((c) => {
          const on = c === active;
          return (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onActive(c)}
              className={`shrink-0 min-h-9 px-3 rounded-full border text-xs font-semibold flex items-center gap-1.5 ${
                on
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
              }`}
            >
              <span aria-hidden="true">{CATEGORY_EMOJI[c]}</span>
              {CATEGORY_LABEL[c]}
              {states[c]?.done && <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-label="done" />}
            </button>
          );
        })}
      </div>

      {s.phase === 'fine' && (
        <BoundaryPick
          title="Where does “It was fine” start?"
          hint={`In Beli, find the first place in ${CATEGORY_LABEL[active]} scored below 6.7, then tap it here.`}
          rows={rows}
          from={0}
          noneLabel="Everything was “I liked it”"
          onPick={(i) => set({ bounds: { firstFine: i }, phase: 'disliked' })}
          onNone={() => set({ bounds: { firstFine: rows.length }, phase: 'disliked' })}
          onSkip={() => set({ phase: 'rate', bounds: {} })}
        />
      )}

      {s.phase === 'disliked' && (
        <BoundaryPick
          title="And where does “I didn’t like it” start?"
          hint="The first place scored below 3.4."
          rows={rows}
          from={s.bounds.firstFine ?? 0}
          noneLabel="None I didn’t like"
          onPick={(i) => startMerge({ ...s.bounds, firstDisliked: i })}
          onNone={() => startMerge({ ...s.bounds, firstDisliked: rows.length })}
          onSkip={() => startMerge({ ...s.bounds, firstDisliked: rows.length })}
          skipLabel="Not sure"
        />
      )}

      {s.phase === 'compare' && s.merge && (
        <BoundaryCompare
          merge={s.merge}
          byKey={byKey}
          onAnswer={(a) => {
            const merge = answerBoundaryQuestion(s.merge!, a);
            set({ merge, phase: nextBoundaryQuestion(merge) || merge.paused ? 'compare' : 'rate' });
          }}
          onMore={() => set({ merge: continueBoundary(s.merge!) })}
          onEnough={() => {
            const merge = finishBoundary(s.merge!);
            set({ merge, phase: nextBoundaryQuestion(merge) || merge.paused ? 'compare' : 'rate' });
          }}
        />
      )}

      {s.phase === 'rate' && <RateAnchors rows={rows} byKey={byKey} s={s} set={set} linear={linear} category={active} />}
    </>
  );
};

const BoundaryPick: React.FC<{
  title: string;
  hint: string;
  rows: BeliRankedRow[];
  from: number;
  noneLabel: string;
  onPick: (index: number) => void;
  onNone: () => void;
  onSkip: () => void;
  skipLabel?: string;
}> = ({ title, hint, rows, from, noneLabel, onPick, onNone, onSkip, skipLabel = 'Skip this' }) => (
  <>
    <div>
      <h1 className="text-lg font-extrabold leading-tight">{title}</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{hint}</p>
    </div>
    <p className="text-xs text-zinc-500 dark:text-zinc-400 -mt-2">
      Beli sorts each of its three answers separately, so places near these lines are often out of order. A few quick picks
      fix that.
    </p>
    <div role="radiogroup" aria-label={title} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 max-h-[min(50dvh,22rem)] short:max-h-48 overflow-y-auto overscroll-contain">
      {rows.slice(from).map((r, j) => (
        <button
          key={r.key}
          type="button"
          role="radio"
          aria-checked={false}
          onClick={() => onPick(from + j)}
          className="w-full flex items-center gap-3 min-h-11 px-3 py-2 text-left text-sm border-t first:border-t-0 border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 [content-visibility:auto] [contain-intrinsic-size:auto_44px]"
        >
          <span className="w-9 shrink-0 text-right text-xs font-bold text-zinc-400 tabular-nums">#{r.rank}</span>
          <span className="flex-1 min-w-0 break-words">{r.name}</span>
        </button>
      ))}
    </div>
    <div className="flex flex-wrap gap-2">
      <SecondaryButton small onClick={onNone}>
        {noneLabel}
      </SecondaryButton>
      <SecondaryButton small onClick={onSkip}>
        {skipLabel}
      </SecondaryButton>
    </div>
  </>
);

const BoundaryCompare: React.FC<{
  merge: BoundaryMergeState;
  byKey: Map<string, BeliRankedRow>;
  onAnswer: (a: BoundaryAnswer) => void;
  onMore: () => void;
  onEnough: () => void;
}> = ({ merge, byKey, onAnswer, onMore, onEnough }) => {
  const q = nextBoundaryQuestion(merge);
  if (merge.paused || !q) {
    return (
      <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 p-4 flex flex-col gap-3">
        <h1 className="text-lg font-extrabold">Keep going?</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          A few more picks place the rest more exactly. Stopping keeps Beli’s order for what’s left.
        </p>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton onClick={onMore}>A few more</SecondaryButton>
          <SecondaryButton onClick={onEnough}>That’s enough</SecondaryButton>
        </div>
      </div>
    );
  }
  const a = byKey.get(q.upper);
  const b = byKey.get(q.lower);
  const Card = ({ row, answer }: { row?: BeliRankedRow; answer: BoundaryAnswer }) => (
    <button
      type="button"
      onClick={() => onAnswer(answer)}
      className="flex-1 min-w-0 min-h-20 min-[400px]:min-h-28 rounded-3xl border-2 border-zinc-200 dark:border-zinc-700 hover:border-emerald-500 px-4 py-3 flex flex-col justify-center items-center text-center gap-1 active:scale-[0.99] transition"
    >
      <span className="text-base font-bold break-words">{row?.name}</span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{row?.city}</span>
    </button>
  );
  return (
    <>
      <div>
        <h1 className="text-lg font-extrabold">Which was better?</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          These sit on either side of Beli’s line. {q.asked + 1} of up to {q.cap}.
        </p>
      </div>
      <div className="flex flex-col min-[400px]:flex-row gap-2.5">
        <Card row={a} answer="upper" />
        <Card row={b} answer="lower" />
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        <SecondaryButton small onClick={() => onAnswer('tie')}>
          Too close to call
        </SecondaryButton>
        <SecondaryButton small onClick={() => onAnswer('skip')}>
          Skip the rest
        </SecondaryButton>
      </div>
    </>
  );
};

const RateAnchors: React.FC<{
  rows: BeliRankedRow[];
  byKey: Map<string, BeliRankedRow>;
  s: ListScoreState;
  set: (p: Partial<ListScoreState>) => void;
  linear: boolean;
  category: SpotCategory;
}> = ({ rows, byKey, s, set, linear, category }) => {
  const { order, buckets } = scoreOrder(rows, s);
  const asked = suggestAnchors(order, s.level, buckets);
  const anchors = asked.filter((k) => s.ratings[k] !== undefined).map((key) => ({ key, rating: s.ratings[key], source: 'user' as const }));
  const guts = interpolateGuts(order, anchors, { linear, buckets });
  const posOf = new Map(order.map((k, i) => [k, i]));

  return (
    <>
      <div>
        <h1 className="text-lg font-extrabold leading-tight">How did these feel?</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Beli only shares your order. Rate {asked.length === 1 ? 'this one' : `these ${asked.length}`}, and jelly fills in the
          rest of {CATEGORY_LABEL[category]}.
        </p>
      </div>
      {asked.map((key) => {
        const row = byKey.get(key);
        const rating = s.ratings[key] ?? guts[key];
        return (
          <div key={key} className="rounded-3xl border border-zinc-200 dark:border-zinc-800 p-3.5 flex flex-col gap-2.5">
            <div className="flex items-start gap-2.5">
              <span className="shrink-0 min-w-10 h-7 px-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-xs font-extrabold flex items-center justify-center tabular-nums">
                #{(posOf.get(key) ?? 0) + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold leading-snug break-words line-clamp-2">{row?.name}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{row?.city}</p>
              </div>
            </div>
            <SpectrumSlider
              rating={rating}
              linear={linear}
              label={`How #${(posOf.get(key) ?? 0) + 1}, ${row?.name}, felt`}
              onChange={(r) => set({ ratings: { ...s.ratings, [key]: r }, suggested: false })}
            />
          </div>
        );
      })}
      {s.level === 'quick' && order.length > 6 && (
        <SecondaryButton onClick={() => set({ level: 'more' })}>Rate a few more for accuracy</SecondaryButton>
      )}
      <Preview order={order} guts={guts} byKey={byKey} />
    </>
  );
};

const Preview: React.FC<{ order: string[]; guts: Record<string, number>; byKey: Map<string, BeliRankedRow> }> = ({ order, guts, byKey }) => {
  const counts = RATING_TIERS.map((t) => order.filter((k) => getRatingTier(guts[k]) === t).length);
  const n = order.length;
  const shown = n <= 6 ? order.map((_, i) => i) : [0, 1, 2, -1, n - 2, n - 1];
  return (
    <section aria-label="Preview" className="rounded-3xl bg-zinc-100 dark:bg-zinc-800/60 p-3.5 flex flex-col gap-2.5">
      <p className="text-xs font-bold flex justify-between">
        <span>Preview</span>
        <span className="font-semibold text-zinc-500 dark:text-zinc-400">about {n} scores</span>
      </p>
      <div className="flex h-5 rounded-lg overflow-hidden gap-0.5" role="img" aria-label={RATING_TIERS.map((t, i) => `${counts[i]} ${t.name}`).join(', ')}>
        {RATING_TIERS.map((t, i) =>
          counts[i] ? <span key={t.name} style={{ flex: counts[i], backgroundColor: t.thumbColor }} /> : null
        )}
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        {RATING_TIERS.map((t, i) => (
          <span key={t.name}>
            <b className="text-zinc-700 dark:text-zinc-200 tabular-nums">{counts[i]}</b> {t.name}
          </span>
        ))}
      </p>
      {shown.map((i, j) =>
        i < 0 ? (
          <span key={`gap${j}`} className="text-xs text-zinc-400 pl-10" aria-hidden="true">
            ⋮
          </span>
        ) : (
          <div key={order[i]} className="flex items-center gap-2.5 text-sm">
            <span className="w-8 text-right text-xs font-bold text-zinc-400 tabular-nums">#{i + 1}</span>
            <span className="flex-1 min-w-0 truncate">{byKey.get(order[i])?.name}</span>
            <ScoreBadge score={guts[order[i]]} size="sm" />
          </div>
        )
      )}
    </section>
  );
};

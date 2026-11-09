import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { CATEGORY_EMOJI, CATEGORY_LABEL, SpotCategory } from '../../types';
import { answerMergeQuestion, finishMerge, mergeOrder, nextMergeQuestion, startBucketMerge } from '../../lib/beliImport/merge';
import { estimateScores, listAccuracy, nextToRate } from '../../lib/beliImport/scores';
import type { BeliRankedRow, BucketBounds, MergeAnswer, MergeState, ScoredList } from '../../lib/beliImport/types';
import { RATING_TIERS, getRatingTier } from '../../lib/ratingTiers';
import { ScoreBadge } from '../ScoreBadge';
import { PrimaryButton, QuietButton, SecondaryButton, SpectrumSlider } from './parts';

/** Lists this short skip the bucket questions: there is little to merge */
const MIN_FOR_BUCKETS = 4;

export type ScorePhase = 'fine' | 'disliked' | 'rate' | 'merge' | 'done';

/** Everything the user said about one list (plain data: saved with the session) */
export interface ListScoreState {
  phase: ScorePhase;
  bounds: BucketBounds;
  /** Gut ratings by row key; a spot without one stays unrated (never guessed) */
  guts: Record<string, number>;
  /** Spots the user chose not to rate */
  skipped: string[];
  /** Beli's three buckets merged into one order */
  bucketMerge?: MergeState;
  /** That order merged with the existing jelly list (after the place check) */
  jellyMerge?: MergeState;
}

export function initialScoreState(rows: BeliRankedRow[]): ListScoreState {
  return { phase: rows.length >= MIN_FOR_BUCKETS ? 'fine' : 'rate', bounds: {}, guts: {}, skipped: [] };
}

/** The list's order so far (Beli's, or after the bucket merge) */
export function beliOrder(rows: BeliRankedRow[], s: ListScoreState): string[] {
  return s.bucketMerge ? mergeOrder(s.bucketMerge) : rows.map((r) => r.key);
}

/** The engine's input for one list */
export function toScoredList(category: SpotCategory, rows: BeliRankedRow[], s: ListScoreState): ScoredList {
  return {
    category,
    order: s.jellyMerge ? mergeOrder(s.jellyMerge) : beliOrder(rows, s),
    guts: s.guts,
    answers: [...(s.bucketMerge?.answers ?? []), ...(s.jellyMerge?.answers ?? [])],
  };
}

/** Stops rating: the bucket merge comes next when the user said where Beli's buckets start */
function afterRating(rows: BeliRankedRow[], s: ListScoreState): ListScoreState {
  const keys = rows.map((r) => r.key);
  const n = keys.length;
  const split = (s.bounds.firstFine ?? n) < n || (s.bounds.firstDisliked ?? n) < n;
  if (s.bucketMerge) return { ...s, phase: nextMergeQuestion(s.bucketMerge) ? 'merge' : 'done' };
  if (!split) return { ...s, phase: 'done' };
  const bucketMerge = startBucketMerge(keys, s.bounds, estimateScores(keys, s.guts));
  return { ...s, bucketMerge, phase: nextMergeQuestion(bucketMerge) ? 'merge' : 'done' };
}

/** Wraps up a list (the footer's "next" / "skip the rest"): a merge in progress is finished by estimate */
export function settleList(rows: BeliRankedRow[], s: ListScoreState): ListScoreState {
  const next = s.phase === 'merge' || s.phase === 'done' ? s : afterRating(rows, s);
  return { ...next, bucketMerge: next.bucketMerge ? finishMerge(next.bucketMerge) : undefined, phase: 'done' };
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
  const set = (next: ListScoreState) => onState(active, next);
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const label = (key: string) => {
    const r = byKey.get(key);
    return { name: r?.name ?? '', sub: r?.city ?? '' };
  };

  return (
    <>
      <ListTabs categories={categories} active={active} onActive={onActive} isDone={(c) => states[c]?.phase === 'done'} />

      {s.phase === 'fine' && (
        <BoundaryPick
          title="Where does “It was fine” start?"
          hint={`In Beli, find the first place in ${CATEGORY_LABEL[active]} scored below 6.7, then tap it here.`}
          rows={rows}
          from={0}
          noneLabel="Everything was “I liked it”"
          onPick={(i) => set({ ...s, bounds: { firstFine: i }, phase: 'disliked' })}
          onNone={() => set({ ...s, bounds: { firstFine: rows.length }, phase: 'disliked' })}
          onSkip={() => set({ ...s, bounds: {}, phase: 'rate' })}
        />
      )}

      {s.phase === 'disliked' && (
        <BoundaryPick
          title="And where does “I didn’t like it” start?"
          hint="The first place scored below 3.4."
          rows={rows}
          from={s.bounds.firstFine ?? 0}
          noneLabel="None I didn’t like"
          onPick={(i) => set({ ...s, bounds: { ...s.bounds, firstDisliked: i }, phase: 'rate' })}
          onNone={() => set({ ...s, bounds: { ...s.bounds, firstDisliked: rows.length }, phase: 'rate' })}
          onSkip={() => set({ ...s, bounds: { ...s.bounds, firstDisliked: rows.length }, phase: 'rate' })}
          skipLabel="Not sure"
        />
      )}

      {s.phase === 'rate' && <RateNext rows={rows} byKey={byKey} s={s} set={set} linear={linear} category={active} />}

      {s.phase === 'merge' && s.bucketMerge && (
        <MergeQuestions
          merge={s.bucketMerge}
          label={label}
          intro="Beli sorted these into separate piles, so the order across them is a guess. Each pick puts a place where it belongs."
          onAnswer={(m) => set({ ...s, bucketMerge: m, phase: nextMergeQuestion(m) ? 'merge' : 'done' })}
          onStop={() => set({ ...s, bucketMerge: finishMerge(s.bucketMerge!), phase: 'done' })}
        />
      )}

      {s.phase === 'done' && <ListDone category={active} rows={rows} s={s} onRateMore={() => set({ ...s, phase: 'rate', skipped: [] })} />}

      {(s.phase === 'rate' || s.phase === 'done') && <Preview order={beliOrder(rows, s)} guts={s.guts} byKey={byKey} />}
    </>
  );
};

export const ListTabs: React.FC<{
  categories: SpotCategory[];
  active: SpotCategory;
  onActive: (c: SpotCategory) => void;
  isDone: (c: SpotCategory) => boolean;
}> = ({ categories, active, onActive, isDone }) => (
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
          {isDone(c) && <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-label="done" />}
        </button>
      );
    })}
  </div>
);

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
      Beli sorts each of its three answers separately, so places near these lines are often out of order. Quick picks later
      fix that.
    </p>
    <div
      role="radiogroup"
      aria-label={title}
      className="rounded-2xl border border-zinc-200 dark:border-zinc-800 max-h-[min(50dvh,22rem)] short:max-h-48 overflow-y-auto overscroll-contain"
    >
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

/** One spot at a time, in the engine's order (#1, last, middle, then the middle of each gap) */
const RateNext: React.FC<{
  rows: BeliRankedRow[];
  byKey: Map<string, BeliRankedRow>;
  s: ListScoreState;
  set: (s: ListScoreState) => void;
  linear: boolean;
  category: SpotCategory;
}> = ({ rows, byKey, s, set, linear, category }) => {
  const order = useMemo(() => beliOrder(rows, s), [rows, s]);
  const key = nextToRate(order, s.guts).find((k) => !s.skipped.includes(k));
  const estimate = useMemo(() => (key ? estimateScores(order, s.guts)[key] : 7), [key, order, s.guts]);
  const [draft, setDraft] = useState<{ key: string; rating: number } | null>(null);
  const rating = draft && draft.key === key ? draft.rating : Math.round(Math.min(10, Math.max(1, estimate ?? 7)) * 10) / 10;
  const acc = listAccuracy(order, s.guts);
  const row = key ? byKey.get(key) : undefined;
  const position = key ? order.indexOf(key) + 1 : 0;
  // Each new spot comes into view (the page stays where it is when the card already is)
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [key]);

  const save = () => {
    if (!key) return;
    const guts = { ...s.guts, [key]: rating };
    const left = nextToRate(order, guts).some((k) => !s.skipped.includes(k));
    const next = { ...s, guts };
    set(left ? next : afterRating(rows, next));
    setDraft(null);
  };
  const skip = () => {
    if (!key) return;
    const next = { ...s, skipped: [...s.skipped, key] };
    set(nextToRate(order, s.guts).some((k) => !next.skipped.includes(k)) ? next : afterRating(rows, next));
  };

  return (
    <>
      <div>
        <h1 className="text-lg font-extrabold leading-tight">How did this one feel?</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Beli only shares your order. Rating every spot in {CATEGORY_LABEL[category]} gives the most accurate scores. Stop
          whenever you like.
        </p>
      </div>
      {row && (
        <div ref={cardRef} className="scroll-my-3 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-3.5 flex flex-col gap-2.5">
          <div className="flex flex-col gap-1.5" aria-live="polite">
        <div className="flex justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
          <span>
            <b className="text-zinc-800 dark:text-zinc-100">{acc.rated}</b> of {acc.total} rated
          </span>
          <span>{Number.isFinite(acc.typicalError) ? `scores within about ±${acc.typicalError.toFixed(1)}` : 'rate a few to see how close'}</span>
        </div>
        <span className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden" aria-hidden="true">
          <span className="block h-full bg-emerald-500 rounded-full" style={{ width: `${acc.total ? (acc.rated / acc.total) * 100 : 0}%` }} />
        </span>
      </div>
          <div className="flex items-start gap-2.5">
            <span className="shrink-0 min-w-10 h-7 px-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-xs font-extrabold flex items-center justify-center tabular-nums">
              #{position}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold leading-snug break-words line-clamp-2">{row.name}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{row.city}</p>
            </div>
          </div>
          <SpectrumSlider rating={rating} linear={linear} label={`How #${position}, ${row.name}, felt`} onChange={(r) => setDraft({ key: row.key, rating: r })} />
          <div className="flex flex-wrap items-center gap-2">
            <PrimaryButton onClick={save}>Save and next</PrimaryButton>
            <SecondaryButton onClick={skip}>Don’t remember</SecondaryButton>
          </div>
        </div>
      )}
      <QuietButton onClick={() => set(afterRating(rows, s))} className="self-center">
        {acc.rated === 0 ? 'Skip rating' : 'Done rating'}
      </QuietButton>
    </>
  );
};

/** Side-by-side questions that merge two sorted runs, with no cap; "Stop here" places the rest by estimate */
export const MergeQuestions: React.FC<{
  merge: MergeState;
  label: (key: string) => { name: string; sub: string };
  intro: string;
  onAnswer: (next: MergeState) => void;
  onStop: () => void;
}> = ({ merge, label, intro, onAnswer, onStop }) => {
  const q = nextMergeQuestion(merge);
  if (!q) return null;
  const answer = (a: MergeAnswer) => onAnswer(answerMergeQuestion(merge, a));
  const card = (k: string, a: MergeAnswer) => {
    const { name, sub } = label(k);
    return (
      <button
        key={k}
        type="button"
        onClick={() => answer(a)}
        className="flex-1 min-w-0 min-h-20 min-[400px]:min-h-28 rounded-3xl border-2 border-zinc-200 dark:border-zinc-700 hover:border-emerald-500 px-4 py-3 flex flex-col justify-center items-center text-center gap-1 active:scale-[0.99] transition"
      >
        <span className="text-base font-bold break-words">{name}</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{sub}</span>
      </button>
    );
  };
  return (
    <>
      <div>
        <h1 className="text-lg font-extrabold">Which was better?</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{intro}</p>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums -mt-2" aria-live="polite">
        {q.asked} answered · {q.remaining} {q.remaining === 1 ? 'place' : 'places'} left to place
      </p>
      <div className="flex flex-col min-[400px]:flex-row gap-2.5">
        {card(q.other, 'other')}
        {card(q.candidate, 'candidate')}
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        <SecondaryButton small onClick={() => answer('tie')}>
          Too close to call
        </SecondaryButton>
        <SecondaryButton small onClick={onStop}>
          Stop here
        </SecondaryButton>
      </div>
    </>
  );
};

const ListDone: React.FC<{ category: SpotCategory; rows: BeliRankedRow[]; s: ListScoreState; onRateMore: () => void }> = ({ category, rows, s, onRateMore }) => {
  const order = beliOrder(rows, s);
  const acc = listAccuracy(order, s.guts);
  const left = nextToRate(order, s.guts).length;
  return (
    <div className="rounded-3xl bg-emerald-50 dark:bg-emerald-950/30 p-4 flex flex-col gap-2">
      <h1 className="text-lg font-extrabold">{CATEGORY_LABEL[category]} is ready</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        {acc.rated} of {acc.total} rated
        {Number.isFinite(acc.typicalError) ? `, so scores are within about ±${acc.typicalError.toFixed(1)}.` : ', so scores come from your order alone.'}
        {left > 0 ? ' Rating more makes them more exact.' : ''}
      </p>
      {left > 0 && (
        <SecondaryButton small onClick={onRateMore} className="self-start">
          Rate more
        </SecondaryButton>
      )}
    </div>
  );
};

const Preview: React.FC<{ order: string[]; guts: Record<string, number>; byKey: Map<string, BeliRankedRow> }> = ({ order, guts, byKey }) => {
  const est = useMemo(() => estimateScores(order, guts), [order, guts]);
  // One or two ratings can't shape a list yet (#1, last and the middle come first)
  if (Object.keys(guts).length < Math.min(3, order.length)) return null;
  const counts = RATING_TIERS.map((t) => order.filter((k) => getRatingTier(est[k]) === t).length);
  const n = order.length;
  const shown = n <= 6 ? order.map((_, i) => i) : [0, 1, 2, -1, n - 2, n - 1];
  return (
    <section aria-label="Preview" className="rounded-3xl bg-zinc-100 dark:bg-zinc-800/60 p-3.5 flex flex-col gap-2.5">
      <p className="text-xs font-bold flex justify-between">
        <span>Preview</span>
        <span className="font-semibold text-zinc-500 dark:text-zinc-400">scores so far</span>
      </p>
      <div className="flex h-5 rounded-lg overflow-hidden gap-0.5" role="img" aria-label={RATING_TIERS.map((t, i) => `${counts[i]} ${t.name}`).join(', ')}>
        {RATING_TIERS.map((t, i) => (counts[i] ? <span key={t.name} style={{ flex: counts[i], backgroundColor: t.thumbColor }} /> : null))}
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
            <ScoreBadge score={est[order[i]]} size="sm" />
          </div>
        )
      )}
    </section>
  );
};

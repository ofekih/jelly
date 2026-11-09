import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkEntry, CATEGORY_EMOJI, CATEGORY_LABEL, RestaurantEntry, SpotCategory } from '../../types';
import { BeliImportError, readBeliFiles } from '../../lib/beliImport/parse';
import { buildMatchQueries, matchPlaces } from '../../lib/beliImport/match';
import { alreadyImported, buildImportPlan, createImportBatchId } from '../../lib/beliImport/plan';
import { indexedDbStore } from '../../lib/beliImport/store';
import type { BeliExport, ImportPlan, MatchDecision, MatchProgress, MatchResult } from '../../lib/beliImport/types';
import { BELI_UNDO_DAYS, reviewItems } from '../../lib/beliImportUi';
import { trackEvent } from '../../firebase';
import { AskBeliStep, FileStep, SignInStep } from './BeliFileSteps';
import { BeliScoresStep, initialScoreState, ListScoreState, toScoredList } from './BeliScoresStep';
import { BeliReviewStep, matchedRowsFor, PlaceSearchPanel, ReviewTab } from './BeliReviewStep';
import { Hero, ImportShell, PrimaryButton, QuietButton, SecondaryButton, Switch, useKeyboardInset } from './parts';

type Step = 'file' | 'ask' | 'summary' | 'scores' | 'review' | 'search' | 'done';

/** Everything chosen so far, saved on this device so a closed tab or a reload loses nothing */
interface SavedSession {
  exp: BeliExport;
  include: SpotCategory[];
  includeBookmarks: boolean;
  scores: Partial<Record<SpotCategory, ListScoreState>>;
  decisions: Record<string, MatchDecision>;
  step: Step;
  savedAt: number;
}

const sessions = indexedDbStore<SavedSession>('sessions');
const sessionKey = (uid: string) => `beli-ui:${uid}`;

export interface BeliImportFlowProps {
  onClose: () => void;
  uid: string | null;
  onSignIn: () => void;
  restaurants: RestaurantEntry[];
  bookmarks: BookmarkEntry[];
  linearRatingScale: boolean;
  /** Saves the plan (state, local copy, Firestore) and shows the Undo toast */
  onImport: (plan: ImportPlan) => Promise<void>;
  /** Opens a list after the import */
  onSeeList: (category: SpotCategory) => void;
  /** Start on the request helper (from the Eat card's "ask Beli first") */
  startOnAsk?: boolean;
  username: string;
  onUsername: (name: string) => void;
  /** "I've sent it": remembered on this device, the Eat card changes */
  onAsked: () => void;
}

const minutes = (lookups: number) => Math.max(1, Math.round((lookups * 0.6) / 4 / 60));

export const BeliImportFlow: React.FC<BeliImportFlowProps> = (props) => {
  const { onClose, uid, onSignIn, restaurants, bookmarks, linearRatingScale, onImport, onSeeList } = props;
  const [step, setStep] = useState<Step>(props.startOnAsk ? 'ask' : 'file');
  const [exp, setExp] = useState<BeliExport | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [include, setInclude] = useState<SpotCategory[]>([]);
  const [includeBookmarks, setIncludeBookmarks] = useState(true);
  const [scores, setScores] = useState<Partial<Record<SpotCategory, ListScoreState>>>({});
  const [activeList, setActiveList] = useState<SpotCategory | null>(null);
  const [decisions, setDecisions] = useState<Record<string, MatchDecision>>({});
  const [matches, setMatches] = useState<Record<string, MatchResult>>({});
  const [progress, setProgress] = useState<MatchProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState(false);
  const [tab, setTab] = useState<ReviewTab>('look');
  const [searchKey, setSearchKey] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ImportPlan | null>(null);
  const [resumable, setResumable] = useState<SavedSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const keyboardInset = useKeyboardInset(step === 'search' || step === 'ask');

  // A saved, unfinished import for this account
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    sessions
      .get(sessionKey(uid))
      .then((s) => alive && s && setResumable(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [uid]);

  // Save choices as they change (cheap: a few hundred rows of text)
  useEffect(() => {
    if (!uid || !exp || result) return;
    const t = setTimeout(() => {
      sessions
        .set(sessionKey(uid), { exp, include, includeBookmarks, scores, decisions, step: step === 'search' ? 'review' : step, savedAt: Date.now() })
        .catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [uid, exp, include, includeBookmarks, scores, decisions, step, result]);

  // Each step starts at the top
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [step, activeList]);

  // Stop lookups when the flow closes (finished ones stay cached: resuming is free)
  useEffect(() => () => abortRef.current?.abort(), []);

  const rankedKeys = useMemo(() => new Set(include.flatMap((c) => (exp?.lists[c] ?? []).map((r) => r.key))), [exp, include]);
  const queries = useMemo(() => {
    if (!exp) return [];
    const savedKeys = new Set(includeBookmarks ? exp.bookmarks.filter((b) => include.includes(b.category)).map((b) => b.key) : []);
    return buildMatchQueries(exp, alreadyImported(restaurants, bookmarks)).filter((q) => rankedKeys.has(q.key) || savedKeys.has(q.key));
  }, [exp, include, includeBookmarks, rankedKeys, restaurants, bookmarks]);

  const runMatching = useCallback(
    async (only?: Set<string>) => {
      if (!exp) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setFatal(false);
      const list = only ? queries.filter((q) => only.has(q.key)) : queries;
      const run = await matchPlaces(list, {
        signal: controller.signal,
        onProgress: setProgress,
        onResult: (r) => setMatches((m) => ({ ...m, [r.key]: r })),
      });
      if (controller.signal.aborted) return;
      setMatches((m) => ({ ...m, ...run.results }));
      setFatal(Boolean(run.fatal));
      setRunning(false);
      trackEvent('beli_import_matched', { total: run.progress.total, matched: run.progress.matched, review: run.progress.review, not_found: run.progress.notFound, api_calls: run.progress.apiCalls });
    },
    [exp, queries]
  );

  const pickFiles = async (files: File[]) => {
    setReading(true);
    setFileError(null);
    try {
      const parsed = await readBeliFiles(files);
      const cats = (Object.keys(parsed.lists) as SpotCategory[]).filter((c) => (parsed.lists[c]?.length ?? 0) > 0);
      setExp(parsed);
      setInclude(cats);
      setScores(Object.fromEntries(cats.map((c) => [c, initialScoreState(parsed.lists[c]!)])));
      setActiveList(cats[0] ?? null);
      setDecisions({});
      setMatches({});
      setProgress(null);
      setStep('summary');
      trackEvent('beli_import_file', { lists: cats.length, ranked: cats.reduce((n, c) => n + (parsed.lists[c]?.length ?? 0), 0), bookmarks: parsed.bookmarks.length });
    } catch (err) {
      const names = files.map((f) => f.name).join(', ');
      if (err instanceof BeliImportError) {
        setFileError(
          err.code === 'not_zip'
            ? `${names} isn’t a zip file. Choose the .zip Beli emailed you, or the CSV files inside it.`
            : err.code === 'no_rankings'
              ? `You picked ${names}, which doesn’t include rankings.csv. Choose the whole zip, or select all the CSVs at once.`
              : `${names} doesn’t look like a Beli export. If Beli changed its format, send us feedback with the column names.`
        );
      } else {
        setFileError('That file couldn’t be read. Try choosing it again.');
      }
    } finally {
      setReading(false);
    }
  };

  const resume = () => {
    if (!resumable) return;
    setExp(resumable.exp);
    setInclude(resumable.include);
    setIncludeBookmarks(resumable.includeBookmarks);
    setScores(resumable.scores);
    setDecisions(resumable.decisions);
    setActiveList(resumable.include[0] ?? null);
    setStep(resumable.step === 'file' || resumable.step === 'ask' ? 'summary' : resumable.step);
    setResumable(null);
  };

  // Lookups resume (free, from the cache) whenever a resumed session lands past the summary
  const needsMatching = Boolean(exp) && (step === 'scores' || step === 'review') && !running && progress === null;
  useEffect(() => {
    if (needsMatching) void runMatching();
  }, [needsMatching, runMatching]);

  const items = useMemo(() => (exp ? reviewItems(exp, matches, include).filter((i) => i.ranks.length > 0 || includeBookmarks) : []), [exp, matches, include, includeBookmarks]);
  const matchedRows = useMemo(() => (exp ? matchedRowsFor(exp, matches, include) : []), [exp, matches, include]);
  const failedKeys = useMemo(() => new Set(items.filter((i) => i.match.status === 'error').map((i) => i.key)), [items]);
  const openCount = items.filter((i) => i.ranks.length > 0 && !decisions[i.key]).length;
  const matchingDone = progress !== null && !running;

  const buildPlan = useCallback((): ImportPlan | null => {
    if (!exp) return null;
    return buildImportPlan({
      exp,
      lists: include.map((c) => toScoredList(c, exp.lists[c] ?? [], scores[c] ?? initialScoreState(exp.lists[c] ?? []))),
      matches,
      decisions,
      restaurants,
      bookmarks,
      includeBookmarks,
      linear: linearRatingScale,
      batch: createImportBatchId(),
    });
  }, [exp, include, scores, matches, decisions, restaurants, bookmarks, includeBookmarks, linearRatingScale]);
  const preview = useMemo(() => (confirming ? buildPlan() : null), [confirming, buildPlan]);

  const commit = async () => {
    const plan = buildPlan();
    if (!plan) return;
    setSaving(true);
    try {
      await onImport(plan);
      setResult(plan);
      setConfirming(false);
      setStep('done');
      if (uid) sessions.delete(sessionKey(uid)).catch(() => {});
      trackEvent('beli_import_done', { added: Object.values(plan.summary.added).reduce((a, b) => a + (b ?? 0), 0), bookmarks: plan.summary.addedBookmarks, skipped: plan.summary.skipped });
    } finally {
      setSaving(false);
    }
  };

  const nextUnscored = include.find((c) => c !== activeList && !scores[c]?.done);
  const finishList = () => {
    if (!activeList || !exp) return;
    const cur = scores[activeList] ?? initialScoreState(exp.lists[activeList] ?? []);
    setScores((s) => ({ ...s, [activeList]: { ...cur, done: true } }));
    if (nextUnscored) setActiveList(nextUnscored);
    else setStep('review');
  };
  const suggestAll = () => {
    if (!exp) return;
    // Lists you already answered for keep your answers; the rest use the preset
    setScores((s) =>
      Object.fromEntries(
        include.map((c) => {
          const cur = s[c] ?? initialScoreState(exp.lists[c] ?? []);
          const answered = cur.done || Object.keys(cur.ratings).length > 0 || Boolean(cur.merge);
          return [c, { ...cur, suggested: !answered, done: true }];
        })
      )
    );
    setStep('review');
  };

  // ---------------------------------------------------------------------------
  if (!uid && step !== 'ask') {
    return (
      <ImportShell title="Import from Beli" step={0} onClose={onClose} compact>
        <SignInStep onSignIn={onSignIn} onAsk={() => setStep('ask')} />
      </ImportShell>
    );
  }

  if (step === 'ask') {
    return (
      <ImportShell
        title="Ask Beli for your data"
        step={1}
        onBack={() => setStep('file')}
        onClose={onClose}
        keyboardInset={keyboardInset}
        footer={
          <SecondaryButton
            className="flex-1"
            onClick={() => {
              props.onAsked();
              onClose();
            }}
          >
            I’ve sent it – remind me
          </SecondaryButton>
        }
      >
        <AskBeliStep username={props.username} onUsername={props.onUsername} />
      </ImportShell>
    );
  }

  if (step === 'file' || !exp) {
    return (
      <ImportShell title="Your Beli file" step={1} onClose={onClose}>
        <FileStep
          busy={reading}
          error={fileError}
          onFiles={pickFiles}
          onAsk={() => setStep('ask')}
          resumable={resumable ? { savedAt: resumable.savedAt, spots: resumable.include.reduce((n, c) => n + (resumable.exp.lists[c]?.length ?? 0), 0) } : null}
          onResume={resume}
        />
      </ImportShell>
    );
  }

  const listCount = (c: SpotCategory) => exp.lists[c]?.length ?? 0;
  const allCats = (Object.keys(exp.lists) as SpotCategory[]).filter((c) => listCount(c) > 0);
  const savedCount = exp.bookmarks.filter((b) => include.includes(b.category)).length;
  const notesCount = allCats.reduce((n, c) => n + (exp.lists[c] ?? []).filter((r) => r.notes || r.favoriteDishes || r.privateNotes).length, 0);
  const totalRanked = include.reduce((n, c) => n + listCount(c), 0);

  if (step === 'summary') {
    return (
      <ImportShell
        title="What’s coming over"
        step={2}
        onBack={() => setStep('file')}
        onClose={onClose}
        footer={
          <>
            <span className="flex-1 min-w-[9rem] text-xs text-zinc-500 dark:text-zinc-400">
              {queries.length} places to look up · about {minutes(queries.length)} min
            </span>
            <PrimaryButton
              disabled={include.length === 0}
              onClick={() => {
                setActiveList(include[0]);
                setProgress(null);
                setStep('scores');
              }}
            >
              Continue
            </PrimaryButton>
          </>
        }
      >
        <Hero title={`Found ${totalRanked} rankings${savedCount ? ` and ${savedCount} places to try` : ''}`}>
          Switch off anything you’d rather leave behind.
        </Hero>
        <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 -mb-2">Rankings · each list stays separate</p>
        <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          {allCats.map((c) => {
            const on = include.includes(c);
            return (
              <ToggleRow
                key={c}
                on={on}
                emoji={CATEGORY_EMOJI[c]}
                label={CATEGORY_LABEL[c]}
                count={listCount(c)}
                onToggle={() => setInclude((cur) => (on ? cur.filter((x) => x !== c) : allCats.filter((x) => x === c || cur.includes(x))))}
              />
            );
          })}
        </div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 -mb-2">Also</p>
        <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <ToggleRow on={includeBookmarks} emoji="🔖" label="Want to try" sub="Into each list’s Want to try" count={savedCount} onToggle={() => setIncludeBookmarks((v) => !v)} />
        </div>
        <div className="rounded-2xl bg-zinc-100 dark:bg-zinc-800/60 p-3.5 text-xs text-zinc-600 dark:text-zinc-400 flex flex-col gap-1">
          <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Comes along</p>
          <p>Notes and favorite dishes on {notesCount} places (visible on your shared list, like all jelly notes). Private notes stay private.</p>
          <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mt-2">Not coming over</p>
          <p>Beli scores (the export only has your order, so you’ll set a few next), photos, labels and preferences.</p>
        </div>
        {exp.report.badRows.length > 0 && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{exp.report.badRows.length} rows in the file couldn’t be read and are left out.</p>
        )}
      </ImportShell>
    );
  }

  const strip = (
    <div aria-live="polite" className="shrink-0 bg-emerald-50 dark:bg-emerald-950/30 border-b border-zinc-100 dark:border-zinc-800 py-2 short:py-1 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
      <div className="max-w-md mx-auto short:max-w-2xl flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {fatal ? (
          <span className="flex-1">Google Maps refused the lookup. Try again later.</span>
        ) : matchingDone ? (
          <span className="flex-1">
            ✓ Looked up all <b className="tabular-nums">{progress?.total}</b> places
          </span>
        ) : (
          <span className="flex-1">
            Finding places on Google Maps · <b className="tabular-nums">{progress?.done ?? 0}</b> / {progress?.total ?? queries.length}
            {progress?.backingOff ? ' · waiting a moment' : ''}
          </span>
        )}
        {!matchingDone && !fatal && (
          <span className="text-zinc-500 dark:text-zinc-400 short:hidden">Keep jelly open – it picks up where it left off</span>
        )}
        <span className="basis-full h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden short:hidden" aria-hidden="true">
          <span
            className="block h-full bg-emerald-500 rounded-full transition-[width] duration-300"
            style={{ width: `${progress?.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
          />
        </span>
      </div>
    </div>
  );

  if (step === 'scores' && activeList) {
    return (
      <ImportShell
        title="Scores"
        step={3}
        onBack={() => setStep('summary')}
        onClose={onClose}
        strip={strip}
        bodyRef={bodyRef}
        footer={
          <>
            <QuietButton onClick={suggestAll} className="px-2" title="Suggested scores for the lists you haven’t rated">Use suggested</QuietButton>
            <PrimaryButton onClick={finishList} disabled={!nextUnscored && !matchingDone && !fatal}>
              {nextUnscored ? `Next: ${CATEGORY_LABEL[nextUnscored]}` : matchingDone || fatal ? 'Check places' : 'Finishing lookup…'}
            </PrimaryButton>
          </>
        }
      >
        <BeliScoresStep
          categories={include}
          active={activeList}
          onActive={setActiveList}
          rowsFor={(c) => exp.lists[c] ?? []}
          states={scores}
          onState={(c, s) => setScores((cur) => ({ ...cur, [c]: s }))}
          linear={linearRatingScale}
        />
      </ImportShell>
    );
  }

  if (step === 'search' && searchKey) {
    const item = items.find((i) => i.key === searchKey);
    const row = item ?? matchedRows.find((r) => r.key === searchKey);
    const category = item?.ranks[0]?.category ?? item?.bookmarkCategory ?? matchedRows.find((r) => r.key === searchKey)?.category ?? include[0];
    const city = item?.city ?? include.flatMap((c) => exp.lists[c] ?? []).find((r) => r.key === searchKey)?.city ?? '';
    const done = (d: MatchDecision) => {
      setDecisions((cur) => ({ ...cur, [searchKey]: d }));
      setStep('review');
    };
    return (
      <ImportShell title="Find the place" step={4} wide onBack={() => setStep('review')} onClose={onClose} keyboardInset={keyboardInset}>
        <PlaceSearchPanel
          name={row?.name ?? ''}
          city={city}
          category={category}
          onPick={(candidate) => done({ kind: 'place', candidate })}
          onManual={() => done({ kind: 'manual' })}
        />
      </ImportShell>
    );
  }

  if (step === 'review') {
    const adds = (preview ?? null) && preview;
    return (
      <>
        <ImportShell
          title="Check places"
          step={4}
          wide
          onBack={() => setStep('scores')}
          onClose={onClose}
          strip={matchingDone ? undefined : strip}
          bodyRef={bodyRef}
          footer={
            <>
              <span className="flex-1 min-w-[8rem] text-xs text-zinc-500 dark:text-zinc-400">
                {openCount ? `${openCount} left out for now – you can fix them later` : 'Nothing left to fix'}
              </span>
              <PrimaryButton disabled={!matchingDone && !fatal} onClick={() => setConfirming(true)}>
                Add to jelly
              </PrimaryButton>
            </>
          }
        >
          <BeliReviewStep
            items={items}
            decisions={decisions}
            onDecide={(key, d) =>
              setDecisions((cur) => {
                const next = { ...cur };
                if (d) next[key] = d;
                else delete next[key];
                return next;
              })
            }
            tab={tab}
            onTab={setTab}
            matchedRows={matchedRows}
            onSearch={(key) => {
              setSearchKey(key);
              setStep('search');
            }}
            failed={failedKeys.size}
            onRetry={() => {
              setProgress(null);
              void runMatching(failedKeys);
            }}
          />
        </ImportShell>
        {confirming && adds && (
          <ConfirmImport plan={adds} saving={saving} onCancel={() => setConfirming(false)} onConfirm={commit} hadSpots={restaurants.some((r) => include.includes(r.category))} />
        )}
      </>
    );
  }

  if (step === 'done' && result) {
    const added = Object.entries(result.summary.added) as Array<[SpotCategory, number]>;
    const total = added.reduce((n, [, k]) => n + k, 0);
    return (
      <ImportShell
        title="Done"
        step={5}
        onClose={onClose}
        footer={
          <PrimaryButton
            onClick={() => {
              onSeeList(added[0]?.[0] ?? 'restaurants');
              onClose();
            }}
          >
            See my {CATEGORY_LABEL[added[0]?.[0] ?? 'restaurants']}
          </PrimaryButton>
        }
      >
        <Hero
          title={`${total} spots are in jelly`}
          art={<span className="w-16 h-16 rounded-full bg-emerald-600 text-white flex items-center justify-center text-3xl font-extrabold">✓</span>}
        >
          {result.summary.addedBookmarks ? `Plus ${result.summary.addedBookmarks} places to try. ` : ''}Your Beli order is now jelly scores.
        </Hero>
        <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          {added.map(([c, n]) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                onSeeList(c);
                onClose();
              }}
              className="w-full flex items-center gap-3 min-h-13 px-4 py-2.5 text-left text-sm border-t first:border-t-0 border-zinc-100 dark:border-zinc-800"
            >
              <span aria-hidden="true" className="text-lg w-6 text-center">
                {CATEGORY_EMOJI[c]}
              </span>
              <span className="flex-1">{CATEGORY_LABEL[c]}</span>
              <span className="font-bold tabular-nums">{n}</span>
              <span className="text-zinc-400" aria-hidden="true">
                ›
              </span>
            </button>
          ))}
        </div>
        {(result.summary.duplicates.length > 0 || result.summary.skipped > 0) && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {result.summary.duplicates.length > 0 && `${result.summary.duplicates.length} were already in jelly and kept your jelly score. `}
            {result.summary.skipped > 0 && `${result.summary.skipped} were left out; choose the same file again any time to add them.`}
          </p>
        )}
        <div className="rounded-2xl bg-zinc-100 dark:bg-zinc-800/60 p-3.5 text-xs text-zinc-600 dark:text-zinc-400">
          <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-1">Make the scores yours</p>
          Imported scores are a good start. If one looks off, open it and tap Rank again, or drag it in the list. Changed your mind?
          Settings → Import from Beli can undo this for {BELI_UNDO_DAYS} days.
        </div>
      </ImportShell>
    );
  }

  return null;
};

const ToggleRow: React.FC<{ on: boolean; emoji: string; label: string; sub?: string; count: number; onToggle: () => void }> = ({ on, emoji, label, sub, count, onToggle }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    onClick={onToggle}
    className="w-full flex items-center gap-3 min-h-14 px-4 py-2 text-left border-t first:border-t-0 border-zinc-100 dark:border-zinc-800"
  >
    <span aria-hidden="true" className="text-xl w-7 text-center">
      {emoji}
    </span>
    <span className={`flex-1 min-w-0 ${on ? '' : 'opacity-50'}`}>
      <span className="block text-sm font-bold">{label}</span>
      {sub && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{sub}</span>}
    </span>
    <span className={`text-sm font-bold tabular-nums text-zinc-600 dark:text-zinc-300 ${on ? '' : 'opacity-50'}`}>{count}</span>
    <Switch checked={on} />
  </button>
);

const ConfirmImport: React.FC<{ plan: ImportPlan; saving: boolean; hadSpots: boolean; onCancel: () => void; onConfirm: () => void }> = ({
  plan,
  saving,
  hadSpots,
  onCancel,
  onConfirm,
}) => {
  const added = Object.entries(plan.summary.added) as Array<[SpotCategory, number]>;
  const total = added.reduce((n, [, k]) => n + k, 0);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-xs p-4 animate-jelly-backdrop" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="beli-confirm-title"
        className="w-full max-w-xs max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800 p-5 flex flex-col gap-3.5 animate-jelly-dialog text-zinc-900 dark:text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="beli-confirm-title" className="font-bold text-sm">
          Add {total} spots to jelly?
        </h3>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
          {added.map(([c, n]) => (
            <React.Fragment key={c}>
              <dt>
                {CATEGORY_EMOJI[c]} {CATEGORY_LABEL[c]}
              </dt>
              <dd className="font-bold tabular-nums text-right">{n}</dd>
            </React.Fragment>
          ))}
          {plan.summary.addedBookmarks > 0 && (
            <>
              <dt>🔖 Want to try</dt>
              <dd className="font-bold tabular-nums text-right">{plan.summary.addedBookmarks}</dd>
            </>
          )}
        </dl>
        {hadSpots && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            They’re woven in among your spots by score.
            {plan.summary.duplicates.length > 0 && ` ${plan.summary.duplicates.length} you’ve already ranked keep your jelly score and rank.`}
          </p>
        )}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">You can undo the whole import from Settings for {BELI_UNDO_DAYS} days.</p>
        <div className="grid grid-cols-2 gap-2">
          <SecondaryButton small onClick={onCancel}>
            Cancel
          </SecondaryButton>
          <button
            type="button"
            disabled={saving}
            onClick={onConfirm}
            className="min-h-9 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-60"
          >
            {saving ? 'Adding…' : 'Add spots'}
          </button>
        </div>
      </div>
    </div>
  );
};

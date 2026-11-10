import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Search, X } from 'lucide-react';
import { CATEGORY_LABEL, PlaceCandidate, SpotCategory } from '../../types';
import { searchPlaces } from '../../lib/placesService';
import { reviewReason, type ReviewItem } from '../../lib/beliImportUi';
import type { BeliExport, MatchDecision, MatchResult } from '../../lib/beliImport/types';
import { SecondaryButton } from './parts';

export type ReviewTab = 'look' | 'missing' | 'matched';

interface Props {
  items: ReviewItem[];
  decisions: Record<string, MatchDecision>;
  onDecide: (key: string, decision: MatchDecision | undefined) => void;
  tab: ReviewTab;
  onTab: (t: ReviewTab) => void;
  matchedRows: Array<{ key: string; name: string; category: SpotCategory; rank: number; match: MatchResult }>;
  onSearch: (key: string) => void;
  failed: number;
  onRetry: () => void;
}

const where = (c: PlaceCandidate) => [c.neighborhood, c.city].filter(Boolean).join(', ') || c.formattedAddress;

export const BeliReviewStep: React.FC<Props> = ({ items, decisions, onDecide, tab, onTab, matchedRows, onSearch, failed, onRetry }) => {
  const ranked = items.filter((i) => i.ranks.length > 0);
  const look = ranked.filter((i) => i.match.status === 'review');
  const missing = ranked.filter((i) => i.match.status !== 'review');
  const saved = items.filter((i) => i.ranks.length === 0);
  const open = ranked.filter((i) => !decisions[i.key]).length;
  const [showSaved, setShowSaved] = useState(false);

  return (
    <>
      <div>
        <h1 className="text-lg font-extrabold">{open ? `${open} place${open === 1 ? '' : 's'} need${open === 1 ? 's' : ''} you` : 'All sorted'}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Everything else matched on its own. Fix what you can; the rest is left out, and you can add those by hand later.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
        <span className="px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
          ✓ {matchedRows.length} matched
        </span>
        <span className="px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
          {look.length} need a look
        </span>
        <span className="px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">{missing.length} not found</span>
      </div>
      {failed > 0 && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="flex-1 min-w-[12rem]">{failed} lookups didn’t finish (connection or limit).</span>
          <SecondaryButton small onClick={onRetry}>
            Try again
          </SecondaryButton>
        </div>
      )}
      <div role="tablist" aria-label="Places" className="flex p-[3px] rounded-2xl bg-zinc-100 dark:bg-zinc-800 gap-0.5">
        {(
          [
            ['look', `Need a look · ${look.length}`],
            ['missing', `Not found · ${missing.length}`],
            ['matched', 'Matched'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTab(id)}
            className={`flex-1 min-h-9 rounded-xl text-xs font-bold whitespace-nowrap px-1.5 ${
              tab === id ? 'bg-white dark:bg-zinc-900 shadow-2xs text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'look' &&
        (look.length ? look.map((i) => <ProblemCard key={i.key} item={i} decision={decisions[i.key]} onDecide={onDecide} onSearch={onSearch} />) : <Empty text="Nothing unsure." />)}
      {tab === 'missing' && (
        <>
          {missing.length ? (
            missing.map((i) => <ProblemCard key={i.key} item={i} decision={decisions[i.key]} onDecide={onDecide} onSearch={onSearch} />)
          ) : (
            <Empty text="Everything was found." />
          )}
          {missing.length > 0 && (
            <p className="text-xs text-center text-zinc-400">Closed places can be kept without a map pin, so your ranking stays whole.</p>
          )}
        </>
      )}
      {tab === 'matched' && <MatchedList rows={matchedRows} decisions={decisions} onSearch={onSearch} />}

      {tab !== 'matched' && saved.length > 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-3.5 flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex-1 min-w-0 text-sm">
              <b>{saved.length} want-to-try places need a look</b>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">They’re left out unless you fix them.</p>
            </div>
            <SecondaryButton small onClick={() => setShowSaved((v) => !v)} aria-expanded={showSaved}>
              {showSaved ? 'Hide' : 'Show'}
            </SecondaryButton>
          </div>
          {showSaved && saved.map((i) => <ProblemCard key={i.key} item={i} decision={decisions[i.key]} onDecide={onDecide} onSearch={onSearch} />)}
        </div>
      )}
    </>
  );
};

const Empty: React.FC<{ text: string }> = ({ text }) => <p className="text-sm text-center text-zinc-400 py-6">{text}</p>;

const ProblemCard: React.FC<{
  item: ReviewItem;
  decision?: MatchDecision;
  onDecide: (key: string, d: MatchDecision | undefined) => void;
  onSearch: (key: string) => void;
}> = ({ item, decision, onDecide, onSearch }) => {
  const label = item.ranks.length
    ? item.ranks.map((r) => `#${r.rank} in ${CATEGORY_LABEL[r.category]}`).join(' · ')
    : `Want to try · ${CATEGORY_LABEL[item.bookmarkCategory!]}`;
  if (decision) {
    const text =
      decision.kind === 'skip'
        ? 'Skipped'
        : decision.kind === 'manual'
          ? '✓ Kept without a map pin'
          : `✓ ${decision.candidate.name} · ${where(decision.candidate)}`;
    return (
      <div className="rounded-3xl bg-zinc-100 dark:bg-zinc-800/60 px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">{label}</p>
        <p className="text-sm font-bold break-words">{item.name}</p>
        <div className="flex items-center gap-2 mt-1">
          <p className={`flex-1 min-w-0 text-xs font-semibold break-words ${decision.kind === 'skip' ? 'text-zinc-500' : 'text-emerald-700 dark:text-emerald-300'}`}>{text}</p>
          <button type="button" onClick={() => onDecide(item.key, undefined)} className="shrink-0 min-h-8 px-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            Change
          </button>
        </div>
      </div>
    );
  }
  const candidates = item.match.candidates.slice(0, 3);
  return (
    <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      <div className="px-4 pt-3 pb-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">{label}</p>
        <p className="text-[15px] font-bold leading-snug break-words">{item.name}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Beli: {item.city || 'no city'}</p>
        <p className="inline-block mt-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
          {reviewReason(item)}
        </p>
      </div>
      {candidates.length > 0 && (
        <div role="radiogroup" aria-label={`Which ${item.name}?`}>
          {candidates.map((c) => (
            <button
              key={c.placeId}
              type="button"
              role="radio"
              aria-checked={false}
              onClick={() => onDecide(item.key, { kind: 'place', candidate: c })}
              className="w-full flex items-start gap-3 px-4 py-2.5 min-h-12 text-left border-t border-zinc-100 dark:border-zinc-800 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/20"
            >
              <span className="mt-0.5 w-5 h-5 rounded-full border-2 border-zinc-300 dark:border-zinc-600 shrink-0" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold break-words">{c.name}</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400 break-words">
                  {c.formattedAddress}
                  {c.primaryTypeDisplay ? ` · ${c.primaryTypeDisplay}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 px-3 py-2.5 border-t border-zinc-100 dark:border-zinc-800">
        <SecondaryButton small onClick={() => onSearch(item.key)} className="flex-auto">
          Search
        </SecondaryButton>
        <SecondaryButton small onClick={() => onDecide(item.key, { kind: 'manual' })} className="flex-auto">
          Keep without pin
        </SecondaryButton>
        <SecondaryButton small onClick={() => onDecide(item.key, { kind: 'skip' })} className="flex-auto">
          Skip
        </SecondaryButton>
      </div>
    </div>
  );
};

const ROW = 56;

/** Every auto-matched ranking, windowed: only the rows in view (plus a few) are rendered */
const MatchedList: React.FC<{
  rows: Props['matchedRows'];
  decisions: Record<string, MatchDecision>;
  onSearch: (key: string) => void;
}> = ({ rows, decisions, onSearch }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(440);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const from = Math.max(0, Math.floor(top / ROW) - 4);
  const to = Math.min(rows.length, Math.ceil((top + height) / ROW) + 4);
  return (
    <div
      ref={ref}
      onScroll={(e) => setTop(e.currentTarget.scrollTop)}
      className="relative h-[min(60dvh,28rem)] short:h-56 overflow-y-auto overscroll-contain rounded-2xl border border-zinc-200 dark:border-zinc-800"
      aria-label={`${rows.length} matched places`}
      role="list"
    >
      <div style={{ height: rows.length * ROW }} className="relative">
        {rows.slice(from, to).map((r, j) => {
          const d = decisions[r.key];
          const place = d?.kind === 'place' ? d.candidate : r.match.best;
          return (
            <div
              key={`${r.category}|${r.key}`}
              role="listitem"
              style={{ top: (from + j) * ROW, height: ROW }}
              className="absolute inset-x-0 flex items-center gap-2.5 px-3 border-b border-zinc-100 dark:border-zinc-800 text-sm"
            >
              <span className="w-9 shrink-0 text-right text-xs font-bold text-zinc-400 tabular-nums">#{r.rank}</span>
              <span className="flex-1 min-w-0">
                <span className="block font-semibold truncate">{r.name}</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  {d?.kind === 'skip' ? 'Skipped' : d?.kind === 'manual' ? 'Without a map pin' : place ? where(place) : ''}
                </span>
              </span>
              <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500">{CATEGORY_LABEL[r.category]}</span>
              <button type="button" onClick={() => onSearch(r.key)} className="shrink-0 min-h-9 px-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                Change
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Find a place by hand (for an unsure or missing match, or to change an automatic one) */
export const PlaceSearchPanel: React.FC<{
  name: string;
  city: string;
  category: SpotCategory;
  onPick: (c: PlaceCandidate) => void;
  onManual: () => void;
}> = ({ name, city, category, onPick, onManual }) => {
  const [query, setQuery] = useState(`${name}`);
  const [results, setResults] = useState<PlaceCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const cityName = useMemo(() => city.split(',')[0].trim(), [city]);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      searchPlaces(q, undefined, cityName, null, 'eat', category, { cityChosen: true })
        .then((r) => !cancelled && setResults(r.results.slice(0, 8)))
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setLoading(false));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, cityName, category]);

  return (
    <>
      <div className="flex items-center gap-2 min-h-12 px-3 rounded-2xl border-[1.5px] border-emerald-500 bg-white dark:bg-zinc-900">
        <Search className="w-4 h-4 text-zinc-400 shrink-0" aria-hidden="true" />
        <label htmlFor="beli-place-search" className="sr-only">
          Search Google Maps
        </label>
        <input
          id="beli-place-search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          enterKeyHint="search"
          className="flex-1 min-w-0 bg-transparent text-base outline-none"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label="Clear" className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 -mt-2">
        Searching near {cityName || 'you'}. {loading ? 'Looking…' : ''}
      </p>
      <div className="flex flex-col">
        {results.map((c) => (
          <button
            key={c.placeId}
            type="button"
            onClick={() => onPick(c)}
            className="flex items-center gap-3 min-h-14 py-2.5 border-b border-zinc-100 dark:border-zinc-800 text-left"
          >
            <span className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
              <MapPin className="w-4 h-4 text-zinc-500" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold break-words">{c.name}</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400 break-words">{c.formattedAddress}</span>
            </span>
          </button>
        ))}
        <button type="button" onClick={onManual} className="flex items-center gap-3 min-h-14 py-2.5 text-left">
          <span className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 text-zinc-500" aria-hidden="true">
            ✱
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold break-words">Keep “{name}” without a map pin</span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">For places that closed or aren’t on Google</span>
          </span>
        </button>
      </div>
    </>
  );
};

export function matchedRowsFor(
  exp: BeliExport,
  matches: Record<string, MatchResult>,
  categories: SpotCategory[]
): Props['matchedRows'] {
  const out: Props['matchedRows'] = [];
  for (const category of categories) {
    for (const row of exp.lists[category] ?? []) {
      const match = matches[row.key];
      if (match?.status === 'matched') out.push({ key: row.key, name: row.name, category, rank: row.rank, match });
    }
  }
  return out;
}

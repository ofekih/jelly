import React, { useEffect, useState } from 'react';
import { Bookmark, ExternalLink, LogIn, Sparkles } from 'lucide-react';
import { CATEGORY_GROUP, CATEGORY_LABEL, SpotCategory } from '../types';
import { GROUP_COPY, hasLocation, wantLabel } from '../lib/groups';
import { hasSquareCover, posterUrl, spotLink, spotPlaceLabel } from '../lib/media';
import { PosterThumb } from './PosterThumb';
import type { ForYouSpot } from '../lib/predictions';
import type { PredictionConfidence } from '../lib/tasteModel';
import { formatDistanceMiles, getItemDistanceMiles, UserCoordinates } from '../lib/geo';
import { ScoreBadge } from './ScoreBadge';

/** Rows shown before "Show more" (the doc can hold well over a thousand spots). */
const PAGE_SIZE = 30;

const CONFIDENCE_LABEL: Record<PredictionConfidence, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const CONFIDENCE_CLASSES: Record<PredictionConfidence, string> = {
  high: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  medium: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  low: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400',
};

interface ForYouRowProps {
  item: ForYouSpot;
  userLocation: UserCoordinates | null;
  isSaved: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleBookmark: (spot: ForYouSpot) => void;
  onRank: (spot: ForYouSpot) => void;
}

const ForYouRow: React.FC<ForYouRowProps> = ({
  item,
  userLocation,
  isSaved,
  expanded,
  onToggleExpanded,
  onToggleBookmark,
  onRank,
}) => {
  const want = wantLabel(item.category);
  const { prediction } = item;
  const subtitleParts = [
    item.cuisines[0],
    spotPlaceLabel(item),
    formatDistanceMiles(getItemDistanceMiles(item, userLocation)),
  ].filter(Boolean);
  const link = item.googleMapsUri || item.media ? spotLink(item) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={onToggleExpanded}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        onToggleExpanded();
      }}
      className="flex items-center gap-3 px-3.5 sm:px-4 py-3.5 bg-white dark:bg-zinc-900 hover:bg-zinc-50/90 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer"
    >
      <div title="Predicted score for you" className="shrink-0">
        <ScoreBadge score={prediction.score} size="sm" predicted />
      </div>

      {item.media && <PosterThumb src={posterUrl(item.media)} square={hasSquareCover(item.placeId)} className="w-8 h-12 -my-1" />}

      <div className="flex-1 min-w-0">
        <div className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm sm:text-[15px] truncate leading-snug">
          {item.name}
        </div>
        {subtitleParts.length > 0 && (
          <div className="text-xs text-zinc-400 dark:text-zinc-500 truncate mt-0.5">{subtitleParts.join(' · ')}</div>
        )}
        <p
          className={`mt-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400 ${expanded ? '' : 'truncate'}`}
          title={prediction.basis}
        >
          <span
            className={`inline-block px-1.5 py-0.5 mr-1.5 rounded-md font-semibold whitespace-nowrap ${CONFIDENCE_CLASSES[prediction.confidence]}`}
            title={`${CONFIDENCE_LABEL[prediction.confidence]} confidence`}
          >
            {CONFIDENCE_LABEL[prediction.confidence]}
            <span className={expanded ? '' : 'hidden sm:inline'}> confidence</span>
          </span>
          {prediction.basis}
        </p>
        {expanded && link && (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            <span>Open in {link.site}</span>
          </a>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => onToggleBookmark(item)}
          className={`p-2 rounded-full transition-colors ${
            isSaved ? 'text-rose-500 bg-rose-500/10' : 'text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10'
          }`}
          title={isSaved ? `Remove from ${want}` : `Save to ${want}`}
          aria-label={isSaved ? `Remove from ${want}` : `Save to ${want}`}
          aria-pressed={isSaved}
        >
          <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-rose-500' : ''}`} />
        </button>
        <button
          type="button"
          onClick={() => onRank(item)}
          className="px-3 py-1.5 rounded-full bg-zinc-900 hover:bg-zinc-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-zinc-950 text-xs font-bold inline-flex items-center gap-1 transition-colors"
          title={`${GROUP_COPY[CATEGORY_GROUP[item.category]].done}! Rate & rank it now`}
        >
          <Sparkles className="w-3 h-3" />
          <span>Rank</span>
        </button>
      </div>
    </div>
  );
};

interface ForYouListProps {
  spots: ForYouSpot[];
  isFiltered: boolean;
  selectedCategory: SpotCategory;
  totalUnfilteredCount: number;
  /** Your ranked spots in this list (picks need some to go on). */
  rankedInCategory: number;
  isSignedIn: boolean;
  loaded: boolean;
  userLocation?: UserCoordinates | null;
  isSaved: (spot: ForYouSpot) => boolean;
  onSignIn: () => void;
  onToggleBookmark: (spot: ForYouSpot) => void;
  onRank: (spot: ForYouSpot) => void;
}

const EmptyState: React.FC<{ title: string; body: string; children?: React.ReactNode }> = ({ title, body, children }) => (
  <div className="py-16 px-6 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 space-y-4">
    <div className="flex justify-center">
      <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 dark:bg-emerald-500/15 flex items-center justify-center">
        <Sparkles className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
      </div>
    </div>
    <div className="space-y-1">
      <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">{title}</h2>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto">{body}</p>
    </div>
    {children}
  </div>
);

export const ForYouList: React.FC<ForYouListProps> = ({
  spots,
  isFiltered,
  selectedCategory,
  totalUnfilteredCount,
  rankedInCategory,
  isSignedIn,
  loaded,
  userLocation = null,
  isSaved,
  onSignIn,
  onToggleBookmark,
  onRank,
}) => {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const label = CATEGORY_LABEL[selectedCategory];

  // A new list or filter starts from the top again
  useEffect(() => {
    setVisible(PAGE_SIZE);
    setExpandedId(null);
  }, [selectedCategory, isFiltered]);

  if (!isSignedIn) {
    return (
      <EmptyState
        title="Picks for your taste"
        body="Sign in to see spots that people with your taste loved and you haven't been to yet."
      >
        <button
          type="button"
          onClick={onSignIn}
          className="px-4 py-2.5 rounded-full bg-zinc-900 hover:bg-zinc-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-zinc-950 font-semibold text-xs inline-flex items-center gap-1.5 transition-all"
        >
          <LogIn className="w-4 h-4" />
          <span>Sign in with Google</span>
        </button>
      </EmptyState>
    );
  }

  if (totalUnfilteredCount === 0) {
    if (!loaded) return <div className="py-16 text-center text-xs text-zinc-400">Loading your picks...</div>;
    return rankedInCategory < 3 ? (
      <EmptyState
        title={`Rank a few ${label} first`}
        body={`Picks come from people whose rankings agree with yours, so rank at least 3 ${label} to get them.`}
      />
    ) : (
      <EmptyState
        title={`No ${label} picks yet`}
        body={`They show up here as people with your taste rank ${
          hasLocation(selectedCategory) ? "spots you haven't been to" : "titles you haven't gotten to"
        }. Following friends helps too.`}
      />
    );
  }

  if (spots.length === 0 && isFiltered) {
    return (
      <div className="py-12 px-4 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">No picks match this filter.</p>
      </div>
    );
  }

  const shown = spots.slice(0, visible);
  return (
    <div className="space-y-2">
      <p className="px-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        Your predicted score for spots you haven't ranked, from friends you follow and people with your taste.
      </p>
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 divide-y divide-zinc-100 dark:divide-zinc-800/80 overflow-hidden shadow-2xs">
        {shown.map((item) => (
          <ForYouRow
            key={item.id}
            item={item}
            userLocation={userLocation}
            isSaved={isSaved(item)}
            expanded={expandedId === item.id}
            onToggleExpanded={() => setExpandedId((id) => (id === item.id ? null : item.id))}
            onToggleBookmark={onToggleBookmark}
            onRank={onRank}
          />
        ))}
      </div>
      {spots.length > visible && (
        <div className="text-center pt-1">
          <button
            type="button"
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
            className="px-4 py-2 rounded-full text-xs font-semibold text-zinc-600 dark:text-zinc-300 bg-zinc-200/60 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
          >
            Show more ({spots.length - visible} left)
          </button>
        </div>
      )}
    </div>
  );
};

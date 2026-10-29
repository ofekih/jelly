import React, { useEffect, useRef, useState } from 'react';
import { Bookmark, BookmarkCheck, ExternalLink, MapPin, Users } from 'lucide-react';
import {
  CATEGORY_EMOJI,
  CATEGORY_GROUP,
  CATEGORY_LABEL,
  PlaceCandidate,
  RestaurantEntry,
  SharedListPayload,
  SpotCategory,
} from '../types';
import { GROUP_COPY, spotPrice, wantLabel } from '../lib/groups';
import { gameFacts, hasSquareCover, posterUrl, spotLink, spotPlaceLabel } from '../lib/media';
import { findRankedInGroup } from '../lib/addFlow';
import { getFriendMatchesForSpot, getSpotSocialMetrics } from '../lib/friendsService';
import { placeStatKey } from '../lib/socialService';
import { usePlaceStats } from '../lib/usePlaceStats';
import { usePredictions } from '../lib/usePredictions';
import { usePresence } from '../lib/usePresence';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import { formatDistanceMiles, getItemDistanceMiles, UserCoordinates } from '../lib/geo';
import { BackIcon } from './PlatformIcons';
import { PosterThumb } from './PosterThumb';
import { ScoreBadge } from './ScoreBadge';

/** Matches `.animate-jelly-page-out` */
const EXIT_MS = 220;

export interface PlacePageProps {
  open: boolean;
  /** Anything place-like: a search result, a friend's spot, a For you pick (see `entryToCandidate`) */
  candidate: PlaceCandidate | null;
  /** The list it most likely belongs in: your status and the community scores are for this list */
  category: SpotCategory;
  myUid?: string | null;
  myRestaurants: RestaurantEntry[];
  friendLists?: SharedListPayload[];
  userLocation?: UserCoordinates | null;
  isBookmarked: boolean;
  onClose: () => void;
  /** "Been here – rank it" (or Re-rank when it's already in your list) */
  onRank?: () => void;
  /** Want to try / remove from want to try */
  onToggleBookmark?: () => void;
  /** Reviews for this spot in this list (filled in by the reviews feature) */
  renderReviews?: (placeId: string, category: SpotCategory) => React.ReactNode;
}

/**
 * A place or title on its own page, for looking it up without saying you've been: what it is,
 * where it is, whether it's in your lists, what friends and jelly think, and reviews. Pushed in
 * from the side like the profile page; Back returns to wherever it was opened from.
 */
export const PlacePage: React.FC<PlacePageProps> = (props) => {
  const { mounted, visible } = usePresence(props.open && Boolean(props.candidate), EXIT_MS);
  // Keep showing the last spot while the page slides out
  const [shown, setShown] = useState(props.candidate);
  if (props.candidate && props.candidate !== shown) setShown(props.candidate);
  if (!mounted || !shown) return null;
  return <PlaceScreen {...props} candidate={shown} visible={visible} />;
};

const PlaceScreen: React.FC<PlacePageProps & { candidate: PlaceCandidate; visible: boolean }> = ({
  visible,
  candidate,
  category,
  myUid = null,
  myRestaurants,
  friendLists = [],
  userLocation = null,
  isBookmarked,
  onClose,
  onRank,
  onToggleBookmark,
  renderReviews,
}) => {
  useBodyScrollLock();
  const group = CATEGORY_GROUP[category];
  const copy = GROUP_COPY[group];
  const isTitle = Boolean(candidate.media) || !copy.hasLocation;
  const [scrolled, setScrolled] = useState(false);

  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, []);

  const statKey = placeStatKey(candidate.placeId, category);
  const statFor = usePlaceStats(statKey ? [statKey] : []);
  const predictionFor = usePredictions();
  const spot = { ...candidate, category };
  const social = getSpotSocialMetrics(spot, {
    myUid,
    myRestaurants,
    friendLists,
    communityStat: statFor(statKey) ?? null,
    serverPrediction: predictionFor(spot),
  });
  const friendMatches = friendLists.length > 0 ? getFriendMatchesForSpot(candidate, friendLists) : [];
  const ranked = findRankedInGroup(candidate, category, myRestaurants);

  const price = spotPrice(candidate, category);
  const tags = candidate.cuisines.filter((t) => t !== candidate.primaryTypeDisplay);
  const where = isTitle ? spotPlaceLabel(candidate) : candidate.formattedAddress;
  const distance = isTitle ? null : formatDistanceMiles(getItemDistanceMiles(candidate, userLocation));
  const facts = gameFacts(candidate.media);
  const link = spotLink(candidate);
  const want = wantLabel(category);
  const hasSocial =
    social.friendsAvg !== null || social.communityAvg !== null || social.predictedScore !== null;

  return (
    <div
      data-group={group}
      role="dialog"
      aria-modal="true"
      aria-label={candidate.name}
      className={`fixed inset-0 z-50 flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 ${
        visible ? 'animate-jelly-page-in' : 'animate-jelly-page-out pointer-events-none'
      }`}
    >
      <div
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 40)}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
      >
        {/* Top bar: back, and the name once the header scrolls away */}
        <div
          className={`sticky top-0 z-10 pt-[env(safe-area-inset-top)] bg-zinc-50/85 dark:bg-zinc-950/85 backdrop-blur-xl border-b transition-colors ${
            scrolled ? 'border-zinc-900/10 dark:border-white/10' : 'border-transparent'
          }`}
        >
          <div className="max-w-xl mx-auto h-12 px-1.5 grid grid-cols-[3rem_1fr_3rem] items-center">
            <button
              ref={backRef}
              type="button"
              onClick={onClose}
              aria-label="Back"
              className="w-11 h-11 rounded-full flex items-center justify-center text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 active:scale-95 transition"
            >
              <BackIcon className="w-6 h-6" />
            </button>
            <h1
              className={`text-center text-[15px] font-bold truncate transition-opacity duration-200 ${
                scrolled ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {candidate.name}
            </h1>
          </div>
        </div>

        <div className="max-w-xl mx-auto px-4 pb-6 space-y-4">
          {/* Header */}
          <div className="flex items-start gap-4 pt-2">
            {isTitle ? (
              <PosterThumb
                src={posterUrl(candidate.media, 342)}
                square={hasSquareCover(candidate.placeId)}
                className="w-24 h-36 rounded-lg shadow-md"
              />
            ) : (
              <div
                aria-hidden="true"
                className="w-16 h-16 shrink-0 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-3xl"
              >
                {CATEGORY_EMOJI[category]}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                {CATEGORY_LABEL[category]}
              </p>
              <h2 className="text-2xl font-extrabold leading-tight mt-0.5 break-words">{candidate.name}</h2>
              {where && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 flex items-start gap-1">
                  {!isTitle && <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                  <span>
                    {where}
                    {distance && <span className="text-zinc-400"> · {distance}</span>}
                  </span>
                </p>
              )}
              {facts && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{facts}</p>}
            </div>
          </div>

          {/* Type, price, tags */}
          {(candidate.primaryTypeDisplay || price || tags.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {candidate.primaryTypeDisplay && <Chip strong>{candidate.primaryTypeDisplay}</Chip>}
              {price && <Chip strong>{price}</Chip>}
              {tags.slice(0, 6).map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </div>
          )}

          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {isTitle ? <ExternalLink className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
            Open in {link.site}
          </a>

          {/* Your status */}
          <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-3.5 flex items-center gap-3">
            {ranked ? (
              <>
                <ScoreBadge score={ranked.magicScore} size="md" />
                <div className="min-w-0">
                  <p className="text-sm font-bold">
                    #{ranked.rankIndex + 1} in your {CATEGORY_LABEL[ranked.category]}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">You ranked it {ranked.magicScore.toFixed(1)}</p>
                </div>
              </>
            ) : isBookmarked ? (
              <>
                <span className="w-11 h-11 shrink-0 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center">
                  <BookmarkCheck className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold">On your {want} list</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Rank it once you’ve tried it</p>
                </div>
              </>
            ) : (
              <>
                <span className="w-11 h-11 shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-400 flex items-center justify-center text-lg">
                  ?
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold">Not in your lists</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Just looking—nothing is saved until you choose</p>
                </div>
              </>
            )}
          </div>

          {/* What friends and jelly think */}
          {hasSocial && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <ScoreTile
                label="Friends"
                value={social.friendsAvg !== null ? social.friendsAvg.toFixed(1) : '—'}
                sub={
                  social.friendsCount > 0
                    ? `${social.friendsCount} ${social.friendsCount === 1 ? 'friend' : 'friends'}`
                    : 'None yet'
                }
              />
              <ScoreTile
                label="jelly avg"
                value={social.communityAvg !== null ? social.communityAvg.toFixed(1) : '—'}
                sub={
                  social.communityCount > 0
                    ? `${social.communityCount} ${social.communityCount === 1 ? 'person' : 'people'}`
                    : 'None yet'
                }
              />
              <ScoreTile
                accent
                label="For you"
                value={social.predictedScore !== null ? `~${social.predictedScore.toFixed(1)}` : '—'}
                sub="Predicted"
              />
            </div>
          )}
          {social.predictionBasis && social.predictedScore !== null && (
            <p className="-mt-2 text-[11px] text-zinc-500 dark:text-zinc-400 text-center">{social.predictionBasis}</p>
          )}

          {friendMatches.length > 0 && (
            <section className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-3.5">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                <Users className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                Friends ({friendMatches.length})
              </h3>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                {friendMatches.map((fm) => (
                  <li key={fm.friendUid} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{fm.friendName}</p>
                        <p className="text-[11px] text-zinc-400">
                          {fm.status === 'ranked' && fm.rankIndex !== undefined
                            ? `#${fm.rankIndex + 1} in ${CATEGORY_LABEL[fm.category]}`
                            : `${wantLabel(fm.category)} · ${CATEGORY_LABEL[fm.category]}`}
                        </p>
                      </div>
                      {fm.status === 'ranked' && fm.magicScore !== undefined ? (
                        <ScoreBadge score={fm.magicScore} size="sm" />
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-500 text-[10px] font-semibold">
                          Saved
                        </span>
                      )}
                    </div>
                    {fm.notes && (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 italic whitespace-pre-wrap">
                        &ldquo;{fm.notes}&rdquo;
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {renderReviews && candidate.placeId && renderReviews(candidate.placeId, category)}
        </div>
      </div>

      {/* Actions */}
      {(onRank || onToggleBookmark) && (
        <div className="shrink-0 border-t border-zinc-900/10 dark:border-white/10 bg-zinc-50/90 dark:bg-zinc-950/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
          <div className="max-w-xl mx-auto px-4 py-3 flex gap-2">
            {onToggleBookmark && !ranked && (
              <button
                type="button"
                onClick={onToggleBookmark}
                aria-pressed={isBookmarked}
                className={`h-12 px-4 rounded-2xl text-sm font-semibold flex items-center justify-center gap-1.5 border transition-colors active:scale-[0.98] ${
                  isBookmarked
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300'
                    : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200'
                } ${onRank ? 'flex-1' : 'w-full'}`}
              >
                <Bookmark className={`w-4 h-4 ${isBookmarked ? 'fill-rose-500 text-rose-500' : ''}`} />
                <span className="truncate">{isBookmarked ? `Remove from ${want}` : want}</span>
              </button>
            )}
            {onRank && (
              <button
                type="button"
                onClick={onRank}
                className="flex-[1.4] h-12 px-4 rounded-2xl text-sm font-bold bg-emerald-500 hover:bg-emerald-600 dark:hover:bg-emerald-400 text-white dark:text-zinc-950 shadow-sm active:scale-[0.98] transition"
              >
                {ranked ? 'Rank again' : `${copy.done} – rank it`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const Chip: React.FC<{ strong?: boolean; children: React.ReactNode }> = ({ strong, children }) => (
  <span
    className={`px-2.5 py-1 rounded-lg text-xs ${
      strong
        ? 'bg-zinc-200/70 dark:bg-zinc-800 font-semibold text-zinc-700 dark:text-zinc-200'
        : 'bg-zinc-100 dark:bg-zinc-900 font-medium text-zinc-600 dark:text-zinc-300'
    }`}
  >
    {children}
  </span>
);

const ScoreTile: React.FC<{ label: string; value: string; sub: string; accent?: boolean }> = ({
  label,
  value,
  sub,
  accent,
}) => (
  <div
    className={`rounded-2xl p-2.5 border ${
      accent
        ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-300'
        : 'bg-white dark:bg-zinc-900 border-zinc-200/80 dark:border-zinc-800'
    }`}
  >
    <div className={`text-[10px] font-semibold uppercase tracking-wider ${accent ? '' : 'text-zinc-400'}`}>{label}</div>
    <div className="text-lg font-extrabold tabular-nums mt-0.5">{value}</div>
    <div className={`text-[10px] ${accent ? 'opacity-80' : 'text-zinc-400'}`}>{sub}</div>
  </div>
);

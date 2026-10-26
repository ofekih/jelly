import React, { useMemo, useState } from 'react';
import { MessageSquareText, Pencil, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import { db, trackEvent } from '../firebase';
import { SpotCategory } from '../types';
import {
  cleanReviewText,
  deleteMyReview,
  formatReviewDate,
  PlaceReview,
  reviewKey,
  ReviewAuthor,
  ReviewVote,
  saveMyReview,
  setCachedMyReview,
  sortReviews,
  voteOnReview,
} from '../lib/reviews';
import { usePlaceReviews } from '../lib/usePlaceReviews';
import { Avatar } from './Avatar';
import { ScoreBadge } from './ScoreBadge';
import { ConfirmModal } from './ConfirmModal';
import { ReviewComposer } from './ReviewComposer';

export interface ReviewViewer {
  uid: string;
  name?: string | null;
  handle?: string | null;
  photoURL?: string | null;
}

interface PlaceReviewsProps {
  placeId: string | undefined;
  category: SpotCategory;
  /** Spot name for the "public" note */
  spotName?: string;
  /** Signed-in viewer, or null */
  viewer?: ReviewViewer | null;
  /**
   * The viewer's stored score for this spot in this list, when they have it ranked under the
   * review key: lets them write or edit their review (the rules require it).
   */
  myScore?: number;
  /** People the viewer follows: marked "Friend" and listed right after the viewer's own */
  friendIds?: string[];
  className?: string;
}

const CLAMP_CHARS = 280;

/**
 * Public reviews of one spot in one list, newest first (yours, then friends'). Ready for any sheet
 * or page: the spot sheet uses it, and so can a place page.
 */
export const PlaceReviews: React.FC<PlaceReviewsProps> = ({
  placeId,
  category,
  spotName = 'this spot',
  viewer = null,
  myScore,
  friendIds = [],
  className = '',
}) => {
  const key = reviewKey(placeId, category);
  const myUid = viewer?.uid ?? null;
  const { reviews, failed, author, myVote } = usePlaceReviews(key, myUid);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const friendSet = useMemo(() => new Set(friendIds), [friendIds]);
  const sorted = useMemo(() => (reviews ? sortReviews(reviews, myUid, friendSet) : []), [reviews, myUid, friendSet]);
  const mine = sorted.find((r) => r.uid === myUid) ?? null;
  const canWrite = Boolean(key && viewer && typeof myScore === 'number');

  if (!key) return null;

  const viewerAuthor = (): ReviewAuthor | undefined =>
    viewer ? { name: viewer.name || 'You', handle: viewer.handle || undefined, photoURL: viewer.photoURL || undefined } : undefined;

  const startEditing = () => {
    setDraft(mine?.text ?? '');
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    if (!viewer || typeof myScore !== 'number' || !cleanReviewText(draft)) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveMyReview(db, key, viewer.uid, draft, myScore, Boolean(mine));
      setCachedMyReview(key, viewer.uid, { ...saved, createdAt: mine?.createdAt ?? saved.createdAt }, viewerAuthor());
      trackEvent(mine ? 'edit_review' : 'post_review', { category, length: saved.text.length, from: 'spot_sheet' });
      setEditing(false);
    } catch (err) {
      console.error('Failed to save review:', err);
      setError('Couldn’t save your review – check your connection and try again');
    } finally {
      setSaving(false);
    }
  };

  const vote = (authorUid: string, value: ReviewVote) => {
    if (!viewer) return;
    const next = myVote(authorUid) === value ? 0 : value;
    setError(null);
    voteOnReview(db, key, authorUid, viewer.uid, next)
      .then(() => trackEvent('vote_review', { category, vote: next }))
      .catch((err) => {
        console.error('Failed to vote on review:', err);
        setError('Couldn’t save your vote – try again');
      });
  };

  const remove = async () => {
    setConfirmDelete(false);
    if (!viewer) return;
    try {
      await deleteMyReview(db, key, viewer.uid);
      setCachedMyReview(key, viewer.uid, null);
      trackEvent('delete_review', { category });
    } catch (err) {
      console.error('Failed to delete review:', err);
      setError('Couldn’t delete your review – try again');
    }
  };

  return (
    <section className={`space-y-2.5 ${className}`} aria-label="Reviews">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          <MessageSquareText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>Reviews{reviews && reviews.length > 0 ? ` (${reviews.length})` : ''}</span>
        </h3>
      </div>

      {editing && (
        <div className="space-y-2 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 p-3">
          <ReviewComposer value={draft} onChange={setDraft} spotName={spotName} rows={4} autoFocus />
          {error && <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-3.5 py-2 rounded-xl text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !cleanReviewText(draft)}
              className="px-4 py-2 rounded-xl bg-zinc-900 dark:bg-emerald-500 text-white dark:text-zinc-950 text-xs font-semibold disabled:opacity-40"
            >
              {saving ? 'Saving…' : mine ? 'Save' : 'Post'}
            </button>
          </div>
        </div>
      )}

      {!editing && canWrite && !mine && reviews && (
        <button
          type="button"
          onClick={startEditing}
          className="w-full py-2.5 px-3.5 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-left flex items-center gap-2 transition-colors"
        >
          <Pencil className="w-3.5 h-3.5 shrink-0" />
          <span>Write a public review</span>
        </button>
      )}

      {!reviews ? (
        failed ? (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 py-2">Couldn’t load reviews right now</p>
        ) : (
          <ReviewSkeleton />
        )
      ) : sorted.length === 0 ? (
        !editing && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 py-1">
            No reviews yet{canWrite ? '' : ` – reviews come from people who rank ${spotName}`}
          </p>
        )
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
          {sorted.map((review) =>
            review.uid === myUid && editing ? null : (
              <ReviewRow
                key={review.uid}
                review={review}
                author={review.uid === myUid ? viewerAuthor() ?? author(review.uid) : author(review.uid)}
                isMine={review.uid === myUid}
                isFriend={friendSet.has(review.uid)}
                vote={myVote(review.uid)}
                onVote={viewer && review.uid !== myUid ? (value) => vote(review.uid, value) : undefined}
                onEdit={review.uid === myUid && canWrite ? startEditing : undefined}
                onDelete={review.uid === myUid ? () => setConfirmDelete(true) : undefined}
              />
            )
          )}
        </ul>
      )}
      {!editing && error && <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}

      <ConfirmModal
        isOpen={confirmDelete}
        title="Delete your review?"
        message={`Your review of ${spotName} will be removed for everyone. Your ranking stays.`}
        confirmLabel="Delete Review"
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </section>
  );
};

const ReviewRow: React.FC<{
  review: PlaceReview;
  author: ReviewAuthor | null | undefined;
  isMine: boolean;
  isFriend: boolean;
  /** The viewer's vote on it */
  vote: ReviewVote;
  /** Unset on your own review, and when signed out (counts still show) */
  onVote?: (value: 1 | -1) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}> = ({ review, author, isMine, isFriend, vote, onVote, onEdit, onDelete }) => {
  const [expanded, setExpanded] = useState(false);
  const long = review.text.length > CLAMP_CHARS || review.text.split('\n').length > 5;
  const name = author?.name || 'jelly member';

  return (
    <li className="py-3 first:pt-1 last:pb-0" data-testid="place-review">
      <div className="flex items-start gap-2.5">
        <Avatar photoURL={author?.photoURL} name={name} size={32} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  {isMine ? 'You' : name}
                </span>
                {isFriend && !isMine && (
                  <span className="px-1.5 py-px rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold shrink-0">
                    Friend
                  </span>
                )}
              </div>
              <div className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate">
                {author?.handle && !isMine ? `@${author.handle} · ` : ''}
                {formatReviewDate(review.updatedAt)}
                {review.updatedAt - review.createdAt > 60_000 ? ' · edited' : ''}
              </div>
            </div>
            <ScoreBadge score={review.score} size="sm" />
          </div>
          <p
            className={`mt-1.5 text-[13px] text-zinc-700 dark:text-zinc-200 leading-relaxed whitespace-pre-wrap break-words ${
              long && !expanded ? 'line-clamp-5' : ''
            }`}
          >
            {review.text}
          </p>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"
            >
              {expanded ? 'Less' : 'More'}
            </button>
          )}
          <div className="mt-1.5 flex items-center gap-1 -ml-2">
            <VoteButton kind="up" count={review.up} active={vote === 1} isMine={isMine} onClick={onVote && (() => onVote(1))} />
            <VoteButton kind="down" count={review.down} active={vote === -1} isMine={isMine} onClick={onVote && (() => onVote(-1))} />
            {(onEdit || onDelete) && <span className="w-px h-4 mx-1 bg-zinc-200 dark:bg-zinc-800" aria-hidden="true" />}
              {onEdit && (
                <button
                  type="button"
                  onClick={onEdit}
                  className="px-2 py-1 rounded-lg text-[11px] font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-1"
                >
                  <Pencil className="w-3 h-3" />
                  Edit
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="px-2 py-1 rounded-lg text-[11px] font-medium text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
              )}
          </div>
        </div>
      </div>
    </li>
  );
};

/** Thumbs up / down with its count: a toggle for others' reviews, just the count on yours or signed out. */
const VoteButton: React.FC<{ kind: 'up' | 'down'; count: number; active: boolean; isMine: boolean; onClick?: () => void }> = ({
  kind,
  count,
  active,
  isMine,
  onClick,
}) => {
  const Icon = kind === 'up' ? ThumbsUp : ThumbsDown;
  const word = kind === 'up' ? 'Helpful' : 'Not helpful';
  const label = `${word}${count > 0 ? ` (${count})` : ''}`;
  const activeClass =
    kind === 'up'
      ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10'
      : 'text-rose-600 dark:text-rose-400 bg-rose-500/10';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-pressed={onClick ? active : undefined}
      aria-label={label}
      title={onClick ? word : isMine ? `${word} votes on your review` : 'Sign in to vote'}
      data-testid={`review-vote-${kind}`}
      className={`min-w-11 h-8 px-2 rounded-lg text-[11px] font-semibold tabular-nums flex items-center justify-center gap-1 transition-colors disabled:cursor-default ${
        active
          ? activeClass
          : `text-zinc-400 dark:text-zinc-500 ${onClick ? 'hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-95' : ''}`
      }`}
    >
      <Icon className={`w-3.5 h-3.5 ${active ? 'fill-current/20' : ''}`} aria-hidden="true" />
      {count > 0 && <span>{count}</span>}
    </button>
  );
};

const ReviewSkeleton: React.FC = () => (
  <div className="space-y-3 py-1" aria-hidden="true" data-testid="reviews-loading">
    {[0, 1].map((i) => (
      <div key={i} className="flex items-start gap-2.5 animate-pulse">
        <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-800" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-2.5 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-2.5 w-full rounded bg-zinc-100 dark:bg-zinc-800/70" />
          <div className="h-2.5 w-2/3 rounded bg-zinc-100 dark:bg-zinc-800/70" />
        </div>
      </div>
    ))}
  </div>
);

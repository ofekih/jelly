import React, { useEffect, useState } from 'react';
import { CATEGORY_LABEL, RestaurantEntry } from '../types';
import { cleanReviewText } from '../lib/reviews';
import { hasSquareCover, posterUrl } from '../lib/media';
import { CloseButton, Sheet } from './Sheet';
import { ScoreBadge } from './ScoreBadge';
import { PosterThumb } from './PosterThumb';
import { ReviewComposer } from './ReviewComposer';

interface ReviewPromptSheetProps {
  /** The spot that was just ranked (with its new score) */
  entry: RestaurantEntry;
  /** 1-based rank in its list */
  position: number;
  /** Your earlier review of it: undefined while loading, null when there is none */
  existingText: string | null | undefined;
  /** The earlier review is live at this spot (false: a draft carried over from another list) */
  alreadyPosted?: boolean;
  /** Saves the review; rejects on failure */
  onPost: (text: string) => Promise<void>;
  onSkip: () => void;
}

/**
 * The optional step after a side-by-side: the spot's new rank and score, and a public review box
 * with Post and Skip. Nothing is focused until tapped, so the iPhone keyboard stays down.
 */
export const ReviewPromptSheet: React.FC<ReviewPromptSheetProps> = ({
  entry,
  position,
  existingText,
  alreadyPosted = true,
  onPost,
  onSkip,
}) => {
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill a review written earlier, unless they've started typing already
  useEffect(() => {
    if (existingText && !touched) setText(existingText);
  }, [existingText, touched]);

  const editing = Boolean(existingText) && alreadyPosted;
  const unchanged = editing && text.trim() === existingText?.trim();
  const canPost = Boolean(cleanReviewText(text)) && !posting;

  const post = async () => {
    if (!canPost) return;
    if (unchanged) {
      onSkip();
      return;
    }
    setPosting(true);
    setError(null);
    try {
      await onPost(text);
    } catch {
      setError('Couldn’t post your review – check your connection and try again');
      setPosting(false);
    }
  };

  return (
    <Sheet onClose={onSkip} maxWidthClassName="max-w-md" maxHeightClassName="max-h-[92vh]">
      {(scrollContainerRef) => (
        <div ref={scrollContainerRef} className="px-5 pt-3 sm:pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] overflow-y-auto space-y-4" data-testid="review-prompt">
          <div className="flex items-start gap-3">
            {entry.media && (
              <PosterThumb src={posterUrl(entry.media, 154)} square={hasSquareCover(entry.placeId)} className="w-11 h-[66px] shadow-sm" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Ranked #{position} in{' '}
                <span className="text-emerald-600 dark:text-emerald-400">{CATEGORY_LABEL[entry.category]}</span>
              </div>
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 leading-snug mt-0.5 break-words">{entry.name}</h2>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ScoreBadge score={entry.magicScore} size="md" />
              <CloseButton onClick={onSkip} className="" iconClassName="w-5 h-5" />
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
              {editing ? 'Update your review?' : 'Leave a review?'}
            </h3>
            <ReviewComposer
              value={text}
              onChange={(t) => {
                setTouched(true);
                setText(t);
              }}
              spotName={entry.name}
              rows={6}
            />
            {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={onSkip}
              className="py-3 rounded-2xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100 font-semibold text-sm transition-colors"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={post}
              disabled={!canPost}
              className="py-3 rounded-2xl bg-zinc-900 hover:bg-zinc-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-zinc-950 font-semibold text-sm transition-colors disabled:opacity-40"
            >
              {posting ? 'Posting…' : editing ? 'Update' : 'Post'}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
};

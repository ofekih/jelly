import React from 'react';
import { Globe } from 'lucide-react';
import { REVIEW_MAX_LENGTH } from '../lib/reviews';

interface ReviewComposerProps {
  value: string;
  onChange: (text: string) => void;
  spotName: string;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
}

/**
 * The review text box and its "this is public" note, shared by the review step after ranking and
 * editing a review in `PlaceReviews`. 16px text on phones so iOS doesn't zoom in on focus.
 */
export const ReviewComposer: React.FC<ReviewComposerProps> = ({
  value,
  onChange,
  spotName,
  placeholder = 'What stood out? What would you tell a friend?',
  rows = 5,
  autoFocus = false,
}) => {
  const left = REVIEW_MAX_LENGTH - value.length;
  return (
    <div className="space-y-1.5">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, REVIEW_MAX_LENGTH))}
        rows={rows}
        maxLength={REVIEW_MAX_LENGTH}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={`Review of ${spotName}`}
        className="w-full px-3.5 py-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700 text-base sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 leading-relaxed resize-none focus:outline-none focus:border-emerald-500 focus:bg-white dark:focus:bg-zinc-900 transition-colors"
      />
      <div className="flex items-start justify-between gap-3 text-[11px] text-zinc-400 dark:text-zinc-500">
        <p className="flex items-start gap-1.5 leading-snug">
          <Globe className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>Public – shown with your name to anyone who looks up {spotName} on jelly</span>
        </p>
        {left <= 200 && <span className="tabular-nums shrink-0">{left}</span>}
      </div>
    </div>
  );
};

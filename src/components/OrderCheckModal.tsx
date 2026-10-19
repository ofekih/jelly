import React, { useEffect, useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { RestaurantEntry } from '../types';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import {
  CheckOutcome,
  countSpotsToCheck,
  findOrderConflicts,
  OrderConflict,
  pickCheck,
} from '../lib/comparisonHistory';

interface OrderCheckModalProps {
  isOpen: boolean;
  list: RestaurantEntry[]; // One category list, rank-ordered (updates after every answer)
  onAnswer: (conflict: OrderConflict, outcome: CheckOutcome) => void;
  onClose: () => void;
}

/** Asks about pairs whose order disagrees with your earlier answers, one at a time */
export const OrderCheckModal: React.FC<OrderCheckModalProps> = ({ isOpen, list, onAnswer, onClose }) => {
  useBodyScrollLock(isOpen);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [answered, setAnswered] = useState(0);
  const [lastMove, setLastMove] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSkipped(new Set());
    setAnswered(0);
    setLastMove(null);
  }, [isOpen]);

  const conflicts = useMemo(
    () =>
      isOpen
        ? findOrderConflicts(list).filter((c) => !skipped.has(`${c.above.id}|${c.below.id}`))
        : [],
    [isOpen, list, skipped]
  );
  const current = pickCheck(conflicts);
  const remaining = countSpotsToCheck(conflicts);

  const answer = (outcome: CheckOutcome) => {
    if (!current) return;
    setAnswered((n) => n + 1);
    setLastMove(outcome === 'below_wins' ? `${current.below.name} now ranks above ${current.above.name}` : null);
    onAnswer(current, outcome);
  };

  const skip = () => {
    if (!current) return;
    setSkipped((prev) => new Set(prev).add(`${current.above.id}|${current.below.id}`));
    setLastMove(null);
  };

  useEffect(() => {
    if (!isOpen || !current) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') answer('above_wins');
      else if (e.key === 'ArrowRight') answer('below_wins');
      else if (e.key === 'ArrowDown') answer('tie');
      else if (e.key === ' ') skip();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!isOpen) return null;

  const card = (entry: RestaurantEntry, outcome: CheckOutcome, align: 'left' | 'right') => (
    <button
      type="button"
      onClick={() => answer(outcome)}
      className="group text-left p-5 rounded-2xl border-2 border-zinc-200/90 dark:border-zinc-800 hover:border-emerald-500 dark:hover:border-emerald-400 bg-zinc-50/50 dark:bg-zinc-800/40 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/20 transition-all flex flex-col justify-between min-h-[120px] sm:min-h-[150px] active:scale-[0.99]"
    >
      <div className="space-y-1.5">
        <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          {[entry.cuisines[0], `#${entry.rankIndex + 1} · ${entry.magicScore.toFixed(1)}`].filter(Boolean).join(' · ')}
        </span>
        <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 leading-snug group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
          {entry.name}
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-1">
          {entry.neighborhood || entry.city || entry.formattedAddress}
        </p>
      </div>
      <div
        className={`pt-3 text-xs font-semibold text-zinc-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors ${
          align === 'right' ? 'sm:text-right' : ''
        }`}
      >
        {align === 'left' ? 'Tap to pick ←' : 'Tap to pick →'}
      </div>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-xs p-0 sm:p-4 animate-jelly-backdrop">
      <div className="w-full max-w-xl bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800 overflow-hidden flex flex-col animate-jelly-sheet sm:animate-jelly-dialog overscroll-contain">
        <div className="px-5 pt-4 pb-1 flex items-center justify-between">
          <span className="w-8" />
          <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
            {current ? 'Which do you prefer?' : 'Order check'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 -mr-1.5 rounded-full text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {current ? (
          <div className="p-5 pt-2 space-y-4">
            <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
              Your earlier picks suggest the lower one might be better.{' '}
              {remaining > 1 ? `About ${remaining} spots to check.` : ''}
            </p>
            {lastMove && (
              <p className="text-center text-xs font-medium text-emerald-600 dark:text-emerald-400">{lastMove}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {card(current.above, 'above_wins', 'left')}
              {card(current.below, 'below_wins', 'right')}
            </div>
            <div className="flex items-center justify-center gap-6 pt-1 text-xs font-medium text-zinc-400 dark:text-zinc-500">
              <button
                type="button"
                onClick={() => answer('tie')}
                className="hover:text-zinc-800 dark:hover:text-zinc-200 py-1 px-2 rounded-lg transition-colors"
              >
                Too tough to call
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={skip}
                className="hover:text-zinc-800 dark:hover:text-zinc-200 py-1 px-2 rounded-lg transition-colors"
              >
                Skip
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 pt-3 text-center space-y-4">
            <div className="mx-auto w-11 h-11 rounded-full bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center">
              <Check className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="font-bold text-zinc-900 dark:text-zinc-100">All set</p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {lastMove ? `${lastMove}. ` : ''}
                {skipped.size > 0
                  ? 'jelly will bring up the skipped ones again later.'
                  : answered > 0
                  ? 'Your order and your answers agree now.'
                  : 'Nothing left to check right now.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-full bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

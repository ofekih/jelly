import React from 'react';
import { X } from 'lucide-react';
import { daysSince, type BeliImportStatus } from '../../lib/beliImportUi';

/** "Coming from Beli?" on a (nearly) empty Eat list; "Waiting on Beli" once they've asked */
export const BeliEntryCard: React.FC<{
  status: BeliImportStatus;
  onImport: () => void;
  onAsk: () => void;
  onDismiss: () => void;
}> = ({ status, onImport, onAsk, onDismiss }) => {
  const asked = status.askedAt !== undefined;
  const days = asked ? daysSince(status.askedAt!) : 0;
  return (
    <section
      aria-label="Import from Beli"
      className="relative rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/40 dark:to-zinc-900 p-4 flex flex-col gap-2.5"
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Hide this for good"
        title="Hide this for good"
        className="absolute top-2 right-2 w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
      >
        <X className="w-4 h-4" />
      </button>
      <h3 className="text-base font-bold pr-8 text-zinc-900 dark:text-zinc-100">
        {asked ? 'Got your Beli file?' : 'Coming from Beli? Bring your rankings.'}
      </h3>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {asked
          ? `You asked Beli ${days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}. It usually takes about 3 weeks. When the zip arrives, open it here.`
          : 'Your restaurants, cafés, bakeries, dessert spots and bars, in your order, plus your want-to-try list. Finding the places is automatic; then you rate as many as you like.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onImport}
          className="min-h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold"
        >
          {asked ? 'Choose the file' : 'Import from Beli'}
        </button>
        {!asked && (
          <button type="button" onClick={onAsk} className="min-h-10 px-2 text-sm font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100">
            I need to ask Beli first
          </button>
        )}
      </div>
    </section>
  );
};

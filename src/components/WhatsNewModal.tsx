import React from 'react';
import { Sparkles } from 'lucide-react';
import { CHANGELOG, displayVersion, formatReleaseDate } from '../lib/changelog';
import { Sheet, SheetHeader } from './Sheet';

interface WhatsNewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Release notes, newest first (from `lib/changelog`). */
export const WhatsNewModal: React.FC<WhatsNewModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <Sheet onClose={onClose} maxWidthClassName="max-w-md" maxHeightClassName="max-h-[85vh]">
      {(scrollContainerRef) => (
        <>
          <SheetHeader
            icon={<Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
            title="What’s new in jelly"
            onClose={onClose}
          />

          <div ref={scrollContainerRef} className="px-5 py-4 overflow-y-auto flex-1 space-y-5">
            {CHANGELOG.map((entry, i) => (
              <section key={entry.version} className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span
                      className={`shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums ${
                        i === 0
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      v{displayVersion(entry.version)}
                    </span>
                    <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100 truncate">{entry.title}</h3>
                  </div>
                  <time dateTime={entry.date} className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">
                    {formatReleaseDate(entry.date)}
                  </time>
                </div>
                <ul className="space-y-1.5 pl-1">
                  {entry.highlights.map((line) => (
                    <li key={line} className="flex gap-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                      <span className="mt-[7px] w-1 h-1 rounded-full bg-emerald-500 shrink-0" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
};

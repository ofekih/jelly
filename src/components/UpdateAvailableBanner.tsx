import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { checkForUpdate } from '../lib/appVersion';

const CHECK_INTERVAL_MS = 10 * 60 * 1000;

/** Polls `/version.json` on resume and every 10 minutes; stops once an update is found. */
function useUpdateAvailable(): boolean {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (updateAvailable) return;
    let cancelled = false;

    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      if (await checkForUpdate()) {
        if (!cancelled) setUpdateAvailable(true);
      }
    };

    void check();
    const interval = window.setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', check);
    };
  }, [updateAvailable]);

  return updateAvailable;
}

export const UpdateAvailableBanner: React.FC = () => {
  const updateAvailable = useUpdateAvailable();
  if (!updateAvailable) return null;

  return (
    <div
      role="status"
      className="fixed top-[calc(env(safe-area-inset-top)+0.75rem)] left-1/2 -translate-x-1/2 z-50 animate-jelly-dialog"
    >
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="pl-3 pr-1.5 py-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold shadow-xl flex items-center gap-2.5 whitespace-nowrap active:scale-[0.98] transition-transform"
      >
        <span>New version of jelly available</span>
        <span className="px-2.5 py-0.5 rounded-full bg-emerald-500 text-zinc-950 font-bold flex items-center gap-1">
          <RefreshCw className="w-3 h-3" />
          Update
        </span>
      </button>
    </div>
  );
};

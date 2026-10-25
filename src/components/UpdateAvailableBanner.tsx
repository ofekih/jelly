import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { checkForUpdate } from '../lib/appVersion';
import { NOTICE_ACTION, NOTICE_BOTTOM, NOTICE_SURFACE } from './Toast';

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const DISMISSED_KEY = 'jelly-update-notice-dismissed';
const GAP_PX = 8;

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

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * New deploy detected: a quiet card at the bottom (clear of the header, which hides on scroll)
 * with a one-tap reload. Toasts stack above it via `--jelly-update-notice`. Dismissing it hides
 * it for the rest of the session.
 */
export const UpdateAvailableBanner: React.FC = () => {
  const updateAvailable = useUpdateAvailable();
  const [dismissed, setDismissed] = useState(readDismissed);
  const cardRef = useRef<HTMLDivElement>(null);
  const visible = updateAvailable && !dismissed;

  // Lift toasts above the card while it is up
  useEffect(() => {
    const card = cardRef.current;
    if (!visible || !card) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty('--jelly-update-notice', `${card.offsetHeight + GAP_PX}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(card);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--jelly-update-notice');
    };
  }, [visible]);

  if (!visible) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private mode: hidden until the next load only
    }
    setDismissed(true);
  };

  return (
    <div className="fixed inset-x-0 z-[75] flex justify-center px-3 pointer-events-none" style={{ bottom: NOTICE_BOTTOM }}>
      <div
        ref={cardRef}
        role="status"
        className={`pointer-events-auto flex w-full max-w-[28rem] items-center gap-3 py-2 pl-2.5 pr-1 min-h-14 animate-jelly-toast-in ${NOTICE_SURFACE}`}
      >
        <span className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-emerald-400/15 text-emerald-300">
          <Sparkles className="w-[18px] h-[18px]" strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-snug">A new version is ready</p>
          <p className="text-xs leading-snug text-white/60">Reload to get the latest jelly</p>
        </div>
        <button type="button" onClick={() => window.location.reload()} className={NOTICE_ACTION}>
          Reload
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Not now"
          title="Not now"
          className="shrink-0 w-11 h-11 -my-1.5 -ml-1 rounded-xl flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 active:bg-white/15 transition-colors"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Download, PlusSquare, Share, Sparkles, X } from 'lucide-react';
import {
  dismissPwaNudge,
  getInstallPrompt,
  isIosDevice,
  isIosSafari,
  isMobileDevice,
  isPwaNudgeDismissed,
  isRunningAsPwa,
  promptInstall,
  recordPwaInstalled,
  subscribeInstallPrompt,
} from '../lib/pwaService';

export const PwaInstallBanner: React.FC = () => {
  const [isDue, setIsDue] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  // Captured in main.tsx before React mounts, since browsers fire it once, early
  const installPrompt = useSyncExternalStore(subscribeInstallPrompt, getInstallPrompt);
  const [ios] = useState(() => (isIosDevice() ? (isIosSafari() ? 'safari' : 'other') : null));
  const [isMobile] = useState(() => isMobileDevice() || isIosDevice());

  useEffect(() => {
    if (isRunningAsPwa() || isPwaNudgeDismissed()) return;
    // Subtle 2.5s delay after page load before sliding up
    const timer = setTimeout(() => {
      if (!isRunningAsPwa() && !isPwaNudgeDismissed()) setIsDue(true);
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  // Phones always get the nudge (with steps if there's no install dialog); desktops only when
  // Chrome/Edge offer one-click install
  if (!isDue || isHidden || !(isMobile || installPrompt)) return null;

  const handleDismiss = () => {
    dismissPwaNudge();
    setIsHidden(true);
  };

  const handleInstallClick = async () => {
    if (!installPrompt) {
      setShowGuide((prev) => !prev);
      return;
    }
    try {
      if (await promptInstall()) {
        recordPwaInstalled();
        setIsHidden(true);
      } else {
        handleDismiss();
      }
    } catch {
      handleDismiss();
    }
  };

  return (
    <aside
      role="region"
      aria-label="Install jelly app"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm z-40 animate-jelly-sheet"
    >
      <div className="bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md rounded-2xl p-4 shadow-2xl border border-zinc-200/90 dark:border-zinc-800 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/jelly-icon-192.png"
              alt="jelly app icon"
              className="w-11 h-11 rounded-xl shadow-xs shrink-0 object-cover border border-zinc-200/50 dark:border-zinc-700/50"
            />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100 tracking-tight">
                  Install jelly
                </span>
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Sparkles className="w-2.5 h-2.5" />
                  App
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-snug mt-0.5">
                {isMobile
                  ? 'Add to your home screen for instant rankings & full-screen view.'
                  : 'Open jelly in its own window, one click from your dock or taskbar.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            className="p-1.5 -mr-1 -mt-1 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Dismiss install banner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step-by-step instructions where the browser has no install dialog (iOS, Firefox) */}
        {showGuide && (
          <div className="mt-1 p-3 bg-zinc-50 dark:bg-zinc-800/70 rounded-xl border border-zinc-200/60 dark:border-zinc-700/60 text-xs text-zinc-700 dark:text-zinc-300 space-y-2 animate-in fade-in duration-200">
            {ios === 'safari' ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-bold flex items-center justify-center text-[11px] shrink-0">
                    1
                  </span>
                  <span>
                    Tap the <strong className="font-semibold text-zinc-900 dark:text-zinc-100">Share</strong> button{' '}
                    <Share className="w-3.5 h-3.5 inline mx-0.5 text-sky-500" /> in Safari's toolbar.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-bold flex items-center justify-center text-[11px] shrink-0">
                    2
                  </span>
                  <span>
                    Scroll down and tap <strong className="font-semibold text-zinc-900 dark:text-zinc-100">Add to Home Screen</strong>{' '}
                    <PlusSquare className="w-3.5 h-3.5 inline mx-0.5 text-emerald-500" />.
                  </span>
                </div>
              </>
            ) : ios === 'other' ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-bold flex items-center justify-center text-[11px] shrink-0">
                    1
                  </span>
                  <span>
                    Tap <strong className="font-semibold text-zinc-900 dark:text-zinc-100">Share</strong>{' '}
                    <Share className="w-3.5 h-3.5 inline mx-0.5 text-sky-500" />—in the address bar, or in the browser's menu.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-bold flex items-center justify-center text-[11px] shrink-0">
                    2
                  </span>
                  <span>
                    Scroll down and tap <strong className="font-semibold text-zinc-900 dark:text-zinc-100">Add to Home Screen</strong>{' '}
                    <PlusSquare className="w-3.5 h-3.5 inline mx-0.5 text-emerald-500" />.
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-bold flex items-center justify-center text-[11px] shrink-0">
                    1
                  </span>
                  <span>
                    Tap the browser menu <strong className="font-semibold text-zinc-900 dark:text-zinc-100">⋮</strong> (three dots) in the top or bottom bar.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-bold flex items-center justify-center text-[11px] shrink-0">
                    2
                  </span>
                  <span>
                    Select <strong className="font-semibold text-zinc-900 dark:text-zinc-100">Install app</strong> or <strong className="font-semibold text-zinc-900 dark:text-zinc-100">Add to Home screen</strong>{' '}
                    <PlusSquare className="w-3.5 h-3.5 inline mx-0.5 text-emerald-500" />.
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleInstallClick}
            className="flex-1 py-2 px-3 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold text-xs flex items-center justify-center gap-1.5 shadow-xs hover:bg-zinc-800 dark:hover:bg-white active:scale-[0.98] transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            <span>
              {installPrompt
                ? 'Install'
                : showGuide
                ? 'Hide instructions'
                : ios
                ? 'Add to Home Screen'
                : 'How to install'}
            </span>
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="py-2 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-medium text-xs hover:bg-zinc-200 dark:hover:bg-zinc-700 active:scale-[0.98] transition-all"
          >
            Not now
          </button>
        </div>
      </div>
    </aside>
  );
};

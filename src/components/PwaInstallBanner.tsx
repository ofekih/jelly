import React, { useEffect, useState } from 'react';
import { Download, PlusSquare, Share2, Sparkles, X } from 'lucide-react';
import {
  dismissPwaNudge,
  isIosSafari,
  isMobileDevice,
  isPwaNudgeDismissed,
  isRunningAsPwa,
  recordPwaInstalled,
} from '../lib/pwaService';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export const PwaInstallBanner: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    // 1. Never show if already running as standalone PWA
    if (isRunningAsPwa()) return;

    // 2. Only show on mobile devices
    if (!isMobileDevice()) return;

    // 3. Check if user dismissed recently
    if (isPwaNudgeDismissed()) return;

    setIsIos(isIosSafari());

    // Listen for Chrome/Android native install prompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    // Listen for app installed event
    const handleAppInstalled = () => {
      recordPwaInstalled();
      setIsVisible(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // Subtle 2.5s delay after page load before sliding up
    const timer = setTimeout(() => {
      // Re-verify conditions
      if (!isRunningAsPwa() && isMobileDevice() && !isPwaNudgeDismissed()) {
        setIsVisible(true);
      }
    }, 2500);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  if (!isVisible) return null;

  const handleDismiss = () => {
    dismissPwaNudge();
    setIsVisible(false);
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          recordPwaInstalled();
          setIsVisible(false);
        } else {
          handleDismiss();
        }
      } catch {
        handleDismiss();
      }
      setDeferredPrompt(null);
    } else if (isIos) {
      setShowIosGuide((prev) => !prev);
    } else {
      setShowIosGuide((prev) => !prev);
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
                Add to your home screen for instant rankings & full-screen view.
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

        {/* Expandable step instructions (for iOS Safari or when native prompt is not active) */}
        {showIosGuide && (
          <div className="mt-1 p-3 bg-zinc-50 dark:bg-zinc-800/70 rounded-xl border border-zinc-200/60 dark:border-zinc-700/60 text-xs text-zinc-700 dark:text-zinc-300 space-y-2 animate-in fade-in duration-200">
            {isIos ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-bold flex items-center justify-center text-[11px] shrink-0">
                    1
                  </span>
                  <span>
                    Tap the <strong className="font-semibold text-zinc-900 dark:text-zinc-100">Share</strong> button{' '}
                    <Share2 className="w-3.5 h-3.5 inline mx-0.5 text-sky-500" /> in Safari's toolbar.
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
              {deferredPrompt
                ? 'Install'
                : showIosGuide
                ? 'Hide instructions'
                : isIos
                ? 'Install on iPhone'
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

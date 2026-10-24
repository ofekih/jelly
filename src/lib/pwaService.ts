/**
 * PWA detection and installation utilities for jelly.
 */

export const PWA_DISMISS_KEY = 'jelly_pwa_nudge_dismissed_until';
export const PWA_INSTALLED_KEY = 'jelly_pwa_installed';

/**
 * Checks whether the app is currently running in an installed progressive web app mode.
 * Evaluates:
 * 1. Standard CSS display-mode media queries (standalone, fullscreen, minimal-ui)
 * 2. iOS Safari standalone mode (`navigator.standalone`)
 * 3. Android TWA / app wrapper referrers (`android-app://`)
 * 4. Local storage flag recorded upon successful install
 */
export function isRunningAsPwa(
  win?: Window,
  nav?: Navigator,
  doc?: Document
): boolean {
  try {
    const activeWin = win ?? (typeof window !== 'undefined' ? window : undefined);
    const activeNav = nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);
    const activeDoc = doc ?? (typeof document !== 'undefined' ? document : undefined);

    if (!activeWin) return false;

    // Check display-mode media queries
    if (typeof activeWin.matchMedia === 'function') {
      if (
        activeWin.matchMedia('(display-mode: standalone)').matches ||
        activeWin.matchMedia('(display-mode: fullscreen)').matches ||
        activeWin.matchMedia('(display-mode: minimal-ui)').matches
      ) {
        return true;
      }
    }

    // iOS Safari standalone property
    if ((activeNav as unknown as { standalone?: boolean })?.standalone === true) {
      return true;
    }

    // Android Trusted Web Activity / installed wrapper
    if (activeDoc?.referrer && activeDoc.referrer.startsWith('android-app://')) {
      return true;
    }

    // Previously marked installed in this browser
    if (activeWin.localStorage?.getItem(PWA_INSTALLED_KEY) === 'true') {
      return true;
    }
  } catch {
    // If any error checking APIs, fail safe
    return false;
  }

  return false;
}

/**
 * Checks if the current client is a mobile device (touch-based phone/tablet).
 */
export function isMobileDevice(win?: Window, nav?: Navigator): boolean {
  try {
    const activeWin = win ?? (typeof window !== 'undefined' ? window : undefined);
    const activeNav = nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);

    if (!activeNav) return false;
    const ua = activeNav.userAgent || '';
    const isMobileUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);

    let isCoarse = false;
    if (activeWin && typeof activeWin.matchMedia === 'function') {
      isCoarse =
        activeWin.matchMedia('(pointer: coarse)').matches &&
        activeWin.matchMedia('(max-width: 768px)').matches;
    }

    return isMobileUa || isCoarse;
  } catch {
    return false;
  }
}

/**
 * Checks if the device runs iOS or iPadOS, in any browser. iPads ask for desktop sites by default
 * and report a Mac user agent, so a Mac with a touchscreen counts as an iPad.
 */
export function isIosDevice(nav?: Navigator): boolean {
  try {
    const activeNav = nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);
    if (!activeNav) return false;
    const ua = activeNav.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    return /Macintosh/i.test(ua) && (activeNav.maxTouchPoints ?? 0) > 1;
  } catch {
    return false;
  }
}

/** Checks if the device is an iPhone, iPad or Mac, which share one set of system icons. */
export function isApplePlatform(nav?: Navigator): boolean {
  try {
    const activeNav = nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);
    if (!activeNav) return false;
    return isIosDevice(activeNav) || /Macintosh|Mac OS X/i.test(activeNav.userAgent || '');
  } catch {
    return false;
  }
}

/**
 * Checks if the device is iOS Safari, where Add to Home Screen sits right in the Share sheet.
 * Other iOS browsers (Chrome, Firefox, Edge) can add to the home screen too, from their own Share.
 */
export function isIosSafari(nav?: Navigator): boolean {
  try {
    const activeNav = nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);
    if (!activeNav) return false;
    const ua = activeNav.userAgent || '';
    const isWebKit = /WebKit/i.test(ua);
    const isOtherBrowser = /CriOS|FxiOS|OPiOS|EdgiOS|mercury/i.test(ua);
    return isIosDevice(activeNav) && isWebKit && !isOtherBrowser;
  } catch {
    return false;
  }
}

/** Chrome/Edge/Samsung Internet's install event, which lets a button open the native install dialog. */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

let installPrompt: BeforeInstallPromptEvent | null = null;
const installPromptListeners = new Set<() => void>();

function setInstallPrompt(next: BeforeInstallPromptEvent | null): void {
  installPrompt = next;
  installPromptListeners.forEach((listener) => listener());
}

/**
 * Starts listening for the browser's install event. Call before rendering: browsers often fire it
 * right after load, before React mounts, and never again for that page.
 */
export function captureInstallPrompt(target: EventTarget = window, storage?: Storage): void {
  target.addEventListener('beforeinstallprompt', (e) => {
    // Keep it for the banner's Install button instead of the browser's own mini-infobar
    e.preventDefault();
    setInstallPrompt(e as BeforeInstallPromptEvent);
  });
  target.addEventListener('appinstalled', () => {
    recordPwaInstalled(storage);
    setInstallPrompt(null);
  });
}

/** The captured install event, if the browser offered one and it hasn't been used yet. */
export function getInstallPrompt(): BeforeInstallPromptEvent | null {
  return installPrompt;
}

/** Calls `listener` whenever the install event arrives or is used up; returns the unsubscribe. */
export function subscribeInstallPrompt(listener: () => void): () => void {
  installPromptListeners.add(listener);
  return () => {
    installPromptListeners.delete(listener);
  };
}

/**
 * Opens the native install dialog. The event works only once, so it is cleared either way;
 * resolves to whether the user accepted.
 */
export async function promptInstall(): Promise<boolean> {
  const prompt = installPrompt;
  if (!prompt) return false;
  setInstallPrompt(null);
  await prompt.prompt();
  const choice = await prompt.userChoice;
  return choice.outcome === 'accepted';
}

/**
 * Returns true if the user recently dismissed the PWA install nudge.
 */
export function isPwaNudgeDismissed(storage?: Storage): boolean {
  try {
    const activeStorage = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!activeStorage) return false;
    const raw = activeStorage.getItem(PWA_DISMISS_KEY);
    if (!raw) return false;
    const expiresAt = Number(raw);
    if (isNaN(expiresAt)) return false;
    return Date.now() < expiresAt;
  } catch {
    return false;
  }
}

/**
 * Dismisses the PWA install nudge for a period of time (default: 14 days).
 */
export function dismissPwaNudge(storage?: Storage, days = 14): void {
  try {
    const activeStorage = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!activeStorage) return;
    const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
    activeStorage.setItem(PWA_DISMISS_KEY, String(expiresAt));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Records that the app was successfully installed.
 */
export function recordPwaInstalled(storage?: Storage): void {
  try {
    const activeStorage = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!activeStorage) return;
    activeStorage.setItem(PWA_INSTALLED_KEY, 'true');
  } catch {
    // Ignore storage errors
  }
}

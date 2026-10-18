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
 * Checks if the device is iOS Safari (which requires manual "Add to Home Screen" via Share sheet).
 */
export function isIosSafari(nav?: Navigator): boolean {
  try {
    const activeNav = nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);
    if (!activeNav) return false;
    const ua = activeNav.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isWebKit = /WebKit/i.test(ua);
    const isChromeOrFirefox = /CriOS|FxiOS|OPiOS|EdgiOS|mercury/i.test(ua);
    return isIOS && isWebKit && !isChromeOrFirefox;
  } catch {
    return false;
  }
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

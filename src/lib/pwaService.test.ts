import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  captureInstallPrompt,
  dismissPwaNudge,
  getInstallPrompt,
  isIosDevice,
  isIosSafari,
  isMobileDevice,
  isPwaNudgeDismissed,
  isRunningAsPwa,
  PWA_DISMISS_KEY,
  PWA_INSTALLED_KEY,
  promptInstall,
  recordPwaInstalled,
  subscribeInstallPrompt,
} from './pwaService';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1';
const IPHONE_FIREFOX =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

describe('pwaService', () => {
  let mockStorage: Record<string, string>;
  let storage: Storage;

  beforeEach(() => {
    mockStorage = {};
    storage = {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
      removeItem: (k: string) => {
        delete mockStorage[k];
      },
      clear: () => {
        mockStorage = {};
      },
      key: () => null,
      length: 0,
    };
  });

  describe('isRunningAsPwa', () => {
    it('returns true when display-mode matches standalone', () => {
      const win = {
        matchMedia: (query: string) => ({
          matches: query === '(display-mode: standalone)',
        }),
        localStorage: storage,
      } as unknown as Window;
      expect(isRunningAsPwa(win)).toBe(true);
    });

    it('returns true when navigator.standalone is true (iOS Safari standalone)', () => {
      const win = {
        matchMedia: () => ({ matches: false }),
        localStorage: storage,
      } as unknown as Window;
      const nav = { standalone: true } as unknown as Navigator;
      expect(isRunningAsPwa(win, nav)).toBe(true);
    });

    it('returns true when referrer starts with android-app://', () => {
      const win = {
        matchMedia: () => ({ matches: false }),
        localStorage: storage,
      } as unknown as Window;
      const nav = {} as unknown as Navigator;
      const doc = { referrer: 'android-app://org.chromium.webapk.something' } as unknown as Document;
      expect(isRunningAsPwa(win, nav, doc)).toBe(true);
    });

    it('returns true when previously marked installed in localStorage', () => {
      storage.setItem(PWA_INSTALLED_KEY, 'true');
      const win = {
        matchMedia: () => ({ matches: false }),
        localStorage: storage,
      } as unknown as Window;
      expect(isRunningAsPwa(win)).toBe(true);
    });

    it('returns false for standard browser browsing', () => {
      const win = {
        matchMedia: () => ({ matches: false }),
        localStorage: storage,
      } as unknown as Window;
      const nav = { standalone: false } as unknown as Navigator;
      const doc = { referrer: 'https://google.com' } as unknown as Document;
      expect(isRunningAsPwa(win, nav, doc)).toBe(false);
    });
  });

  describe('isMobileDevice', () => {
    it('identifies iPhone as mobile', () => {
      const nav = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' } as unknown as Navigator;
      const win = { matchMedia: () => ({ matches: false }) } as unknown as Window;
      expect(isMobileDevice(win, nav)).toBe(true);
    });

    it('identifies Android mobile as mobile', () => {
      const nav = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' } as unknown as Navigator;
      const win = { matchMedia: () => ({ matches: false }) } as unknown as Window;
      expect(isMobileDevice(win, nav)).toBe(true);
    });

    it('identifies desktop Chrome as non-mobile', () => {
      const nav = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' } as unknown as Navigator;
      const win = { matchMedia: () => ({ matches: false }) } as unknown as Window;
      expect(isMobileDevice(win, nav)).toBe(false);
    });
  });

  describe('dismissal and recording', () => {
    it('handles dismissal cooldown correctly', () => {
      expect(isPwaNudgeDismissed(storage)).toBe(false);
      dismissPwaNudge(storage, 14);
      expect(isPwaNudgeDismissed(storage)).toBe(true);

      // Past timestamp should no longer be dismissed
      storage.setItem(PWA_DISMISS_KEY, String(Date.now() - 1000));
      expect(isPwaNudgeDismissed(storage)).toBe(false);
    });

    it('records pwa install status', () => {
      recordPwaInstalled(storage);
      expect(storage.getItem(PWA_INSTALLED_KEY)).toBe('true');
    });
  });

  describe('iOS detection', () => {
    const nav = (userAgent: string, maxTouchPoints = 0) =>
      ({ userAgent, maxTouchPoints }) as unknown as Navigator;

    it('tells Safari apart from other iPhone browsers', () => {
      expect(isIosSafari(nav(IPHONE_SAFARI))).toBe(true);
      expect(isIosSafari(nav(IPHONE_CHROME))).toBe(false);
      expect(isIosSafari(nav(IPHONE_FIREFOX))).toBe(false);
      expect(isIosDevice(nav(IPHONE_CHROME))).toBe(true);
      expect(isIosDevice(nav(IPHONE_FIREFOX))).toBe(true);
    });

    it('counts an iPad asking for the desktop site as iOS, but not a Mac', () => {
      expect(isIosDevice(nav(MAC_SAFARI, 5))).toBe(true);
      expect(isIosSafari(nav(MAC_SAFARI, 5))).toBe(true);
      expect(isIosDevice(nav(MAC_SAFARI, 0))).toBe(false);
    });
  });

  describe('install prompt', () => {
    const fakePrompt = (outcome: 'accepted' | 'dismissed') =>
      Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        platforms: ['web'],
        userChoice: Promise.resolve({ outcome, platform: 'web' }),
        prompt: vi.fn(() => Promise.resolve()),
      });

    it('keeps the event fired before anyone listens, and uses it only once', async () => {
      const target = new EventTarget();
      captureInstallPrompt(target, storage);
      const event = fakePrompt('accepted');
      target.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(getInstallPrompt()).toBe(event);

      const listener = vi.fn();
      const unsubscribe = subscribeInstallPrompt(listener);
      expect(await promptInstall()).toBe(true);
      expect(event.prompt).toHaveBeenCalledOnce();
      expect(getInstallPrompt()).toBeNull();
      expect(listener).toHaveBeenCalled();
      expect(await promptInstall()).toBe(false);
      unsubscribe();
    });

    it('reports a dismissed dialog', async () => {
      const target = new EventTarget();
      captureInstallPrompt(target, storage);
      target.dispatchEvent(fakePrompt('dismissed'));
      expect(await promptInstall()).toBe(false);
    });

    it('records the install and drops the event once the app is installed', () => {
      const target = new EventTarget();
      captureInstallPrompt(target, storage);
      target.dispatchEvent(fakePrompt('accepted'));
      target.dispatchEvent(new Event('appinstalled'));
      expect(getInstallPrompt()).toBeNull();
      expect(storage.getItem(PWA_INSTALLED_KEY)).toBe('true');
    });
  });
});

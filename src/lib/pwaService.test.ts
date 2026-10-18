import { describe, expect, it, beforeEach } from 'vitest';
import {
  dismissPwaNudge,
  isMobileDevice,
  isPwaNudgeDismissed,
  isRunningAsPwa,
  PWA_DISMISS_KEY,
  PWA_INSTALLED_KEY,
  recordPwaInstalled,
} from './pwaService';

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
});

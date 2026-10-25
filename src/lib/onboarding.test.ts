import { describe, expect, it } from 'vitest';
import { shouldAutoOpenTour, TourGate } from './onboarding';

const NEW_USER: TourGate = {
  authSettled: true,
  signedIn: false,
  listsLoaded: true,
  viewingSharedList: false,
  rankedCount: 0,
  bookmarkCount: 0,
  seen: false,
};

describe('shouldAutoOpenTour', () => {
  it('opens for a brand-new signed-out visitor', () => {
    expect(shouldAutoOpenTour(NEW_USER)).toBe(true);
  });

  it('never opens for anyone with saved spots or bookmarks', () => {
    expect(shouldAutoOpenTour({ ...NEW_USER, rankedCount: 1 })).toBe(false);
    expect(shouldAutoOpenTour({ ...NEW_USER, bookmarkCount: 3 })).toBe(false);
  });

  it('opens only once per device', () => {
    expect(shouldAutoOpenTour({ ...NEW_USER, seen: true })).toBe(false);
  });

  it('waits for auth, and for a signed-in account’s lists to load', () => {
    expect(shouldAutoOpenTour({ ...NEW_USER, authSettled: false })).toBe(false);
    expect(shouldAutoOpenTour({ ...NEW_USER, signedIn: true, listsLoaded: false })).toBe(false);
    expect(shouldAutoOpenTour({ ...NEW_USER, signedIn: true, listsLoaded: true })).toBe(true);
  });

  it('stays out of the way of a share link', () => {
    expect(shouldAutoOpenTour({ ...NEW_USER, viewingSharedList: true })).toBe(false);
  });
});

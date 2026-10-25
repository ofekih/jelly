export interface TourGate {
  /** Firebase auth has reported the first user (or none) */
  authSettled: boolean;
  signedIn: boolean;
  /** Signed in: the account's lists have arrived from the cloud (signed out: always true) */
  listsLoaded: boolean;
  /** A share link is open or still loading */
  viewingSharedList: boolean;
  /** Ranked entries and bookmarks across every list */
  rankedCount: number;
  bookmarkCount: number;
  /** The tour already opened on this device (`onboardingSeen` in local settings) */
  seen: boolean;
}

/** The welcome tour opens by itself only for a brand-new user: nothing saved anywhere, never shown here. */
export function shouldAutoOpenTour(g: TourGate): boolean {
  if (g.seen || !g.authSettled || g.viewingSharedList) return false;
  if (g.signedIn && !g.listsLoaded) return false;
  return g.rankedCount === 0 && g.bookmarkCount === 0;
}

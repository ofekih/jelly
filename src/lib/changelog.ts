/**
 * User-facing release notes, newest first. The first entry's version is the app version shown
 * in Settings (keep `package.json` in sync; a test enforces it).
 *
 * Add an entry (or bullets to the newest one) whenever a ship changes something users can see.
 * Bump the major for big shifts, the minor for features; fixes and internals don't need one.
 * Write for users: short, plain, no internal names.
 */
export interface ChangelogEntry {
  /** Semver `major.minor.patch`. */
  version: string;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  title: string;
  highlights: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '3.0.0',
    date: '2026-10-21',
    title: 'Movies & TV',
    highlights: [
      'A new Watch group ranks the movies and TV shows you’ve watched, each in its own list, the same way as places: a gut feeling, then a few quick comparisons',
      'Search any title to rank it, or save it to Want to Watch; posters, years and directors come along',
      'Friends’ scores, “For you” picks and Watch Together work for movies and shows too',
      'Shared lists no longer stop at 500 spots',
    ],
  },
  {
    version: '2.5.0',
    date: '2026-10-20',
    title: 'Your order, trusted',
    highlights: [
      'Gut ratings now count as a rough first impression: if you rank a place you rated 7 above one you rated 8, it now scores higher instead of both getting 7.5',
      'Places you rated the same get spread out by your order instead of sharing one score',
      'jelly learns how literally to take your gut ratings from how well they match your order',
      'Your scores may shift a little; the About page explains how it works',
    ],
  },
  {
    version: '2.4.0',
    date: '2026-10-19',
    title: 'For you',
    highlights: [
      'A new “For you” tab next to Want to Try lists the spots you’ll probably love most in each list, best first',
      'Each pick shows how sure jelly is and what it’s based on; tap one for details and a Maps link',
      'Save a pick to Want to Try or rank it right from the list, or see your picks on the map',
    ],
  },
  {
    version: '2.3.0',
    date: '2026-10-19',
    title: 'Predictions for everyone',
    highlights: [
      '“For you” predictions now work without following anyone: jelly learns from people whose taste matches yours',
      'Your lists stay private—a prediction only uses people you don’t follow when at least three of them share your taste, and never names them',
      'Want to Try spots get a predicted score too',
    ],
  },
  {
    version: '2.2.0',
    date: '2026-10-19',
    title: 'More private, and faster',
    highlights: [
      'Your list can only be opened from your share link—nobody can browse or download everyone’s lists any more',
      'jelly opens faster: it no longer loads every jelly user’s list, just yours and the friends you follow',
      'Find friends by the start of their name or @handle',
      'jelly averages update by themselves a few seconds after anyone ranks a spot',
      '“For you” predictions now come from the friends you follow',
      'Signing out clears your lists from the device, so the next person can’t see them',
      'Deleting your last spot or bookmark on one device no longer brings it back from another, and unfollows stick everywhere',
    ],
  },
  {
    version: '2.1.0',
    date: '2026-10-19',
    title: 'Scores that match how you felt',
    highlights: [
      'Scores now follow your own gut ratings as closely as your order allows, so long lists no longer get stretched down the scale',
      'Your scores may shift a little—most on long lists, where spots lower down move back up toward how you rated them',
      'Dragging a place far from its gut rating no longer pulls its new neighbours’ scores along with it',
    ],
  },
  {
    version: '2.0.0',
    date: '2026-10-19',
    title: 'Explore and Travel',
    highlights: [
      'Rank more than food: museums, theme parks, zoos and parks under Explore; cities, getaways and countries under Travel',
      'Switch between Eat, Explore and Travel from the header—each keeps its own lists and scores',
      'Reworked gut-feeling labels so the whole 1–10 scale gets used',
      'Search favors spots near you (or your home city) over far-away namesakes',
      'Installed app shows a one-tap reload when an update is ready',
      'New About page (linked at the bottom) explaining how jelly ranks, with live demos',
      'Rating bar re-tuned so each tier’s size matches how often people feel that way',
      'Side-by-side picks now keep going until a new place’s spot is accurate instead of stopping at five, and one mis-tap can no longer throw it off',
      'jelly remembers your picks and offers a quick check when they suggest two spots are out of order',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-10-18',
    title: 'Separate lists',
    highlights: [
      'Six separate ranked lists: Restaurants, Brunch, Dessert, Bakeries, Coffee & Tea and Bars',
      'Searches use your device location by default',
      'Install jelly to your home screen; swipe down to close sheets',
      'See who follows you and who you follow',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-10-17',
    title: 'Friends',
    highlights: [
      'Follow friends and see their scores and notes on your spots',
      'Eat Together blends everyone’s lists to pick a place',
      'Predicted scores based on friends with similar taste, plus the jelly-wide average',
      'Swipe a spot to re-rank it, open it in Google Maps or remove it',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-10-17',
    title: 'jelly launches',
    highlights: [
      'Rate a spot by gut feeling, then settle its rank with quick side-by-side picks',
      'Drag to re-rank, browse everything on a map and save places to try',
      'Share your list with a public link',
    ],
  },
];

export const CURRENT_VERSION = CHANGELOG[0].version;

/** `2.0.0` → `2.0`; patch numbers are hidden from users. */
export function displayVersion(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}

function majorMinor(version: string): [number, number] {
  const [major = 0, minor = 0] = version.split('.').map((n) => parseInt(n, 10) || 0);
  return [major, minor];
}

/** True when `current` is a newer major or minor release than `lastSeen` (patches never nudge). */
export function hasUnseenRelease(lastSeen: string | undefined, current: string = CURRENT_VERSION): boolean {
  if (!lastSeen) return true;
  const [seenMajor, seenMinor] = majorMinor(lastSeen);
  const [major, minor] = majorMinor(current);
  return major > seenMajor || (major === seenMajor && minor > seenMinor);
}

/** Formats an ISO date as e.g. "Oct 19, 2026" without timezone drift. */
export function formatReleaseDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

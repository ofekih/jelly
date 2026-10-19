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

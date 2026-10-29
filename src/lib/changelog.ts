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
    version: '4.4.0',
    date: '2026-10-28',
    title: 'What does it cost?',
    highlights: [
      'Board games show what a new copy costs and what used ones go for',
      'Video games show their current Steam price, with the original price when on sale',
    ],
  },
  {
    version: '4.3.0',
    date: '2026-10-25',
    title: 'Been there too?',
    highlights: [
      'On a friend’s list, tap a spot and “Been here – rank it” to rank it in your own list right away',
      'Spots you’ve already ranked show your own rank and score there instead, with a quick Re-rank',
    ],
  },
  {
    version: '4.2.0',
    date: '2026-10-25',
    title: 'Helpful reviews',
    highlights: [
      'Give reviews a thumbs up or down, and see how many people found each one helpful',
      'Prices show the typical spend per person from Google Maps (like $20–30) wherever it’s known',
      'More room for names in your list on phones – the drag handle is gone, just press and hold a row (or drag its number) to move it',
    ],
  },
  {
    version: '4.1.0',
    date: '2026-10-25',
    title: 'Search, look up, review',
    highlights: [
      'Search now opens as a full page: pick a group, type, set where to look, then pick from the results',
      'Tap any result to look it up – details, friends’ scores and reviews – without saying you’ve been',
      'Leave a public review after you rank something, or skip it in one tap',
      'Upload your own profile picture from your profile page',
    ],
  },
  {
    version: '4.0.1',
    date: '2026-10-25',
    title: 'Welcome tour for everyone',
    highlights: [
      'The welcome tour’s demos now play even with Reduce Motion turned on – just without the sliding and bouncing',
    ],
  },
  {
    version: '4.0.0',
    date: '2026-10-25',
    title: 'Feels like an app',
    highlights: [
      'A new bottom bar: your lists, friends, a big + to add, share and your profile, all within thumb’s reach',
      'The top bar tucks away as you scroll down and comes back when you scroll up',
      'Your new profile page: your stats, your top pick in every group, settings, dark mode and more',
      'Moved something by mistake? Undo right after you drag a spot',
      'Cleaner, calmer pop-ups for undo and for new versions',
      'See prices on spots, like $$ · $20–30, when Google knows them',
      'A short welcome tour for new people, and you can replay it from your profile',
      'Send feedback or report a bug from your profile – I read every message, and most requests ship within 24 hours',
    ],
  },
  {
    version: '3.4.0',
    date: '2026-10-23',
    title: 'Better share links',
    highlights: [
      'Links to your list now show your top 10 and its scores right in the message, on WhatsApp, iMessage, Slack and more',
      'Sharing your top-10 card now sends the image itself, not just a line of text',
      'The jelly icon on your home screen and in link previews is bigger and easier to spot',
      'Share and back buttons now look like the ones on your phone—iPhone or Android',
    ],
  },
  {
    version: '3.3.3',
    date: '2026-10-23',
    title: 'Easier install',
    highlights: [
      'Install jelly in one tap on Android, and in one click from Chrome or Edge on your computer',
      'Install steps now fit Chrome, Firefox and Edge on iPhone, and show up on iPad too',
    ],
  },
  {
    version: '3.3.2',
    date: '2026-10-23',
    title: 'Swipe to close',
    highlights: [
      'On your phone, drag any card down from its top edge to close it—now including rating, side-by-side picks and Settings',
      'Settings save as soon as you close them, so there’s no Done button to remember',
      'Re-ranking the only spot in a list now keeps its notes and favorite dishes',
    ],
  },
  {
    version: '3.3.1',
    date: '2026-10-22',
    title: 'Small touches',
    highlights: [
      'Rating a hotel now uses words that fit a stay, like “Fine for a night”',
      'Board & Card Games is now called Tabletop Games',
    ],
  },
  {
    version: '3.3.0',
    date: '2026-10-21',
    title: 'Hotels & Stays',
    highlights: [
      'Travel has a new Hotels & Stays list for the hotels, resorts, B&Bs and cabins you’ve stayed at',
      'Search finds places to stay anywhere, tagged by kind (Resort, B&B, Hostel…) and country',
      'Hotels you search for now land in Hotels & Stays instead of asking which list they belong in',
    ],
  },
  {
    version: '3.2.0',
    date: '2026-10-21',
    title: 'Games',
    highlights: [
      'A new Play group ranks your Board & Card Games and Video Games, each in its own list',
      'Board games come with player count, the best number of players, play time and complexity',
      'Filter board games by how many are playing and how long you have, in your list and in Play Together',
      'Video games show their developer and tags like Co-op and Multiplayer',
    ],
  },
  {
    version: '3.1.0',
    date: '2026-10-21',
    title: 'Books',
    highlights: [
      'A new Read group ranks the books you’ve read in two lists, Fiction and Nonfiction',
      'Search any title or author; covers and authors come along, and every edition of a book counts as the same book',
      'Save books to Want to Read, see friends’ scores, and pick your next book club read with Read Together',
    ],
  },
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

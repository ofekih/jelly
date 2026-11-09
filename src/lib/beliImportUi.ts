import type { SpotCategory } from '../types';
import type { BeliExport, MatchDecision, MatchReason, MatchResult } from './beliImport/types';

/**
 * UI-side helpers for the Beli import flow (the engine lives in `./beliImport/`): the request
 * email, the per-device status behind the Eat card and Settings row, and the review list.
 */

export const BELI_SUPPORT_EMAIL = 'support@beliapp.com';
/** One real request: sent Oct 18 2026, acknowledged the same day, zip emailed Nov 8 */
export const BELI_TURNAROUND = 'about 3 weeks';
/** Eat lists with at most this many ranked spots still show the "Coming from Beli?" card */
export const BELI_CARD_MAX_SPOTS = 5;
/** Undo stays offered in Settings this long after an import */
export const BELI_UNDO_DAYS = 30;

export const BELI_REQUEST_SUBJECT = 'Data export request';

export function beliRequestBody(username: string): string {
  const handle = username.trim().replace(/^@+/, '');
  return [
    'Hi Beli Support Team,',
    '',
    'I’m requesting a machine-readable export (CSV or JSON) of my account data under applicable privacy laws (CCPA/GDPR). Please include my ranked places (rank order, and scores if you can), my want-to-try list, visit dates, notes and favorite dishes.',
    '',
    `Username: @${handle || 'yourname'}`,
    'Account email: the address I’m writing from',
    '',
    'Thank you!',
  ].join('\n');
}

export function beliRequestMailto(username: string): string {
  const q = `subject=${encodeURIComponent(BELI_REQUEST_SUBJECT)}&body=${encodeURIComponent(beliRequestBody(username))}`;
  return `mailto:${BELI_SUPPORT_EMAIL}?${q}`;
}

// ---------------------------------------------------------------------------
// Per-device status (asked Beli, card dismissed). Not synced: it only drives prompts.
// ---------------------------------------------------------------------------

export const BELI_STATUS_KEY = 'jelly_beli_import_v1';

export interface BeliImportStatus {
  /** When "I've sent it" was tapped */
  askedAt?: number;
  /** The Eat card was hidden for good */
  cardDismissed?: boolean;
  /** Beli username typed into the request helper (prefills it next time) */
  username?: string;
}

export function readBeliStatus(storage: Pick<Storage, 'getItem'> | null = safeStorage()): BeliImportStatus {
  try {
    const raw = storage?.getItem(BELI_STATUS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as BeliImportStatus) : {};
  } catch {
    return {};
  }
}

export function writeBeliStatus(
  patch: Partial<BeliImportStatus>,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()
): BeliImportStatus {
  const next = { ...readBeliStatus(storage), ...patch };
  try {
    storage?.setItem(BELI_STATUS_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the card just shows again next time
  }
  return next;
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The Eat card shows while Eat is (nearly) empty and nothing was imported, unless hidden for good */
export function shouldShowBeliCard(eatSpots: number, status: BeliImportStatus, hasImported: boolean): boolean {
  return !status.cardDismissed && !hasImported && eatSpots <= BELI_CARD_MAX_SPOTS;
}

export function daysSince(ms: number, now = Date.now()): number {
  return Math.max(0, Math.floor((now - ms) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export interface ReviewItem {
  key: string;
  name: string;
  city: string;
  /** Ranked lists this place is in, with its Beli rank (empty for a want-to-try place) */
  ranks: Array<{ category: SpotCategory; rank: number }>;
  /** The list a want-to-try place goes into */
  bookmarkCategory?: SpotCategory;
  match: MatchResult;
}

/**
 * Places that need a person: unsure matches, not found, and failed lookups. Ranked places come
 * first (by list order, then rank), want-to-try places after.
 */
export function reviewItems(exp: BeliExport, matches: Record<string, MatchResult>, categories: SpotCategory[]): ReviewItem[] {
  const byKey = new Map<string, ReviewItem>();
  const order: SpotCategory[] = categories;
  for (const category of order) {
    for (const row of exp.lists[category] ?? []) {
      const match = matches[row.key];
      if (!match || match.status === 'matched') continue;
      const item = byKey.get(row.key) ?? { key: row.key, name: row.name, city: row.city, ranks: [], match };
      item.ranks.push({ category, rank: row.rank });
      byKey.set(row.key, item);
    }
  }
  const ranked = [...byKey.values()];
  const saved: ReviewItem[] = [];
  for (const row of exp.bookmarks) {
    const match = matches[row.key];
    if (!match || match.status === 'matched' || byKey.has(row.key)) continue;
    if (!categories.includes(row.category)) continue;
    saved.push({ key: row.key, name: row.name, city: row.city, ranks: [], bookmarkCategory: row.category, match });
    byKey.set(row.key, saved[saved.length - 1]);
  }
  return [...ranked, ...saved];
}

const REASON_TEXT: Record<MatchReason, (city: string) => string> = {
  chain: (city) => `Several places with this name${city ? ` near ${city}` : ''}`,
  name: () => 'The name on Google is different',
  city: (city) => (city ? `Not in ${city}` : 'In a different city'),
  type: () => 'Google lists it as a different kind of place',
  closed: () => 'Google lists it as permanently closed',
  no_results: (city) => `Nothing with this name${city ? ` near ${city}` : ''}`,
  failed: () => 'The lookup failed – try again',
  cancelled: () => 'Not looked up yet',
  cap: () => 'Not looked up yet',
};

/** One short line on why a place needs a look */
export function reviewReason(item: Pick<ReviewItem, 'city' | 'match'>): string {
  const city = item.city.split(',')[0].trim();
  const reason = item.match.reasons[0] ?? (item.match.status === 'not_found' ? 'no_results' : 'name');
  return REASON_TEXT[reason](city);
}

export function isResolved(decision: MatchDecision | undefined): boolean {
  return Boolean(decision);
}

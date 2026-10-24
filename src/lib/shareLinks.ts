/**
 * Share links to a public list: `/l/<uid>?c=<category>` (the `sharePage` function gives these a
 * per-list link preview, then serves the app) and the older `/?list=<uid>`, which still opens.
 */
import { isSpotCategory, type SpotCategory } from '../types';

const SHARE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SHARE_PATH = /^\/l\/([^/]+)\/?$/;

export function shareListUrl(origin: string, shareId: string, category?: SpotCategory): string {
  return `${origin}/l/${encodeURIComponent(shareId)}${category ? `?c=${category}` : ''}`;
}

/** The list a share URL points at, and the list (category) to open it on. */
export function parseShareUrl(url: URL): { shareId: string; category?: SpotCategory } | null {
  const shareId = url.pathname.match(SHARE_PATH)?.[1] ?? url.searchParams.get('list');
  if (!shareId || !SHARE_ID.test(shareId)) return null;
  const c = url.searchParams.get('c');
  return { shareId, ...(isSpotCategory(c) ? { category: c } : {}) };
}

/** A share link pasted as text (with or without `https://`); null when it isn't one. */
export function shareIdFromText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.includes('list=') && !trimmed.includes('/l/')) return null;
  try {
    const url = /^https?:\/\//.test(trimmed)
      ? new URL(trimmed)
      : /^[/?]/.test(trimmed)
      ? new URL(trimmed, 'https://eatwithjelly.com')
      : new URL(`https://${trimmed}`);
    return parseShareUrl(url)?.shareId ?? null;
  } catch {
    return null;
  }
}

/** Whether a share URL was opened as a path (`/l/<uid>`), so leaving the list resets the path. */
export function isSharePath(pathname: string): boolean {
  return SHARE_PATH.test(pathname);
}

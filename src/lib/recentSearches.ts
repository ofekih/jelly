import type { SpotGroup } from '../types';

const KEY = 'jelly.recentSearches';
const MAX = 6;

type Recents = Partial<Record<SpotGroup, string[]>>;

function read(): Recents {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function write(recents: Recents): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(recents));
  } catch {
    // Private mode or storage full: recents are only a convenience
  }
}

/** This device's last few searches in a group, newest first. */
export function recentSearches(group: SpotGroup): string[] {
  const list = read()[group];
  return Array.isArray(list) ? list.filter((q): q is string => typeof q === 'string').slice(0, MAX) : [];
}

/** Puts `query` at the front of the group's recents (case-insensitive dedupe), returns the new list. */
export function addRecentSearch(group: SpotGroup, query: string): string[] {
  const q = query.trim().replace(/\s+/g, ' ');
  if (q.length < 2) return recentSearches(group);
  const next = [q, ...recentSearches(group).filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX);
  write({ ...read(), [group]: next });
  return next;
}

export function clearRecentSearches(group: SpotGroup): void {
  const recents = read();
  delete recents[group];
  write(recents);
}

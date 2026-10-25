import { beforeEach, describe, expect, it } from 'vitest';
import { addRecentSearch, clearRecentSearches, recentSearches } from './recentSearches';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

describe('recent searches', () => {
  it('keeps the newest first, deduped case-insensitively, per group', () => {
    addRecentSearch('eat', 'pho');
    addRecentSearch('eat', 'Tacos');
    addRecentSearch('eat', '  PHO ');
    addRecentSearch('watch', 'dune');
    expect(recentSearches('eat')).toEqual(['PHO', 'Tacos']);
    expect(recentSearches('watch')).toEqual(['dune']);
  });

  it('ignores one-letter queries and caps the list', () => {
    addRecentSearch('eat', 'a');
    for (let i = 0; i < 10; i++) addRecentSearch('eat', `query ${i}`);
    expect(recentSearches('eat')).toHaveLength(6);
    expect(recentSearches('eat')[0]).toBe('query 9');
  });

  it('survives bad stored data and clears per group', () => {
    store.set('jelly.recentSearches', 'not json');
    expect(recentSearches('eat')).toEqual([]);
    addRecentSearch('eat', 'pho');
    addRecentSearch('read', 'dune');
    clearRecentSearches('eat');
    expect(recentSearches('eat')).toEqual([]);
    expect(recentSearches('read')).toEqual(['dune']);
  });
});

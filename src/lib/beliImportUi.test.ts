import { describe, expect, it } from 'vitest';
import {
  BELI_STATUS_KEY,
  beliRequestBody,
  beliRequestMailto,
  readBeliStatus,
  reviewItems,
  reviewReason,
  shouldShowBeliCard,
  writeBeliStatus,
} from './beliImportUi';
import type { BeliExport, MatchResult } from './beliImport/types';

function memory(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

describe('Beli request email', () => {
  it('fills the username without a doubled @ and never asks for a phone number', () => {
    const body = beliRequestBody('@@nisha');
    expect(body).toContain('Username: @nisha');
    expect(body.toLowerCase()).not.toContain('phone');
  });

  it('falls back to a placeholder handle', () => {
    expect(beliRequestBody('  ')).toContain('Username: @yourname');
  });

  it('builds an encoded mailto link to Beli support', () => {
    const url = beliRequestMailto('a b');
    expect(url.startsWith('mailto:support@beliapp.com?subject=Data%20export%20request&body=')).toBe(true);
    expect(decodeURIComponent(url.split('body=')[1])).toContain('Username: @a b');
  });
});

describe('Beli status', () => {
  it('round-trips and merges patches', () => {
    const storage = memory();
    writeBeliStatus({ askedAt: 5 }, storage);
    writeBeliStatus({ username: 'x' }, storage);
    expect(readBeliStatus(storage)).toEqual({ askedAt: 5, username: 'x' });
  });

  it('survives bad JSON', () => {
    const storage = memory();
    storage.setItem(BELI_STATUS_KEY, '{nope');
    expect(readBeliStatus(storage)).toEqual({});
  });

  it('shows the card only for a nearly empty Eat with nothing imported', () => {
    expect(shouldShowBeliCard(0, {}, false)).toBe(true);
    expect(shouldShowBeliCard(5, {}, false)).toBe(true);
    expect(shouldShowBeliCard(6, {}, false)).toBe(false);
    expect(shouldShowBeliCard(0, { cardDismissed: true }, false)).toBe(false);
    expect(shouldShowBeliCard(0, {}, true)).toBe(false);
  });
});

describe('review items', () => {
  const match = (key: string, status: MatchResult['status'], reasons: MatchResult['reasons'] = []): MatchResult => ({
    key,
    status,
    candidates: [],
    reasons,
    query: key,
    fromCache: false,
  });
  const exp = {
    lists: {
      restaurants: [
        { key: 'a', name: 'A', city: 'Irvine, CA', rank: 1, category: 'restaurants', visitDates: [], labelCount: 0 },
        { key: 'b', name: 'B', city: 'Irvine, CA', rank: 2, category: 'restaurants', visitDates: [], labelCount: 0 },
      ],
      dessert: [{ key: 'b', name: 'B', city: 'Irvine, CA', rank: 1, category: 'dessert', visitDates: [], labelCount: 0 }],
    },
    bookmarks: [
      { key: 'c', name: 'C', city: 'Tel Aviv-Yafo', category: 'restaurants' },
      { key: 'b', name: 'B', city: 'Irvine, CA', category: 'restaurants' },
    ],
  } as unknown as BeliExport;
  const matches = { a: match('a', 'matched'), b: match('b', 'review', ['chain']), c: match('c', 'not_found') };

  it('lists ranked problems first, one per place across lists, then want-to-try ones', () => {
    const items = reviewItems(exp, matches, ['restaurants', 'dessert']);
    expect(items.map((i) => i.key)).toEqual(['b', 'c']);
    expect(items[0].ranks).toEqual([
      { category: 'restaurants', rank: 2 },
      { category: 'dessert', rank: 1 },
    ]);
    expect(items[1].bookmarkCategory).toBe('restaurants');
  });

  it('leaves out lists that are switched off', () => {
    expect(reviewItems(exp, matches, ['dessert']).map((i) => i.key)).toEqual(['b']);
  });

  it('explains the reason with the city name only', () => {
    expect(reviewReason({ city: 'Irvine, CA', match: matches.b })).toBe('Several places with this name near Irvine');
    expect(reviewReason({ city: 'Tel Aviv-Yafo', match: matches.c })).toBe('Nothing with this name near Tel Aviv-Yafo');
  });
});

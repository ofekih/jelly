import { describe, expect, it } from 'vitest';
import { cleanQuery, creatorOf, genreTags, searchTitles, toTmdbTitle } from '../src/tmdb';

describe('toTmdbTitle', () => {
  it('maps movies and shows, and skips people and junk', () => {
    expect(
      toTmdbTitle({ media_type: 'movie', id: 438631, title: 'Dune', release_date: '2021-09-15', poster_path: '/d.jpg', genre_ids: [878, 12] })
    ).toEqual({ kind: 'movie', id: 438631, title: 'Dune', year: 2021, poster: '/d.jpg', genres: ['Sci-Fi', 'Adventure'] });
    expect(toTmdbTitle({ media_type: 'tv', id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20', genre_ids: [18, 10765] })).toEqual({
      kind: 'tv',
      id: 1396,
      title: 'Breaking Bad',
      year: 2008,
      poster: undefined,
      genres: ['Drama', 'Sci-Fi', 'Fantasy'],
    });
    expect(toTmdbTitle({ media_type: 'person', id: 1, name: 'Zendaya' })).toBeNull();
    expect(toTmdbTitle({ media_type: 'movie', id: 2, title: 'Untitled', release_date: '' })).toBeNull();
    expect(toTmdbTitle({ media_type: 'movie', id: 3, title: '  ', poster_path: '/x.jpg' })).toBeNull();
  });

  it('splits combined TV genres and drops the ones with no tag', () => {
    expect(genreTags([10759, 28, 10770, 10767])).toEqual(['Action', 'Adventure']);
    expect(genreTags(undefined)).toEqual([]);
  });
});

describe('creatorOf', () => {
  it('names a movie’s directors and a show’s creators', () => {
    const crew = [
      { job: 'Director', name: 'Joel Coen' },
      { job: 'Writer', name: 'Someone' },
      { job: 'Director', name: 'Ethan Coen' },
    ];
    expect(creatorOf('movie', { credits: { crew } })).toBe('Joel Coen & Ethan Coen');
    expect(creatorOf('tv', { created_by: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] })).toBe('A, B & C');
    expect(creatorOf('tv', {})).toBeUndefined();
  });
});

describe('cleanQuery', () => {
  it('trims and bounds the query', () => {
    expect(cleanQuery('  the   bear ')).toBe('the bear');
    expect(cleanQuery('')).toBeNull();
    expect(cleanQuery('x'.repeat(101))).toBeNull();
    expect(cleanQuery(['a'])).toBeNull();
  });
});

describe('searchTitles', () => {
  it('searches, then adds directors / creators to the top results', async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string, init: { headers: Record<string, string> }) => {
      calls.push(url);
      expect(init.headers.Authorization).toBe('Bearer token');
      const body = url.includes('/search/multi')
        ? {
            results: [
              { media_type: 'movie', id: 1, title: 'Dune', release_date: '2021-09-15', genre_ids: [878] },
              { media_type: 'person', id: 9, name: 'Frank Herbert' },
              { media_type: 'tv', id: 2, name: 'Dune: Prophecy', first_air_date: '2024-11-17', genre_ids: [] },
            ],
          }
        : url.includes('/movie/1/credits')
        ? { crew: [{ job: 'Director', name: 'Denis Villeneuve' }] }
        : { created_by: [] };
      return { ok: true, status: 200, json: async () => body };
    };
    const titles = await searchTitles('dune', 'token', fetchFn);
    expect(titles.map((t) => [t.title, t.creator])).toEqual([
      ['Dune', 'Denis Villeneuve'],
      ['Dune: Prophecy', undefined],
    ]);
    expect(calls[0]).toContain('query=dune');
    expect(calls[0]).toContain('include_adult=false');
  });

  it('keeps a title when its details fail, but fails when the search does', async () => {
    const search = { results: [{ media_type: 'movie', id: 1, title: 'Dune', release_date: '2021-01-01' }] };
    const flaky = async (url: string) =>
      url.includes('/search/') ? { ok: true, status: 200, json: async () => search } : { ok: false, status: 500, json: async () => ({}) };
    expect(await searchTitles('dune', 't', flaky)).toHaveLength(1);
    const down = async () => ({ ok: false, status: 401, json: async () => ({}) });
    await expect(searchTitles('dune', 't', down)).rejects.toThrow('TMDB 401');
  });
});

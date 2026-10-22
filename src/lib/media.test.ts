import { describe, expect, it } from 'vitest';
import {
  bookToCandidate,
  fitsPlayers,
  fitsTime,
  gameFacts,
  gameToCandidate,
  mediaSubtitle,
  parseMedia,
  posterUrl,
  spotLink,
  spotPlaceLabel,
  titleToCandidate,
} from './media';

describe('titleToCandidate', () => {
  it('turns a TMDB movie or show into a candidate for its list', () => {
    expect(
      titleToCandidate({ kind: 'movie', id: 438631, title: 'Dune', year: 2021, poster: '/d.jpg', creator: 'Denis Villeneuve', genres: ['Sci-Fi'] })
    ).toEqual({
      placeId: 'tmdb:movie:438631',
      name: 'Dune',
      formattedAddress: '2021 · Denis Villeneuve',
      media: { year: 2021, poster: '/d.jpg', creator: 'Denis Villeneuve' },
      categories: ['movies'],
      cuisines: ['Sci-Fi'],
      primaryTypeDisplay: 'Movie',
      source: 'tmdb',
    });
    const show = titleToCandidate({ kind: 'tv', id: 1396, title: 'Breaking Bad', genres: [] });
    expect(show.categories).toEqual(['tv_shows']);
    expect(show.formattedAddress).toBe('');
    expect(show).not.toHaveProperty('media');
  });
});

describe('bookToCandidate', () => {
  it('turns a book into a candidate for its list, without the unreliable edition year', () => {
    expect(
      bookToCandidate({
        placeId: 'book:weir:project-hail-mary',
        title: 'Project Hail Mary',
        year: 2021,
        cover: 'https://books.google.com/c',
        creator: 'Andy Weir',
        list: 'fiction',
        tags: ['Sci-Fi'],
      })
    ).toEqual({
      placeId: 'book:weir:project-hail-mary',
      name: 'Project Hail Mary',
      formattedAddress: 'Andy Weir',
      media: { poster: 'https://books.google.com/c', creator: 'Andy Weir' },
      categories: ['fiction'],
      cuisines: ['Sci-Fi'],
      source: 'google_books',
    });
    expect(bookToCandidate({ placeId: 'book:x:y', title: 'Y', tags: [] }).categories).toEqual([]);
  });
});

describe('games', () => {
  const wingspan = {
    placeId: 'bgg:266192',
    title: 'Wingspan',
    year: 2019,
    cover: 'https://cf.geekdo-images.com/w.jpg',
    creator: 'Elizabeth Hargrave',
    tags: ['Strategy'],
    players: [1, 5],
    best: [3, 3],
    time: [40, 70],
    weight: 2.5,
  };

  it('turns a board game into a candidate with players and time in its subtitle', () => {
    const c = gameToCandidate(wingspan, 'board_games');
    expect(c).toMatchObject({
      placeId: 'bgg:266192',
      name: 'Wingspan',
      formattedAddress: '2019 · 1–5 players · 40–70 min',
      categories: ['board_games'],
      cuisines: ['Strategy'],
      source: 'bgg',
    });
    expect(gameFacts(c.media)).toBe('Best with 3 · Complexity 2.5/5 · Elizabeth Hargrave');
  });

  it('turns a video game into a candidate with its developer in the subtitle', () => {
    const c = gameToCandidate({ placeId: 'igdb:113112', title: 'Hades', year: 2020, creator: 'Supergiant Games', tags: ['RPG'] }, 'video_games');
    expect(c.formattedAddress).toBe('2020 · Supergiant Games');
    expect(c.source).toBe('igdb');
    expect(gameFacts(c.media)).toBe('');
  });

  it('filters by player count and play time, never hiding things without them', () => {
    expect(fitsPlayers({ players: [2, 4] }, 4)).toBe(true);
    expect(fitsPlayers({ players: [2, 4] }, 5)).toBe(false);
    expect(fitsPlayers(undefined, 5)).toBe(true);
    expect(fitsTime({ time: [40, 70] }, 45)).toBe(true);
    expect(fitsTime({ time: [40, 70] }, 30)).toBe(false);
    expect(fitsTime({ year: 2020 }, 30)).toBe(true);
    expect(mediaSubtitle({ players: [1, 1], time: [5, 5] })).toBe('1 player · 5 min');
  });

  it('keeps valid game details when parsing stored media', () => {
    expect(parseMedia({ players: [1, 5], best: [3, 3], time: [40, 70], weight: 2.5 })).toEqual({
      players: [1, 5],
      best: [3, 3],
      time: [40, 70],
      weight: 2.5,
    });
    expect(parseMedia({ players: [1], time: ['40', 70], weight: 9 })).toBeUndefined();
  });
});

describe('spotLink', () => {
  it('links titles to TMDB and places to Google Maps', () => {
    expect(spotLink({ placeId: 'tmdb:tv:1396', name: 'Breaking Bad' })).toEqual({
      href: 'https://www.themoviedb.org/tv/1396',
      label: 'TMDB',
      site: 'TMDB',
    });
    expect(spotLink({ placeId: 'ChIJ1', name: 'Zuni', googleMapsUri: 'https://maps.google.com/?cid=1' })).toEqual({
      href: 'https://maps.google.com/?cid=1',
      label: 'Maps',
      site: 'Google Maps',
    });
    expect(spotLink({ name: 'Zuni', city: 'SF' }).href).toBe('https://www.google.com/maps/search/?api=1&query=Zuni%20SF');
    expect(spotLink({ placeId: 'bgg:266192', name: 'Wingspan' })).toEqual({
      href: 'https://boardgamegeek.com/boardgame/266192',
      label: 'BGG',
      site: 'BoardGameGeek',
    });
    expect(spotLink({ placeId: 'igdb:113112', name: 'Hades' }).href).toBe('https://www.igdb.com/search?q=Hades');
    expect(spotLink({ placeId: 'book:weir:project-hail-mary', name: 'Project Hail Mary', media: { creator: 'Andy Weir' } })).toEqual({
      href: 'https://www.google.com/search?tbm=bks&q=Project%20Hail%20Mary%20Andy%20Weir',
      label: 'Books',
      site: 'Google Books',
    });
  });
});

describe('spotPlaceLabel', () => {
  it('is the neighborhood or city of a place, or the year and director of a title', () => {
    expect(spotPlaceLabel({ neighborhood: 'Mission', city: 'SF' })).toBe('Mission');
    expect(spotPlaceLabel({ city: 'SF' })).toBe('SF');
    expect(spotPlaceLabel({ placeId: 'tmdb:movie:1', media: { year: 1999 } })).toBe('1999');
    expect(spotPlaceLabel({ placeId: 'tmdb:movie:1' })).toBeUndefined();
  });
});

describe('media helpers', () => {
  it('builds poster URLs and subtitles, and parses stored media', () => {
    expect(posterUrl({ poster: '/d.jpg' }, 185)).toBe('https://image.tmdb.org/t/p/w185/d.jpg');
    expect(posterUrl(undefined)).toBeUndefined();
    expect(posterUrl({ poster: 'https://books.google.com/c' }, 185)).toBe('https://books.google.com/c');
    expect(parseMedia({ poster: 'https://books.google.com/c' })).toEqual({ poster: 'https://books.google.com/c' });
    expect(mediaSubtitle({ creator: 'Greta Gerwig' })).toBe('Greta Gerwig');
    expect(parseMedia({ year: 2023, poster: '/b.jpg', creator: 'Greta Gerwig', extra: 1 })).toEqual({
      year: 2023,
      poster: '/b.jpg',
      creator: 'Greta Gerwig',
    });
    expect(parseMedia({ year: '2023', poster: 'http://evil' })).toBeUndefined();
    expect(parseMedia(null)).toBeUndefined();
  });
});

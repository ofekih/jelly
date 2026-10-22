import { describe, expect, it } from 'vitest';
import { bookToCandidate, mediaSubtitle, parseMedia, posterUrl, spotLink, spotPlaceLabel, titleToCandidate } from './media';

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

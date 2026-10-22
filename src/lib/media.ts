import type { BookResult, MediaInfo, PlaceCandidate, SpotGroup, TmdbTitle } from '../types';
import { isMediaPlaceId } from './tasteModel';

/**
 * Titles (the Watch and Read lists): movie & show search through the `/api/tmdb` proxy, book
 * search through `/api/books`, and the bits of UI that differ from places (a poster or cover and
 * "2021 · Director" instead of a map and an address).
 */

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

/** A TMDB poster at `width`, or a book cover (stored as a full URL, one size only) */
export function posterUrl(media: MediaInfo | undefined, width: 92 | 154 | 185 | 342 = 92): string | undefined {
  if (!media?.poster) return undefined;
  return media.poster.startsWith('https://') ? media.poster : `${TMDB_IMAGE_BASE}/w${width}${media.poster}`;
}

/** "2021 · Denis Villeneuve" */
export function mediaSubtitle(media: MediaInfo | undefined): string {
  return [media?.year, media?.creator].filter(Boolean).join(' · ');
}

/** The address fields of a title: its year and director stand in for the address */
export function mediaFields(media: MediaInfo | undefined): { formattedAddress: string; media?: MediaInfo } {
  return { formattedAddress: mediaSubtitle(media), ...(media ? { media } : {}) };
}

export function parseMedia(raw: unknown): MediaInfo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  const media: MediaInfo = {};
  if (typeof m.year === 'number' && Number.isInteger(m.year)) media.year = m.year;
  if (typeof m.poster === 'string' && /^(\/|https:\/\/)/.test(m.poster)) media.poster = m.poster;
  if (typeof m.creator === 'string' && m.creator) media.creator = m.creator;
  return Object.keys(media).length > 0 ? media : undefined;
}

export function titleToCandidate(title: TmdbTitle): PlaceCandidate {
  const media: MediaInfo = {};
  if (title.year) media.year = title.year;
  if (title.poster) media.poster = title.poster;
  if (title.creator) media.creator = title.creator;
  return {
    placeId: `tmdb:${title.kind}:${title.id}`,
    name: title.title,
    ...mediaFields(Object.keys(media).length > 0 ? media : undefined),
    categories: [title.kind === 'movie' ? 'movies' : 'tv_shows'],
    cuisines: title.genres,
    primaryTypeDisplay: title.kind === 'movie' ? 'Movie' : 'TV show',
    source: 'tmdb',
  };
}

export function bookToCandidate(book: BookResult): PlaceCandidate {
  // No year: Google Books only knows edition years (a 2000 reprint of The Hobbit), not first publication
  const media: MediaInfo = {};
  if (book.cover) media.poster = book.cover;
  if (book.creator) media.creator = book.creator;
  return {
    placeId: book.placeId,
    name: book.title,
    ...mediaFields(Object.keys(media).length > 0 ? media : undefined),
    categories: book.list ? [book.list] : [],
    cuisines: book.tags,
    source: 'google_books',
  };
}

/** Titles matching `query` for a title group (Watch: movies & shows, Read: books), most relevant first. */
export async function searchTitles(
  query: string,
  group: SpotGroup
): Promise<{ results: PlaceCandidate[]; error?: string }> {
  // Lowercased so the CDN serves "Dune" and "dune" from one cached response
  const q = encodeURIComponent(query.trim().replace(/\s+/g, ' ').toLowerCase());
  try {
    const res = await fetch(group === 'read' ? `/api/books/search?q=${q}` : `/api/tmdb/search?q=${q}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { results?: unknown[] };
    const results = data.results ?? [];
    return {
      results:
        group === 'read'
          ? (results as BookResult[]).map(bookToCandidate)
          : (results as TmdbTitle[]).map(titleToCandidate),
    };
  } catch (err) {
    console.warn('Title search failed', err);
    return { results: [], error: 'Search is unavailable right now. Try again in a bit.' };
  }
}

interface LinkableSpot {
  placeId?: string;
  name: string;
  formattedAddress?: string;
  city?: string;
  googleMapsUri?: string;
  media?: MediaInfo;
}

/**
 * Where to look a spot up: TMDB for a movie or show, Google Books for a book, Google Maps for a
 * place. `label` fits a small button, `site` reads "Open in <site>".
 */
export function spotLink(spot: LinkableSpot): { href: string; label: string; site: string } {
  if (spot.placeId?.startsWith('tmdb:')) {
    const [, kind, id] = spot.placeId.split(':');
    return { href: `https://www.themoviedb.org/${kind}/${id}`, label: 'TMDB', site: 'TMDB' };
  }
  if (spot.placeId?.startsWith('book:')) {
    const q = encodeURIComponent([spot.name, spot.media?.creator].filter(Boolean).join(' '));
    return { href: `https://www.google.com/search?tbm=bks&q=${q}`, label: 'Books', site: 'Google Books' };
  }
  return {
    href:
      spot.googleMapsUri ||
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${spot.name} ${spot.formattedAddress || spot.city || ''}`
      )}`,
    label: 'Maps',
    site: 'Google Maps',
  };
}

/** The short "where" of a spot: its neighborhood or city, or a title's year and director */
export function spotPlaceLabel(spot: {
  placeId?: string;
  neighborhood?: string;
  city?: string;
  formattedAddress?: string;
  media?: MediaInfo;
}): string | undefined {
  if (isMediaPlaceId(spot.placeId) || spot.media) return mediaSubtitle(spot.media) || undefined;
  return spot.neighborhood || spot.city || undefined;
}

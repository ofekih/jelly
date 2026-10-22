import type { MediaInfo, PlaceCandidate, TmdbTitle } from '../types';
import { isMediaPlaceId } from './tasteModel';

/**
 * Movies & shows (the Watch lists): TMDB search through the `/api/tmdb` proxy, and the bits of
 * UI that differ from places (a poster and "2021 · Director" instead of a map and an address).
 */

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export function posterUrl(media: MediaInfo | undefined, width: 92 | 154 | 185 | 342 = 92): string | undefined {
  return media?.poster ? `${TMDB_IMAGE_BASE}/w${width}${media.poster}` : undefined;
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
  if (typeof m.poster === 'string' && m.poster.startsWith('/')) media.poster = m.poster;
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

/** Movies and shows matching `query`, most relevant first. */
export async function searchTitles(query: string): Promise<{ results: PlaceCandidate[]; error?: string }> {
  // Lowercased so the CDN serves "Dune" and "dune" from one cached response
  const q = query.trim().replace(/\s+/g, ' ').toLowerCase();
  try {
    const res = await fetch(`/api/tmdb/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { results?: TmdbTitle[] };
    return { results: (data.results ?? []).map(titleToCandidate) };
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
}

/** Where to look a spot up: its TMDB page for a title, Google Maps for a place */
export function spotLink(spot: LinkableSpot): { href: string; label: string } {
  if (isMediaPlaceId(spot.placeId)) {
    const [, kind, id] = spot.placeId!.split(':');
    return { href: `https://www.themoviedb.org/${kind}/${id}`, label: 'TMDB' };
  }
  return {
    href:
      spot.googleMapsUri ||
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${spot.name} ${spot.formattedAddress || spot.city || ''}`
      )}`,
    label: 'Maps',
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

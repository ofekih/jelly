import type { BookResult, GameResult, MediaInfo, PlaceCandidate, SpotCategory, TmdbTitle } from '../types';
import { isMediaPlaceId } from './tasteModel';

/**
 * Titles (the Watch, Read and Play lists): searches through the `/api/tmdb`, `/api/books`,
 * `/api/bgg` and `/api/igdb` proxies, and the bits of UI that differ from places (a poster or
 * cover and "2021 · Director" instead of a map and an address).
 */

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

/** Board game boxes are mostly square (and some BGG images are landscape photos), so their frame is too */
export const hasSquareCover = (placeId?: string): boolean => Boolean(placeId?.startsWith('bgg:'));

/** A TMDB poster at `width`, or a book cover (stored as a full URL, one size only) */
export function posterUrl(media: MediaInfo | undefined, width: 92 | 154 | 185 | 342 = 92): string | undefined {
  if (!media?.poster) return undefined;
  return media.poster.startsWith('https://') ? media.poster : `${TMDB_IMAGE_BASE}/w${width}${media.poster}`;
}

const span = (r: number[] | undefined): string | undefined =>
  r && r.length === 2 ? (r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`) : undefined;

/** "1–5 players" */
export function playersLabel(media: MediaInfo | undefined): string | undefined {
  const s = span(media?.players);
  return s ? `${s} player${s === '1' ? '' : 's'}` : undefined;
}

/** "40–70 min" */
export function timeLabel(media: MediaInfo | undefined): string | undefined {
  const s = span(media?.time);
  return s ? `${s} min` : undefined;
}

/** "2021 · Denis Villeneuve", or for a board game "2019 · 1–5 players · 40–70 min" */
export function mediaSubtitle(media: MediaInfo | undefined): string {
  const parts = media?.players ? [media.year, playersLabel(media), timeLabel(media)] : [media?.year, media?.creator];
  return parts.filter(Boolean).join(' · ');
}

/** The rest of a board game's details: "Best with 3 · Complexity 2.5/5 · Elizabeth Hargrave" */
export function gameFacts(media: MediaInfo | undefined): string {
  if (!media?.players) return '';
  const best = span(media.best);
  return [best && `Best with ${best}`, media.weight && `Complexity ${media.weight}/5`, media.creator]
    .filter(Boolean)
    .join(' · ');
}

/** Whether a board game plays at this player count (anything else always does) */
export function fitsPlayers(media: MediaInfo | undefined, players: number): boolean {
  const r = media?.players;
  return !r || (r[0] <= players && players <= r[1]);
}

/** Whether a board game can be played within this many minutes (anything else always can) */
export function fitsTime(media: MediaInfo | undefined, minutes: number): boolean {
  const r = media?.time;
  return !r || r[0] <= minutes;
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
  for (const key of ['players', 'best', 'time'] as const) {
    const r = m[key];
    if (Array.isArray(r) && r.length === 2 && r.every((n) => Number.isInteger(n) && n > 0)) media[key] = r as number[];
  }
  if (typeof m.weight === 'number' && m.weight > 0 && m.weight <= 5) media.weight = m.weight;
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

export function gameToCandidate(game: GameResult, category: 'board_games' | 'video_games'): PlaceCandidate {
  const media: MediaInfo = {};
  if (game.year) media.year = game.year;
  if (game.cover) media.poster = game.cover;
  if (game.creator) media.creator = game.creator;
  if (game.players) media.players = game.players;
  if (game.best) media.best = game.best;
  if (game.time) media.time = game.time;
  if (game.weight) media.weight = game.weight;
  return {
    placeId: game.placeId,
    name: game.title,
    ...mediaFields(Object.keys(media).length > 0 ? media : undefined),
    categories: [category],
    cuisines: game.tags,
    source: category === 'board_games' ? 'bgg' : 'igdb',
  };
}

/** Which search a title list uses */
function searchSource(category: SpotCategory): 'tmdb' | 'books' | 'bgg' | 'igdb' {
  if (category === 'fiction' || category === 'nonfiction') return 'books';
  if (category === 'board_games') return 'bgg';
  if (category === 'video_games') return 'igdb';
  return 'tmdb';
}

/** Titles matching `query` for a title list, most relevant first (movies & shows search together). */
export async function searchTitles(
  query: string,
  category: SpotCategory
): Promise<{ results: PlaceCandidate[]; error?: string }> {
  // Lowercased so the CDN serves "Dune" and "dune" from one cached response
  const q = encodeURIComponent(query.trim().replace(/\s+/g, ' ').toLowerCase());
  const source = searchSource(category);
  try {
    const res = await fetch(`/api/${source}/search?q=${q}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { results?: unknown[] };
    const results = data.results ?? [];
    return {
      results:
        source === 'books'
          ? (results as BookResult[]).map(bookToCandidate)
          : source === 'bgg' || source === 'igdb'
          ? (results as GameResult[]).map((g) => gameToCandidate(g, source === 'bgg' ? 'board_games' : 'video_games'))
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
 * Where to look a spot up: TMDB for a movie or show, Google Books for a book, BoardGameGeek or IGDB
 * for a game, Google Maps for a place. `label` fits a small button, `site` reads "Open in <site>".
 */
export function spotLink(spot: LinkableSpot): { href: string; label: string; site: string } {
  if (spot.placeId?.startsWith('tmdb:')) {
    const [, kind, id] = spot.placeId.split(':');
    return { href: `https://www.themoviedb.org/${kind}/${id}`, label: 'TMDB', site: 'TMDB' };
  }
  if (spot.placeId?.startsWith('bgg:')) {
    return { href: `https://boardgamegeek.com/boardgame/${spot.placeId.slice(4)}`, label: 'BGG', site: 'BoardGameGeek' };
  }
  if (spot.placeId?.startsWith('igdb:')) {
    return { href: `https://www.igdb.com/search?q=${encodeURIComponent(spot.name)}`, label: 'IGDB', site: 'IGDB' };
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

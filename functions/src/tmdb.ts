/**
 * Movie & TV search for the Watch lists, proxied so the TMDB token stays server-side and
 * repeat searches are served from the Hosting CDN (`/api/tmdb/search?q=` rewrites here).
 */
import type { TmdbTitle } from '../../src/types';

const API = 'https://api.themoviedb.org/3';
/** Results returned per search, and how many of them get a director / creator lookup. */
const MAX_RESULTS = 10;
const MAX_DETAILED = 6;
const MAX_QUERY_LENGTH = 100;

/** TMDB genre IDs (movie and TV) → Watch tags; TV's combined genres split, the rest dropped. */
const GENRE_TAGS: Record<number, string[]> = {
  28: ['Action'],
  12: ['Adventure'],
  16: ['Animation'],
  35: ['Comedy'],
  80: ['Crime'],
  99: ['Documentary'],
  18: ['Drama'],
  10751: ['Family'],
  14: ['Fantasy'],
  36: ['History'],
  27: ['Horror'],
  10402: ['Music'],
  9648: ['Mystery'],
  10749: ['Romance'],
  878: ['Sci-Fi'],
  53: ['Thriller'],
  10752: ['War'],
  37: ['Western'],
  10759: ['Action', 'Adventure'],
  10762: ['Family'],
  10764: ['Reality'],
  10765: ['Sci-Fi', 'Fantasy'],
  10768: ['War'],
};

export function genreTags(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.flatMap((id) => GENRE_TAGS[id as number] ?? []))];
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function yearOf(date: unknown): number | undefined {
  const year = Number(text(date)?.slice(0, 4));
  return Number.isInteger(year) && year > 1800 ? year : undefined;
}

/** A `search/multi` result as a title, or null for people and unusable rows. */
export function toTmdbTitle(raw: Record<string, unknown>): TmdbTitle | null {
  const kind = raw.media_type;
  if ((kind !== 'movie' && kind !== 'tv') || typeof raw.id !== 'number') return null;
  const title = text(kind === 'movie' ? raw.title : raw.name);
  if (!title) return null;
  const year = yearOf(kind === 'movie' ? raw.release_date : raw.first_air_date);
  const poster = text(raw.poster_path);
  // Unreleased stubs and junk entries have neither
  if (!year && !poster) return null;
  return { kind, id: raw.id, title, year, poster, genres: genreTags(raw.genre_ids) };
}

/** "A & B", or "A, B & C"; at most three names. */
function joinNames(names: string[]): string | undefined {
  const list = [...new Set(names)].slice(0, 3);
  if (list.length <= 1) return list[0];
  return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`;
}

/** Director(s) from a movie's credits, or creator(s) from a show's details. */
export function creatorOf(kind: TmdbTitle['kind'], details: Record<string, any>): string | undefined {
  const people: unknown[] =
    kind === 'movie'
      ? (details.credits?.crew ?? []).filter((p: any) => p?.job === 'Director')
      : details.created_by ?? [];
  return joinNames(people.map((p: any) => text(p?.name)).filter((n): n is string => Boolean(n)));
}

type Fetch = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export function cleanQuery(raw: unknown): string | null {
  const q = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  return q.length >= 1 && q.length <= MAX_QUERY_LENGTH ? q : null;
}

/** Movies and shows matching `query`, most relevant first, the top ones with their director / creator. */
export async function searchTitles(query: string, token: string, fetchFn: Fetch = fetch): Promise<TmdbTitle[]> {
  const get = async (path: string) => {
    const res = await fetchFn(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`TMDB ${res.status} for ${path.split('?')[0]}`);
    return res.json();
  };
  const params = new URLSearchParams({ query, include_adult: 'false', language: 'en-US', page: '1' });
  const search = await get(`/search/multi?${params}`);
  const titles = (Array.isArray(search?.results) ? search.results : [])
    .map(toTmdbTitle)
    .filter((t: TmdbTitle | null): t is TmdbTitle => t !== null)
    .slice(0, MAX_RESULTS);

  await Promise.all(
    titles.slice(0, MAX_DETAILED).map(async (title: TmdbTitle) => {
      const path = title.kind === 'movie' ? `/movie/${title.id}/credits` : `/tv/${title.id}`;
      try {
        const details = await get(`${path}?language=en-US`);
        title.creator = creatorOf(title.kind, title.kind === 'movie' ? { credits: details } : details);
      } catch {
        // The title is still useful without it
      }
    })
  );
  return titles;
}

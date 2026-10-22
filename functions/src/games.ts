/**
 * Game search for the Play lists, proxied so the BGG token and Twitch credentials stay
 * server-side and repeat searches are served from the Hosting CDN: board & card games from
 * BoardGameGeek (`/api/bgg/search?q=`), video games from IGDB (`/api/igdb/search?q=`).
 *
 * Neither ranks results by popularity, so both fetch a wider set and sort it by how many people
 * rated each game, boosted by how closely its name matches the query. IGDB's text search also
 * misses big titles ("zelda" doesn't find Breath of the Wild), so it runs next to a name-contains
 * query sorted by rating count.
 */
import { XMLParser } from 'fast-xml-parser';
import type { GameResult } from '../../src/types';

const MAX_RESULTS = 10;

type Res = { ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> };
type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Res>;

/** 3 for an exact name, 2 for a prefix, 1 when it contains the query, else 0 */
export function nameScore(name: string, query: string): number {
  const n = name.toLowerCase().trim();
  const q = query.toLowerCase().trim();
  if (n === q) return 3;
  if (n.startsWith(q)) return 2;
  return n.includes(q) ? 1 : 0;
}

/**
 * Popular games first; each step of name match (contains → prefix → exact) is worth about 6× the
 * ratings, so "hades" puts Hades above Hades II but "zelda" still puts Breath of the Wild above
 * Zelda II.
 */
function relevance(name: string, query: string, ratings: number): number {
  return Math.log10(ratings + 1) + 0.75 * nameScore(name, query);
}

function joinNames(names: string[], max = 2): string | undefined {
  const list = [...new Set(names)].slice(0, max);
  if (list.length <= 1) return list[0];
  return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`;
}

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** [min, max] when both are positive */
function range(min: unknown, max: unknown): number[] | undefined {
  const a = num(min);
  const b = num(max);
  if (!a || !b || a <= 0 || b <= 0) return undefined;
  return [Math.min(a, b), Math.max(a, b)];
}

// ---------------------------------------------------------------------------
// BoardGameGeek
// ---------------------------------------------------------------------------

const BGG = 'https://boardgamegeek.com/xmlapi2';
/** Search results looked up in detail (BGG allows 20 IDs per `thing` request) */
const BGG_CANDIDATES = 40;

/** BGG double-escapes text ("Valhalla&#039;s Gate"), so one parser pass leaves entities behind */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k[0] === '#') {
      const code = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[k] ?? m;
  });
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  // Elements only: attributes called `name` must stay plain strings
  isArray: (name, _path, _leaf, isAttribute) => !isAttribute && ['item', 'name', 'link', 'rank', 'result', 'poll-summary'].includes(name),
});

const BGG_FAMILY_TAGS: Record<string, string> = {
  strategygames: 'Strategy',
  familygames: 'Family',
  partygames: 'Party',
  thematic: 'Thematic',
  abstracts: 'Abstract',
  wargames: 'Wargame',
  childrensgames: 'Kids',
};
const BGG_CATEGORY_TAGS: Record<string, string> = {
  'Card Game': 'Card Game',
  'Party Game': 'Party',
  'Action / Dexterity': 'Dexterity',
  Deduction: 'Deduction',
  'Word Game': 'Word',
  "Children's Game": 'Kids',
  Wargame: 'Wargame',
  'Abstract Strategy': 'Abstract',
};
const BGG_MECHANIC_TAGS: Record<string, string> = {
  'Cooperative Game': 'Co-op',
  'Solo / Solitaire Game': 'Solo',
  'Deck, Bag, and Pool Building': 'Deck Building',
  'Worker Placement': 'Worker Placement',
  'Legacy Game': 'Legacy',
};

/** "Best with 3 players" → [3, 3], "Best with 3–4 players" → [3, 4]; undefined when undetermined */
export function bestPlayers(text: unknown): number[] | undefined {
  const nums = String(text ?? '').match(/\d+/g)?.map(Number) ?? [];
  return nums.length > 0 ? [Math.min(...nums), Math.max(...nums)] : undefined;
}

const value = (node: any): any => node?.value;

/** A BGG `thing` item as a game, or null for expansions, accessories and unnamed items. */
export function toBoardGame(item: any): (GameResult & { ratings: number }) | null {
  if (item?.type !== 'boardgame') return null;
  const links: any[] = item.link ?? [];
  const valuesOf = (type: string): string[] => links.filter((l) => l.type === type).map((l) => decodeEntities(String(l.value)));
  const categories = valuesOf('boardgamecategory');
  if (categories.includes('Expansion for Base-game')) return null;
  const rawTitle = (item.name ?? []).find((n: any) => n.type === 'primary')?.value;
  if (!rawTitle) return null;
  const title = decodeEntities(String(rawTitle));

  const ratings = item.statistics?.ratings ?? {};
  const families: string[] = (ratings.ranks?.rank ?? []).filter((r: any) => r.type === 'family').map((r: any) => String(r.name));
  const tags = [
    ...families.map((f) => BGG_FAMILY_TAGS[f]),
    ...categories.map((c) => BGG_CATEGORY_TAGS[c]),
    ...valuesOf('boardgamemechanic').map((m) => BGG_MECHANIC_TAGS[m]),
  ].filter((t): t is string => Boolean(t));
  const summary = (item['poll-summary'] ?? []).find((p: any) => p.name === 'suggested_numplayers');
  const best = (summary?.result ?? []).find((r: any) => r.name === 'bestwith');
  const weight = num(value(ratings.averageweight));
  const year = num(value(item.yearpublished));

  return {
    placeId: `bgg:${item.id}`,
    title: String(title),
    year: year && year > 0 ? year : undefined,
    cover: typeof item.thumbnail === 'string' ? item.thumbnail.trim() : undefined,
    creator: joinNames(valuesOf('boardgamedesigner').filter((d) => d !== '(Uncredited)')),
    tags: [...new Set(tags)],
    players: range(value(item.minplayers), value(item.maxplayers)),
    best: bestPlayers(value(best)),
    time: range(value(item.minplaytime), value(item.maxplaytime)),
    weight: weight && weight > 0 ? Math.round(weight * 10) / 10 : undefined,
    ratings: num(value(ratings.usersrated)) ?? 0,
  };
}

/** BGG search results most worth a detailed lookup: closest names first */
export function bggCandidates(searchXml: string, query: string): string[] {
  const items: any[] = xml.parse(searchXml)?.items?.item ?? [];
  return items
    .map((item) => ({
      id: String(item.id),
      score: Math.max(0, ...(item.name ?? []).map((n: any) => nameScore(decodeEntities(String(n.value)), query))),
    }))
    .sort((a, b) => b.score - a.score || Number(a.id) - Number(b.id))
    .slice(0, BGG_CANDIDATES)
    .map((c) => c.id);
}

export async function searchBoardGames(query: string, token: string, fetchFn: Fetch = fetch): Promise<GameResult[]> {
  const get = async (path: string) => {
    const res = await fetchFn(`${BGG}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`BGG ${res.status} for ${path.split('?')[0]}`);
    return res.text();
  };
  const ids = bggCandidates(await get(`/search?${new URLSearchParams({ query, type: 'boardgame' })}`), query);
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 20) batches.push(ids.slice(i, i + 20));
  const pages = await Promise.all(batches.map((batch) => get(`/thing?id=${batch.join(',')}&stats=1`)));
  const games = pages
    .flatMap((page) => (xml.parse(page)?.items?.item ?? []) as any[])
    .map(toBoardGame)
    .filter((g): g is GameResult & { ratings: number } => g !== null);
  return games
    .sort((a, b) => relevance(b.title, query, b.ratings) - relevance(a.title, query, a.ratings))
    .slice(0, MAX_RESULTS)
    .map(({ ratings: _ratings, ...game }) => game);
}

// ---------------------------------------------------------------------------
// IGDB (video games), signed in through a Twitch app
// ---------------------------------------------------------------------------

/** Main games, standalone expansions, remakes, remasters and expanded editions (not DLC, ports, bundles, mods) */
const IGDB_GAME_TYPES = [0, 4, 8, 9, 10];

const IGDB_TAGS: Record<string, string> = {
  'Role-playing (RPG)': 'RPG',
  "Hack and slash/Beat 'em up": 'Action',
  Shooter: 'Shooter',
  Platform: 'Platformer',
  Puzzle: 'Puzzle',
  Strategy: 'Strategy',
  'Real Time Strategy (RTS)': 'Strategy',
  'Turn-based strategy (TBS)': 'Strategy',
  Tactical: 'Strategy',
  Adventure: 'Adventure',
  'Point-and-click': 'Adventure',
  Indie: 'Indie',
  Racing: 'Racing',
  Sport: 'Sports',
  Fighting: 'Fighting',
  Simulator: 'Simulation',
  Action: 'Action',
  Horror: 'Horror',
  'Open world': 'Open World',
  'Co-operative': 'Co-op',
  Multiplayer: 'Multiplayer',
  'Massively Multiplayer Online (MMO)': 'Multiplayer',
  'Battle Royale': 'Multiplayer',
  'Split screen': 'Co-op',
};

/** An IGDB game as a game, or null without a name. */
export function toVideoGame(raw: any): (GameResult & { ratings: number }) | null {
  const title = typeof raw?.name === 'string' ? raw.name.trim() : '';
  if (!title || typeof raw.id !== 'number') return null;
  const names = (list: any[] | undefined) => (list ?? []).map((x) => String(x?.name ?? ''));
  const tags = [...names(raw.genres), ...names(raw.themes), ...names(raw.game_modes)]
    .map((n) => IGDB_TAGS[n])
    .filter((t): t is string => Boolean(t));
  const developers = (raw.involved_companies ?? [])
    .filter((c: any) => c?.developer && c.company?.name)
    .map((c: any) => String(c.company.name));
  const released = num(raw.first_release_date);
  return {
    placeId: `igdb:${raw.id}`,
    title,
    year: released ? new Date(released * 1000).getUTCFullYear() : undefined,
    cover: raw.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${raw.cover.image_id}.jpg` : undefined,
    creator: joinNames(developers),
    tags: [...new Set(tags)],
    ratings: num(raw.total_rating_count) ?? 0,
  };
}

let twitchToken: { value: string; expiresAt: number } | null = null;

/** An app access token for IGDB, reused until shortly before it expires (about 60 days). */
async function igdbToken(clientId: string, clientSecret: string, fetchFn: Fetch): Promise<string> {
  if (twitchToken && twitchToken.expiresAt > Date.now() + 60_000) return twitchToken.value;
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' });
  const res = await fetchFn('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Twitch token ${res.status}`);
  const data = await res.json();
  twitchToken = { value: data.access_token, expiresAt: Date.now() + (num(data.expires_in) ?? 3600) * 1000 };
  return twitchToken.value;
}

/** Forgets the cached Twitch token (tests) */
export function resetIgdbToken(): void {
  twitchToken = null;
}

export async function searchVideoGames(
  query: string,
  clientId: string,
  clientSecret: string,
  fetchFn: Fetch = fetch
): Promise<GameResult[]> {
  const token = await igdbToken(clientId, clientSecret, fetchFn);
  const q = query.replace(/["\\]/g, ' ');
  const fields =
    'fields name,first_release_date,cover.image_id,genres.name,themes.name,game_modes.name,' +
    'involved_companies.developer,involved_companies.company.name,total_rating_count;';
  const kept = `game_type = (${IGDB_GAME_TYPES.join(',')}) & version_parent = null`;
  const run = async (body: string): Promise<any[]> => {
    const res = await fetchFn('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}`, Accept: 'application/json' },
      body,
    });
    if (res.status === 401) resetIgdbToken();
    if (!res.ok) throw new Error(`IGDB ${res.status}`);
    return res.json();
  };
  const [searched, named] = await Promise.all([
    run(`search "${q}"; ${fields} where ${kept}; limit 50;`),
    run(`${fields} where name ~ *"${q}"* & ${kept}; sort total_rating_count desc; limit 20;`),
  ]);
  const byId = new Map<number, any>();
  for (const raw of [...named, ...searched]) if (!byId.has(raw?.id)) byId.set(raw?.id, raw);
  const games = [...byId.values()]
    .map(toVideoGame)
    .filter((g): g is GameResult & { ratings: number } => g !== null);
  return games
    .sort((a, b) => relevance(b.title, query, b.ratings) - relevance(a.title, query, a.ratings))
    .slice(0, MAX_RESULTS)
    .map(({ ratings: _ratings, ...game }) => game);
}

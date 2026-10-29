/**
 * What a video game costs on Steam: the game's IGDB entry links its Steam store page, and Steam's
 * storefront API (no key) gives the current price in dollars. Served at `/api/igdb/price?id=<IGDB
 * id>`. Games not on Steam (console exclusives) have no price: there is no free source for those.
 */
import type { ItemPrice } from '../../src/types';
import { igdbToken, resetIgdbToken, type Fetch } from './games';

const STEAM_SOURCE = 1;
const STEAM_URL_RE = /store\.steampowered\.com\/app\/(\d+)/;

/** The Steam app id in an IGDB game's `external_games` / `websites`, if it has one */
export function steamAppId(game: any): string | undefined {
  for (const ext of (game?.external_games ?? []) as any[]) {
    const source = ext?.external_game_source ?? ext?.category;
    if (source === STEAM_SOURCE && /^\d+$/.test(String(ext.uid))) return String(ext.uid);
  }
  for (const site of (game?.websites ?? []) as any[]) {
    const match = typeof site?.url === 'string' ? site.url.match(STEAM_URL_RE) : null;
    if (match) return match[1];
  }
  return undefined;
}

/** Steam `appdetails` for one app (`filters=basic,price_overview`) as a price, or undefined */
export function steamPrice(appId: string, details: any): ItemPrice | undefined {
  const entry = details?.[appId];
  if (!entry?.success) return undefined;
  const data = entry.data;
  if (data?.is_free) return { source: 'steam', new: { amount: 0, currency: 'USD' } };
  const overview = data?.price_overview;
  if (!overview || overview.currency !== 'USD') return undefined;
  const final = Number(overview.final) / 100;
  const initial = Number(overview.initial) / 100;
  if (!Number.isFinite(final) || final <= 0) return undefined;
  const sale = Number.isFinite(initial) && initial > final;
  return { source: 'steam', new: { amount: final, currency: 'USD', ...(sale ? { was: initial } : {}) } };
}

/** A video game's Steam price via its IGDB entry's Steam link, or null when it isn't on Steam. */
export async function videoGamePrice(
  igdbId: string,
  clientId: string,
  clientSecret: string,
  fetchFn: Fetch = fetch
): Promise<ItemPrice | null> {
  const token = await igdbToken(clientId, clientSecret, fetchFn);
  const res = await fetchFn('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}`, Accept: 'application/json' },
    body: `fields external_games.uid,external_games.external_game_source,external_games.category,websites.url; where id = ${Number(igdbId)};`,
  });
  if (res.status === 401) resetIgdbToken();
  if (!res.ok) throw new Error(`IGDB ${res.status}`);
  const appId = steamAppId((await res.json())[0]);
  if (!appId) return null;
  const steam = await fetchFn(`https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&filters=basic,price_overview`);
  if (!steam.ok) throw new Error(`Steam ${steam.status}`);
  return steamPrice(appId, await steam.json()) ?? null;
}

/**
 * What a video game costs on Steam: the game's IGDB entry links its Steam store page, and Steam's
 * storefront API (no key) gives the current price in dollars. Served at `/api/igdb/price?id=<IGDB
 * id>`. Games not on Steam (console exclusives) have no price: there is no free source for those.
 */
import type { GamePrice } from '../../src/types';

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
export function steamPrice(appId: string, details: any): GamePrice | undefined {
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

/**
 * What a board game costs, from BoardGameGeek's own storefront endpoints (undocumented, but they
 * are what boardgamegeek.com itself calls, and need no token): the Amazon ad for the new retail
 * price, and the Marketplace's active listings for what it goes for secondhand. Served at
 * `/api/bgg/price?id=<bgg id>`. Either half can be missing (Amazon doesn't stock everything, and
 * a few games have no listings), and a game with neither has no price.
 */
import type { GamePrice } from '../../src/types';

const GEEKDO = 'https://api.geekdo.com/api';
const USER_AGENT = 'jelly/1.0 (https://eatwithjelly.com)';
const CURRENCY = 'USD';

/** Fewer listings than this say little about a typical price */
export const MIN_USED_LISTINGS = 3;

type Res = { ok: boolean; status: number; json(): Promise<any> };
type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Res>;

/** Value at fraction `p` (0–1) of the sorted list, interpolating between neighbours */
export function quantile(sorted: number[], p: number): number {
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/** The Amazon ad's price in dollars, from `{us: {newPriceWithoutSymbol}}` (`[]` when there's no ad) */
export function newPrice(ad: any): GamePrice['new'] {
  const us = ad?.us;
  const amount = Number(us?.newPriceWithoutSymbol);
  if (!us || us.newPriceCurrency !== CURRENCY || !Number.isFinite(amount) || amount <= 0) return undefined;
  return { amount, currency: CURRENCY };
}

/** The middle half (25th–75th percentile) of active dollar listings, rounded to whole dollars */
export function usedPrice(market: any): GamePrice['used'] {
  const prices: number[] = ((market?.products ?? []) as any[])
    .filter((p) => p?.currency === CURRENCY && p.productstate === 'active')
    .map((p) => Number(p.price))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (prices.length < MIN_USED_LISTINGS) return undefined;
  const low = Math.round(quantile(prices, 0.25));
  const high = Math.round(quantile(prices, 0.75));
  return { low, high: Math.max(low, high), count: prices.length, currency: CURRENCY };
}

/** The game's price, or null when neither source knows one. Throws when both sources fail. */
export async function boardGamePrice(bggId: string, fetchFn: Fetch = fetch): Promise<GamePrice | null> {
  const id = encodeURIComponent(bggId);
  const get = async (path: string) => {
    const res = await fetchFn(`${GEEKDO}/${path}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`geekdo ${res.status} for ${path.split('?')[0]}`);
    return res.json();
  };
  const [ad, market] = await Promise.allSettled([
    get(`amazon/textads?locale=us&objectid=${id}&objecttype=thing`),
    get(`market/products?objectid=${id}&objecttype=thing`),
  ]);
  if (ad.status === 'rejected' && market.status === 'rejected') throw ad.reason;
  const price: GamePrice = {
    new: ad.status === 'fulfilled' ? newPrice(ad.value) : undefined,
    used: market.status === 'fulfilled' ? usedPrice(market.value) : undefined,
  };
  if (!price.new) delete price.new;
  if (!price.used) delete price.used;
  return price.new || price.used ? price : null;
}

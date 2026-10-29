import type { ItemPrice } from '../types';
import { formatPriceRange } from './price';

/**
 * Prices of titles (`prices/{placeId}`, filled by Cloud Functions; see `functions/src/itemPrices.ts`):
 * board games new from Amazon and used from BGG Marketplace, video games from Steam. Reading,
 * caching and the hook are in `usePrices.ts`.
 */

/** Whether a place ID could have a price doc: `<source>:<number>` (`bgg:174430`), not a place or a TMDB / book ID */
export const hasPriceDoc = (placeId?: string): placeId is string => /^[a-z]+:\d+$/.test(placeId ?? '');

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** A stored `prices` doc, or null when it says nothing is known (or is malformed). */
export function parseItemPrice(raw: unknown): ItemPrice | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const price: ItemPrice = {};
  if (r.source === 'amazon' || r.source === 'steam') price.source = r.source;
  if (isAmount(r.new?.amount) && typeof r.new.currency === 'string') {
    price.new = { amount: r.new.amount, currency: r.new.currency, ...(isAmount(r.new.was) ? { was: r.new.was } : {}) };
  }
  if (isAmount(r.used?.low) && isAmount(r.used?.high) && typeof r.used.currency === 'string') {
    price.used = { low: r.used.low, high: r.used.high, count: Number(r.used.count) || 0, currency: r.used.currency };
  }
  return price.new || price.used ? price : null;
}

/** `{ label: 'New', text: '$40' }`, `{ label: 'Used', text: '$15–27' }`, in the order shown */
export function priceParts(price: ItemPrice | null | undefined): { label: string; text: string }[] {
  const parts: { label: string; text: string }[] = [];
  if (price?.new) {
    const { amount, currency, was } = price.new;
    const at = (value: number) => formatPriceRange({ currency, start: value, end: value });
    parts.push({ label: 'New', text: amount === 0 ? 'Free' : was ? `${at(amount)} (was ${at(was)})` : at(amount) });
  }
  if (price?.used) {
    const { low, high, currency } = price.used;
    parts.push({ label: 'Used', text: formatPriceRange({ currency, start: low, end: high }) });
  }
  return parts.filter((p) => p.text);
}

/** One short line for a list row: `$40` (new, or the sale price), else `Used $15–27`; '' when unknown */
export function priceLine(price: ItemPrice | null | undefined): string {
  if (price?.new) {
    const { amount, currency } = price.new;
    return amount === 0 ? 'Free' : formatPriceRange({ currency, start: amount, end: amount });
  }
  const used = priceParts(price).find((p) => p.label === 'Used');
  return used ? `Used ${used.text}` : '';
}

/** One number to filter and sort by (dollars): the new price, else the middle of the used range. */
export function comparablePrice(price: ItemPrice | null | undefined): number | undefined {
  if (price?.new) return price.new.amount;
  return price?.used ? (price.used.low + price.used.high) / 2 : undefined;
}

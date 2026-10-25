/**
 * Prices: Google's tier (`priceLevel`: 0 = free, 1 = $ … 4 = $$$$) and, when Google knows it, the
 * typical spend per person (`priceRange`, e.g. USD 20–30, or USD 100+ with no end).
 *
 * The tier is always drawn with `$` whatever the local currency: it's a relative scale (Google
 * Maps uses it the same way), it can be set by hand for spots that have no currency at all, and a
 * list mixing `€€` and `$$` would read as two different scales. The range is real money, so it
 * uses the local currency's own symbol (`€20–30`, `CA$15–25` for a US reader).
 *
 * Dependency-free: Cloud Functions compile this file too.
 */

import type { PriceRange } from '../types';

export type { PriceRange };

export interface PriceInfo {
  priceLevel?: number;
  priceRange?: PriceRange;
}

/** Highest stored amount (in any currency: a fancy dinner in IDR or VND runs into the millions). */
export const MAX_PRICE_AMOUNT = 1_000_000_000;

const CURRENCY_RE = /^[A-Z]{3}$/;

const isAmount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_PRICE_AMOUNT;

/** A stored or received range, or undefined when malformed (same checks as `firestore.rules`). */
export function parsePriceRange(raw: unknown): PriceRange | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.currency !== 'string' || !CURRENCY_RE.test(r.currency)) return undefined;
  const start = isAmount(r.start) ? r.start : undefined;
  const end = isAmount(r.end) ? r.end : undefined;
  if (start === undefined && end === undefined) return undefined;
  if (start !== undefined && end !== undefined && end < start) return undefined;
  return {
    currency: r.currency,
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
  };
}

/** Places API (New) `priceRange` ({startPrice, endPrice} Money objects) → compact range. */
export function fromGooglePriceRange(raw: unknown): PriceRange | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { startPrice, endPrice } = raw as Record<string, any>;
  const amount = (money: any): number | undefined => {
    if (!money || typeof money !== 'object') return undefined;
    const units = Number(money.units ?? 0);
    const nanos = Number(money.nanos ?? 0);
    const value = Math.round(units + nanos / 1e9);
    return Number.isFinite(value) ? value : undefined;
  };
  return parsePriceRange({
    currency: startPrice?.currencyCode ?? endPrice?.currencyCode,
    start: amount(startPrice),
    end: amount(endPrice),
  });
}

/** Places API (New) `priceLevel` enum → 0 (free) to 4. */
export const GOOGLE_PRICE_LEVEL: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

const isTier = (level: unknown): level is number =>
  typeof level === 'number' && Number.isInteger(level) && level >= 0 && level <= 4;

/** `$$`, `Free` for 0, or '' when unknown. */
export function priceTierLabel(level?: number): string {
  if (!isTier(level)) return '';
  return level === 0 ? 'Free' : '$'.repeat(level);
}

const formatters = new Map<string, Intl.NumberFormat>();
function formatter(currency: string, locale?: string): Intl.NumberFormat | null {
  const key = `${locale ?? ''}|${currency}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        // 'symbol' is locale-aware: plain `$` for a US reader's dollars, `CA$` / `MX$` for others
        currencyDisplay: 'symbol',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
    } catch {
      return null;
    }
    formatters.set(key, f);
  }
  return f;
}

/** The amount without its currency symbol (and the space that sat next to it). */
function bareAmount(f: Intl.NumberFormat, value: number): string {
  return f
    .formatToParts(value)
    .filter((p) => p.type !== 'currency' && !(p.type === 'literal' && !p.value.trim()))
    .map((p) => p.value)
    .join('')
    .trim();
}

/** `$20–30`, `20–30 €`, `$100+`, `Under $10`; '' when there's nothing to show. */
export function formatPriceRange(range: PriceRange | undefined, locale?: string): string {
  const r = parsePriceRange(range);
  if (!r) return '';
  const f = formatter(r.currency, locale);
  if (!f) return '';
  const { start, end } = r;
  if (start !== undefined && end !== undefined && end > start) {
    // One symbol, on whichever side the locale puts it: `$20–30` (en), `20–30 €` (de)
    const symbolFirst = f.formatToParts(start).findIndex((p) => p.type === 'currency') <
      f.formatToParts(start).findIndex((p) => p.type === 'integer');
    return symbolFirst ? `${f.format(start)}–${bareAmount(f, end)}` : `${bareAmount(f, start)}–${f.format(end)}`;
  }
  if (start !== undefined && (end === undefined || end === start)) {
    return end === undefined ? `${f.format(start)}+` : f.format(start);
  }
  return `Under ${f.format(end!)}`;
}

/**
 * The price as one short line: `$$`, `$$ · $20–30`, `$100+`, `Free`. `compact` gives the tier
 * alone when there is one (list rows), falling back to the range.
 */
export function formatPrice(info: PriceInfo, options: { compact?: boolean; locale?: string } = {}): string {
  const tier = priceTierLabel(info.priceLevel);
  if (options.compact && tier) return tier;
  // A free spot has no spend to show
  const range = info.priceLevel === 0 ? '' : formatPriceRange(info.priceRange, options.locale);
  return [tier, range].filter(Boolean).join(' · ');
}

/**
 * Price facts after fresh place data (re-ranking from search, the one-time range lookup) meets
 * what's stored. A stored tier wins (it may have been set by hand), and a fresh range is only
 * taken when it came with that same tier, so a range never contradicts the tier shown next to it.
 */
export function mergePrice(stored: PriceInfo | undefined, fresh: PriceInfo): PriceInfo {
  if (!stored) return { priceLevel: fresh.priceLevel, priceRange: fresh.priceRange };
  const priceLevel = stored.priceLevel ?? fresh.priceLevel;
  const freshFits = fresh.priceRange !== undefined && fresh.priceLevel === priceLevel;
  return { priceLevel, priceRange: freshFits ? fresh.priceRange : stored.priceRange };
}

/** Whether a place ID came from Google Places (not a manual, OpenStreetMap or title entry). */
export function isGooglePlaceId(placeId?: string): placeId is string {
  return (
    typeof placeId === 'string' &&
    /^[A-Za-z0-9_-]{10,}$/.test(placeId) &&
    !/^(manual|osm|g|bm)_/.test(placeId)
  );
}

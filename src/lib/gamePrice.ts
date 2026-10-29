import { useEffect, useState } from 'react';
import type { GamePrice } from '../types';
import { formatPriceRange } from './price';

/**
 * Board game prices (new from Amazon, used from BGG Marketplace) via `/api/bgg/price`. Fetched when
 * a game's sheet opens, never stored: prices move, and the endpoint is CDN-cached for a day.
 */

/** The BGG ID of a `bgg:<id>` place ID, else undefined (video games and places have no price here) */
export function bggIdOf(placeId?: string): string | undefined {
  return placeId?.match(/^bgg:(\d+)$/)?.[1];
}

/** `{ label: 'New', text: '$40' }`, `{ label: 'Used', text: '$15–27' }`, in the order shown */
export function gamePriceParts(price: GamePrice | null | undefined): { label: string; text: string }[] {
  const parts: { label: string; text: string }[] = [];
  if (price?.new) {
    parts.push({ label: 'New', text: formatPriceRange({ currency: price.new.currency, start: price.new.amount, end: price.new.amount }) });
  }
  if (price?.used) {
    const { low, high, currency } = price.used;
    parts.push({ label: 'Used', text: formatPriceRange({ currency, start: low, end: high }) });
  }
  return parts.filter((p) => p.text);
}

const cache = new Map<string, Promise<GamePrice | null>>();

/** One request per game per page load; a failure is forgotten so the next open tries again. */
export function fetchGamePrice(bggId: string): Promise<GamePrice | null> {
  let request = cache.get(bggId);
  if (!request) {
    request = fetch(`/api/bgg/price?id=${bggId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`price ${res.status}`);
        return res.json();
      })
      .then((data) => (data?.price ?? null) as GamePrice | null);
    request.catch(() => cache.delete(bggId));
    cache.set(bggId, request);
  }
  return request;
}

/** A board game's price: undefined while loading, null when unknown (or the request failed). */
export function useGamePrice(placeId: string | undefined): GamePrice | null | undefined {
  const id = bggIdOf(placeId);
  const [state, setState] = useState<{ id?: string; price: GamePrice | null }>({ price: null });
  useEffect(() => {
    if (!id) return;
    let live = true;
    fetchGamePrice(id)
      .then((price) => live && setState({ id, price }))
      .catch(() => live && setState({ id, price: null }));
    return () => {
      live = false;
    };
  }, [id]);
  if (!id) return null;
  return state.id === id ? state.price : undefined;
}

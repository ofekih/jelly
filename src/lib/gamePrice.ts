import { useEffect, useState } from 'react';
import type { GamePrice } from '../types';
import { formatPriceRange } from './price';

/**
 * Game prices via `/api/{bgg,igdb}/price`: board games new from Amazon and used from BGG Marketplace, video games from Steam. Fetched when
 * a game's sheet opens, never stored: prices move, and the endpoint is CDN-cached for a day.
 */

/** Which price endpoint knows a game (`bgg:<id>` or `igdb:<id>`); places and titles have none */
export function priceTarget(placeId?: string): { api: 'bgg' | 'igdb'; id: string } | undefined {
  const match = placeId?.match(/^(bgg|igdb):(\d+)$/);
  return match ? { api: match[1] as 'bgg' | 'igdb', id: match[2] } : undefined;
}

/** `{ label: 'New', text: '$40' }`, `{ label: 'Used', text: '$15–27' }`, in the order shown */
export function gamePriceParts(price: GamePrice | null | undefined): { label: string; text: string }[] {
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

const cache = new Map<string, Promise<GamePrice | null>>();

/** One request per game per page load; a failure is forgotten so the next open tries again. */
export function fetchGamePrice(placeId: string): Promise<GamePrice | null> {
  const target = priceTarget(placeId);
  if (!target) return Promise.resolve(null);
  let request = cache.get(placeId);
  if (!request) {
    request = fetch(`/api/${target.api}/price?id=${target.id}`)
      .then((res) => {
        if (!res.ok) throw new Error(`price ${res.status}`);
        return res.json();
      })
      .then((data) => (data?.price ?? null) as GamePrice | null);
    request.catch(() => cache.delete(placeId));
    cache.set(placeId, request);
  }
  return request;
}

/** A board game's price: undefined while loading, null when unknown (or the request failed). */
export function useGamePrice(placeId: string | undefined): GamePrice | null | undefined {
  const id = priceTarget(placeId) ? placeId : undefined;
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

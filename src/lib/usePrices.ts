import { useCallback, useEffect, useState } from 'react';
import { collection, documentId, getDocs, query, where, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import type { ItemPrice } from '../types';
import { hasPriceDoc, parseItemPrice } from './itemPrices';

const IN_QUERY_LIMIT = 30;
const STALE_MS = 10 * 60 * 1000;
/** Lookups asked for in the same tick (every row of a list) go out as one batch */
const BATCH_DELAY_MS = 0;

/** Reads `prices` docs by ID; titles with no price (or no doc yet) map to null. */
export async function fetchPrices(firestore: Firestore, placeIds: string[]): Promise<Record<string, ItemPrice | null>> {
  const unique = [...new Set(placeIds)];
  const result: Record<string, ItemPrice | null> = Object.fromEntries(unique.map((id) => [id, null]));
  for (let i = 0; i < unique.length; i += IN_QUERY_LIMIT) {
    const ids = unique.slice(i, i + IN_QUERY_LIMIT);
    const snap = await getDocs(query(collection(firestore, 'prices'), where(documentId(), 'in', ids)));
    snap.forEach((d) => {
      result[d.id] = parseItemPrice(d.data());
    });
  }
  return result;
}

// Shared across components so a list's rows, its filter and a sheet read each price once
const cache = new Map<string, { price: ItemPrice | null; at: number }>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

function flush(): void {
  timer = undefined;
  const ids = [...pending];
  pending.clear();
  ids.forEach((id) => inFlight.add(id));
  fetchPrices(db, ids)
    .then((result) => {
      const at = Date.now();
      for (const id of ids) cache.set(id, { price: result[id] ?? null, at });
    })
    .catch((err) => console.error('Failed to load prices:', err))
    .finally(() => {
      ids.forEach((id) => inFlight.delete(id));
      listeners.forEach((listener) => listener());
    });
}

function request(ids: string[]): void {
  const now = Date.now();
  for (const id of ids) {
    const cached = cache.get(id);
    if (inFlight.has(id) || pending.has(id) || (cached && now - cached.at <= STALE_MS)) continue;
    pending.add(id);
  }
  if (pending.size > 0 && timer === undefined) timer = setTimeout(flush, BATCH_DELAY_MS);
}

/**
 * Loads the prices of `placeIds` (anything that can't have one is skipped) and returns a lookup: a
 * price, null when none is known, or undefined while loading.
 */
export function usePrices(placeIds: Array<string | undefined>): (placeId: string | undefined) => ItemPrice | null | undefined {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const joined = [...new Set(placeIds.filter(hasPriceDoc))].sort().join('|');
  useEffect(() => {
    if (joined) request(joined.split('|'));
  }, [joined]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((placeId: string | undefined) => (hasPriceDoc(placeId) ? cache.get(placeId)?.price : null), [version]);
}

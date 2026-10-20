import { useCallback, useEffect, useState } from 'react';
import { db } from '../firebase';
import { CommunityStat } from './friendsService';
import { fetchPlaceStats } from './socialService';

// Shared across components so each stat is read at most once per few minutes
const STALE_MS = 3 * 60 * 1000;
const cache = new Map<string, { stat: CommunityStat | null; at: number }>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();

function request(keys: string[], force = false): void {
  const now = Date.now();
  const need = [...new Set(keys)].filter((key) => {
    if (inFlight.has(key)) return false;
    const cached = cache.get(key);
    return force || !cached || now - cached.at > STALE_MS;
  });
  if (need.length === 0) return;
  need.forEach((key) => inFlight.add(key));
  fetchPlaceStats(db, need)
    .then((result) => {
      const at = Date.now();
      for (const key of need) cache.set(key, { stat: result[key] ?? null, at });
    })
    .catch((err) => console.error('Failed to load community stats:', err))
    .finally(() => {
      need.forEach((key) => inFlight.delete(key));
      listeners.forEach((listener) => listener());
    });
}

/**
 * Re-reads stats after the Cloud Function has had time to fold in the user's own new scores.
 */
export function refreshPlaceStatsSoon(keys: string[], delayMs = 6000): void {
  if (keys.length === 0) return;
  setTimeout(() => request(keys, true), delayMs);
}

/**
 * Loads `placeStats` for `keys` and returns a lookup: a stat, null when nobody has ranked the
 * spot yet, or undefined while loading.
 */
export function usePlaceStats(keys: string[]): (key: string | null) => CommunityStat | null | undefined {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const joined = [...new Set(keys)].sort().join('|');
  useEffect(() => {
    if (joined) request(joined.split('|'));
  }, [joined]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((key: string | null) => (key ? cache.get(key)?.stat : undefined), [version]);
}

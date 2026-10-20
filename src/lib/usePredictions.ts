import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { SpotCategory } from '../types';
import { parsePredictionsDoc, PREDICTIONS_COLLECTION, PREDICTIONS_DOC_ID, type StoredPrediction } from './predictions';
import { placeStatKey } from './socialService';
import type { TastePrediction } from './tasteModel';

// One subscription for the signed-in user, shared by every component that shows predictions
let predictions = new Map<string, StoredPrediction>();
let loaded = false;
const listeners = new Set<() => void>();

function publish(next: Map<string, StoredPrediction>, isLoaded: boolean): void {
  predictions = next;
  loaded = isLoaded;
  listeners.forEach((listener) => listener());
}

/** Subscribes to the user's server-side predictions (call once, from the app shell). */
export function watchPredictions(uid: string | null | undefined): () => void {
  if (!uid) {
    publish(new Map(), false);
    return () => {};
  }
  const unsub = onSnapshot(
    doc(db, 'users', uid, PREDICTIONS_COLLECTION, PREDICTIONS_DOC_ID),
    (snap) => publish(parsePredictionsDoc(snap.data()), true),
    (err) => console.error('Failed to load predictions:', err)
  );
  return () => {
    unsub();
    publish(new Map(), false);
  };
}

function usePredictionsVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return version;
}

/** Every stored prediction (for "For you"), and whether the doc has loaded yet. */
export function usePredictionMap(): { predictions: ReadonlyMap<string, StoredPrediction>; loaded: boolean } {
  const version = usePredictionsVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ predictions, loaded }), [version]);
}

type PredictionSpot = { placeId?: string; category?: SpotCategory; categories?: SpotCategory[] };

/** Lookup of the server prediction for a spot (in its list, or the list it fits best). */
export function usePredictions(): (spot: PredictionSpot | null | undefined) => TastePrediction | null {
  const version = usePredictionsVersion();
  return useCallback(
    (spot: PredictionSpot | null | undefined) => {
      if (!spot) return null;
      const key = placeStatKey(spot.placeId, spot.category ?? spot.categories?.[0]);
      return (key && predictions.get(key)) || null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]
  );
}

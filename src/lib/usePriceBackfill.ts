import { useEffect, useRef } from 'react';
import type { RestaurantEntry } from '../types';
import { showsPrice } from './groups';
import { fetchPlacePrice } from './placesService';
import { isGooglePlaceId, mergePrice, type PriceInfo } from './price';

/**
 * Spots saved before price ranges were stored get theirs the first time their detail sheet opens:
 * one Place Details call asking for just `priceLevel,priceRange` (Place Details Enterprise: 1,000
 * free a month, then $0.02 each), saved on the entry. Each place is asked about once per device,
 * found or not, so reopening a sheet never calls again.
 */
const CHECKED_KEY = 'jelly_price_checked_v1';
const MAX_CHECKED = 3000;

const checkedThisSession = new Set<string>();

function readChecked(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CHECKED_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function wasChecked(placeId: string): boolean {
  return checkedThisSession.has(placeId) || readChecked().includes(placeId);
}

function markChecked(placeId: string, checked: boolean): void {
  if (checked) checkedThisSession.add(placeId);
  else checkedThisSession.delete(placeId);
  try {
    const rest = readChecked().filter((id) => id !== placeId);
    const next = checked ? [...rest, placeId].slice(-MAX_CHECKED) : rest;
    localStorage.setItem(CHECKED_KEY, JSON.stringify(next));
  } catch {
    // The session set still stops repeats
  }
}

/** Whether a spot is missing a range that Google might know (and hasn't been asked about yet). */
export function needsPriceLookup(spot: RestaurantEntry): spot is RestaurantEntry & { placeId: string } {
  return !spot.priceRange && spot.priceLevel !== 0 && !spot.media && showsPrice(spot.category) && isGooglePlaceId(spot.placeId);
}

export function usePriceBackfill(
  spot: RestaurantEntry | null,
  enabled: boolean,
  onPrice: (id: string, price: PriceInfo) => void
): void {
  const onPriceRef = useRef(onPrice);
  useEffect(() => {
    onPriceRef.current = onPrice;
  });

  useEffect(() => {
    if (!enabled || !spot || !needsPriceLookup(spot) || wasChecked(spot.placeId)) return;
    const { id, placeId } = spot;
    markChecked(placeId, true);
    // Not cancelled when the sheet closes: the answer is still worth saving
    void fetchPlacePrice(placeId).then((fresh) => {
      if (!fresh) {
        markChecked(placeId, false); // Failed (offline, quota): try again another time
        return;
      }
      const merged = mergePrice(spot, fresh);
      if (merged.priceLevel !== spot.priceLevel || merged.priceRange !== spot.priceRange) {
        onPriceRef.current(id, merged);
      }
    });
  }, [spot, enabled]);
}

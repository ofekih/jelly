import { isSpotCategory, type BookmarkEntry, type PredictionPlace, type SpotCategory } from '../types';
import { normalizeName, type PredictionConfidence, type TastePrediction } from './tasteModel';

/**
 * `users/{uid}/private/predictions`: taste predictions from every jelly user (not just the
 * friends you follow), computed by the `predictions` Cloud Functions. Owner-read only.
 * Shape: `{ spots: { [placeId__category]: TastePrediction & { place } }, updatedAt }`.
 */
export const PREDICTIONS_COLLECTION = 'private';
export const PREDICTIONS_DOC_ID = 'predictions';

const CONFIDENCES: PredictionConfidence[] = ['high', 'medium', 'low'];

/** A stored prediction; `place` (how to show the spot) is missing on docs from before v2.4. */
export type StoredPrediction = TastePrediction & { place?: PredictionPlace };

const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function parsePlace(raw: unknown): PredictionPlace | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Record<string, unknown>;
  const name = text(p.name);
  if (!name) return undefined;
  const lat = num(p.lat);
  const lng = num(p.lng);
  const cuisines = Array.isArray(p.cuisines) ? p.cuisines.filter((c): c is string => typeof c === 'string' && !!c) : [];
  return {
    name,
    city: text(p.city),
    neighborhood: text(p.neighborhood),
    ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
    cuisines,
  };
}

function parsePrediction(raw: unknown): StoredPrediction | null {
  if (!raw || typeof raw !== 'object') return null;
  const { score, confidence, basis, raters, place } = raw as Record<string, unknown>;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 1 || score > 10) return null;
  if (!CONFIDENCES.includes(confidence as PredictionConfidence)) return null;
  if (typeof basis !== 'string' || !basis) return null;
  return {
    score,
    confidence: confidence as PredictionConfidence,
    basis,
    raters: typeof raters === 'number' && raters >= 0 ? raters : 0,
    place: parsePlace(place),
  };
}

/** Valid predictions by `placeId__category` key; anything malformed is skipped. */
export function parsePredictionsDoc(data: Record<string, unknown> | undefined): Map<string, StoredPrediction> {
  const out = new Map<string, StoredPrediction>();
  const spots = data?.spots;
  if (!spots || typeof spots !== 'object') return out;
  for (const [key, raw] of Object.entries(spots as Record<string, unknown>)) {
    const prediction = parsePrediction(raw);
    if (prediction) out.set(key, prediction);
  }
  return out;
}

/** A spot in "For you": shaped like a bookmark (so it can be saved, ranked or mapped as one). */
export interface ForYouSpot extends BookmarkEntry {
  prediction: TastePrediction;
}

const CONFIDENCE_ORDER: Record<PredictionConfidence, number> = { high: 0, medium: 1, low: 2 };

/** Splits a `placeId__category` key (place IDs may themselves contain underscores). */
export function parsePredictionKey(key: string): { placeId: string; category: SpotCategory } | null {
  const at = key.lastIndexOf('__');
  if (at <= 0) return null;
  const placeId = key.slice(0, at);
  const category = key.slice(at + 2);
  return isSpotCategory(category) ? { placeId, category } : null;
}

/** Google Maps link for a place ID (the stored payload has no URL, to stay small). */
export const googleMapsLinkFor = (placeId: string, name: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${encodeURIComponent(placeId)}`;

/**
 * "For you" in one list: spots others with your taste rated that you haven't ranked yet (in this
 * list), best predicted first. Predictions from only your own history (no raters) are left out:
 * those are just your bookmarks, already in "Want to try".
 */
export function buildForYouSpots(
  predictions: ReadonlyMap<string, StoredPrediction>,
  category: SpotCategory,
  ranked: ReadonlyArray<{ placeId?: string; name: string; city?: string; category: SpotCategory }>
): ForYouSpot[] {
  // Same test as `isSameSpot`, indexed: same place ID, or same name in the same city (or no city)
  const myPlaceIds = new Set<string>();
  const myCitiesByName = new Map<string, Array<string | undefined>>();
  for (const r of ranked) {
    if (r.category !== category) continue;
    if (r.placeId && !r.placeId.startsWith('manual_')) myPlaceIds.add(r.placeId);
    const norm = normalizeName(r.name);
    if (!norm) continue;
    const cities = myCitiesByName.get(norm) ?? [];
    cities.push(r.city?.toLowerCase().trim());
    myCitiesByName.set(norm, cities);
  }
  const isRanked = (placeId: string, name: string, city?: string) => {
    if (myPlaceIds.has(placeId)) return true;
    const cities = myCitiesByName.get(normalizeName(name));
    const c = city?.toLowerCase().trim();
    return Boolean(cities?.some((mine) => !mine || !c || mine === c));
  };

  const out: ForYouSpot[] = [];
  for (const [key, prediction] of predictions) {
    const parsed = parsePredictionKey(key);
    const place = prediction.place;
    if (!parsed || parsed.category !== category || !place || prediction.raters === 0) continue;
    // The stored doc can lag behind a spot you just ranked
    if (isRanked(parsed.placeId, place.name, place.city)) continue;
    const { score, confidence, basis, raters } = prediction;
    out.push({
      id: key,
      placeId: parsed.placeId,
      name: place.name,
      formattedAddress: [place.neighborhood, place.city].filter(Boolean).join(', '),
      neighborhood: place.neighborhood,
      city: place.city,
      lat: place.lat,
      lng: place.lng,
      googleMapsUri: googleMapsLinkFor(parsed.placeId, place.name),
      category,
      categories: [category],
      cuisines: place.cuisines ?? [],
      createdAt: 0,
      updatedAt: 0,
      prediction: { score, confidence, basis, raters },
    });
  }
  return out.sort(
    (a, b) =>
      b.prediction.score - a.prediction.score ||
      CONFIDENCE_ORDER[a.prediction.confidence] - CONFIDENCE_ORDER[b.prediction.confidence] ||
      b.prediction.raters - a.prediction.raters ||
      a.name.localeCompare(b.name)
  );
}

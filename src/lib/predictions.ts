import type { PredictionConfidence, TastePrediction } from './tasteModel';

/**
 * `users/{uid}/private/predictions`: taste predictions from every jelly user (not just the
 * friends you follow), computed by the `predictions` Cloud Functions. Owner-read only.
 * Shape: `{ spots: { [placeId__category]: TastePrediction }, updatedAt }`.
 */
export const PREDICTIONS_COLLECTION = 'private';
export const PREDICTIONS_DOC_ID = 'predictions';

const CONFIDENCES: PredictionConfidence[] = ['high', 'medium', 'low'];

function parsePrediction(raw: unknown): TastePrediction | null {
  if (!raw || typeof raw !== 'object') return null;
  const { score, confidence, basis, raters } = raw as Record<string, unknown>;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 1 || score > 10) return null;
  if (!CONFIDENCES.includes(confidence as PredictionConfidence)) return null;
  if (typeof basis !== 'string' || !basis) return null;
  return {
    score,
    confidence: confidence as PredictionConfidence,
    basis,
    raters: typeof raters === 'number' && raters >= 0 ? raters : 0,
  };
}

/** Valid predictions by `placeId__category` key; anything malformed is skipped. */
export function parsePredictionsDoc(data: Record<string, unknown> | undefined): Map<string, TastePrediction> {
  const out = new Map<string, TastePrediction>();
  const spots = data?.spots;
  if (!spots || typeof spots !== 'object') return out;
  for (const [key, raw] of Object.entries(spots as Record<string, unknown>)) {
    const prediction = parsePrediction(raw);
    if (prediction) out.set(key, prediction);
  }
  return out;
}

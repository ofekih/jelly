export const LOCAL_SETTINGS_KEY = 'palatelo_settings_v2';

/** Settings persisted to localStorage (also mirrored to `users/{uid}` when signed in). */
export interface LocalSettings {
  darkMode?: boolean;
  defaultCity?: string;
  handle?: string;
  linearRatingScale?: boolean;
  useCurrentLocation?: boolean;
  lastCategory?: string; // List last viewed (its group is the one jelly opens to)
  lastSeenVersion?: string; // Newest changelog version this device has seen (local only)
}

export function readLocalSettings(): LocalSettings {
  try {
    const raw = localStorage.getItem(LOCAL_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Merges `patch` into the stored settings so unrelated keys are preserved. */
export function updateLocalSettings(patch: LocalSettings): void {
  try {
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify({ ...readLocalSettings(), ...patch }));
  } catch {
    // Ignore (storage full or unavailable)
  }
}

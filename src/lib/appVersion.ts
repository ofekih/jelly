/**
 * Detects when a newer jelly build has been deployed than the one currently running.
 *
 * Every build stamps a unique `__APP_VERSION__` into the bundle and writes the same value to
 * `/version.json` (see `vite.config.ts`). Installed PWAs can stay suspended in memory for days,
 * so we re-fetch that file and compare.
 */

export const VERSION_URL = '/version.json';

export const CURRENT_APP_VERSION: string = __APP_VERSION__;

/** True when the server reports a valid version that differs from the running one. */
export function isUpdateAvailable(current: string, remote: unknown): boolean {
  if (!remote || typeof remote !== 'object') return false;
  const version = (remote as { version?: unknown }).version;
  return typeof version === 'string' && version.length > 0 && version !== current;
}

/** Fetches `/version.json` bypassing all caches; resolves false on any network/parse error. */
export async function checkForUpdate(
  current: string = CURRENT_APP_VERSION,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  try {
    const res = await fetchImpl(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    return isUpdateAvailable(current, await res.json());
  } catch {
    return false;
  }
}

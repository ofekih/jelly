import { describe, expect, it, vi } from 'vitest';
import { checkForUpdate, isUpdateAvailable } from './appVersion';

const jsonResponse = (body: unknown, ok = true) =>
  ({ ok, json: async () => body }) as Response;

describe('isUpdateAvailable', () => {
  it('detects a different remote version', () => {
    expect(isUpdateAvailable('abc', { version: 'def' })).toBe(true);
  });

  it('ignores the same version', () => {
    expect(isUpdateAvailable('abc', { version: 'abc' })).toBe(false);
  });

  it('ignores malformed payloads', () => {
    expect(isUpdateAvailable('abc', null)).toBe(false);
    expect(isUpdateAvailable('abc', 'def')).toBe(false);
    expect(isUpdateAvailable('abc', {})).toBe(false);
    expect(isUpdateAvailable('abc', { version: '' })).toBe(false);
    expect(isUpdateAvailable('abc', { version: 42 })).toBe(false);
  });
});

describe('checkForUpdate', () => {
  it('fetches version.json without caching', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ version: 'new' }));
    await expect(checkForUpdate('old', fetchImpl)).resolves.toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^\/version\.json\?t=\d+$/);
    expect(init.cache).toBe('no-store');
  });

  it('returns false for the same version', async () => {
    await expect(checkForUpdate('v1', async () => jsonResponse({ version: 'v1' }))).resolves.toBe(false);
  });

  it('returns false on HTTP errors', async () => {
    await expect(checkForUpdate('v1', async () => jsonResponse({ version: 'v2' }, false))).resolves.toBe(false);
  });

  it('returns false when offline', async () => {
    await expect(
      checkForUpdate('v1', async () => {
        throw new TypeError('Failed to fetch');
      })
    ).resolves.toBe(false);
  });
});

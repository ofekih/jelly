import { beforeEach, describe, expect, it } from 'vitest';
import { LOCAL_SETTINGS_KEY, readLocalSettings, updateLocalSettings } from './localSettings';

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

describe('localSettings', () => {
  beforeEach(() => store.clear());

  it('returns {} when nothing or garbage is stored', () => {
    expect(readLocalSettings()).toEqual({});
    store.set(LOCAL_SETTINGS_KEY, 'not json');
    expect(readLocalSettings()).toEqual({});
    store.set(LOCAL_SETTINGS_KEY, 'null');
    expect(readLocalSettings()).toEqual({});
  });

  it('merges updates without dropping unrelated keys', () => {
    updateLocalSettings({ linearRatingScale: true, useCurrentLocation: false });
    updateLocalSettings({ darkMode: true });
    expect(readLocalSettings()).toEqual({
      linearRatingScale: true,
      useCurrentLocation: false,
      darkMode: true,
    });
  });
});

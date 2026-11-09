import type { SpotCategory } from '../../types';
import { indexedDbStore, type KeyValueStore } from './store';
import type { BucketBounds, MatchDecision, MergeState } from './types';

/**
 * Everything the user has answered for one export, saved on the device under the export's
 * fingerprint: a reload, a second try or signing in halfway asks nothing again. Plain JSON.
 */
export interface ImportSession {
  fingerprint: string;
  /** Lists the user chose to import (all by default) */
  categories?: SpotCategory[];
  includeBookmarks?: boolean;
  bounds: Partial<Record<SpotCategory, BucketBounds>>;
  /** Gut ratings by row key, per list */
  guts: Partial<Record<SpotCategory, Record<string, number>>>;
  /** The bucket merge, then the jelly merge, per list */
  bucketMerges: Partial<Record<SpotCategory, MergeState>>;
  jellyMerges: Partial<Record<SpotCategory, MergeState>>;
  decisions: Record<string, MatchDecision>;
  /** Set once the import was written, with its batch (so a second run doesn't import twice) */
  committedBatch?: string;
  updatedAt: number;
}

export function emptySession(fingerprint: string, now = Date.now()): ImportSession {
  return { fingerprint, bounds: {}, guts: {}, bucketMerges: {}, jellyMerges: {}, decisions: {}, updatedAt: now };
}

let defaultStore: KeyValueStore<ImportSession> | null = null;
const sessions = () => (defaultStore ??= indexedDbStore<ImportSession>('sessions'));

export async function loadImportSession(fingerprint: string, store = sessions()): Promise<ImportSession> {
  const saved = await store.get(fingerprint).catch(() => undefined);
  return saved?.fingerprint === fingerprint ? saved : emptySession(fingerprint);
}

export async function saveImportSession(session: ImportSession, store = sessions()): Promise<void> {
  await store.set(session.fingerprint, { ...session, updatedAt: Date.now() }).catch(() => undefined);
}

export async function clearImportSession(fingerprint: string, store = sessions()): Promise<void> {
  await store.delete(fingerprint).catch(() => undefined);
}

import { deleteApp, FirebaseApp, initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, Firestore, initializeFirestore } from 'firebase/firestore';

/**
 * Test helpers for `*.emu.test.ts` (run with `npm run test:emulator`): each "device" is its own
 * Firebase app signed in as `uid` against the Firestore emulator (real firestore.rules), with
 * its own localStorage.
 */
export const EMULATOR_PROJECT = 'demo-jelly-sync';
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';

export class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value));
  }
}

export interface Device {
  uid: string;
  db: Firestore;
  storage: MemoryStorage;
}

const apps: FirebaseApp[] = [];
let count = 0;

export function createDevice(uid: string, storage = new MemoryStorage()): Device {
  const app = initializeApp({ projectId: EMULATOR_PROJECT, apiKey: 'demo-key' }, `device-${++count}`);
  apps.push(app);
  const db = initializeFirestore(app, {});
  const [host, port] = EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, host, Number(port), { mockUserToken: { sub: uid, user_id: uid } });
  return { uid, db, storage };
}

export async function closeDevices(): Promise<void> {
  await Promise.all(apps.splice(0).map((app) => deleteApp(app)));
}

export async function clearEmulator(): Promise<void> {
  const res = await fetch(
    `http://${EMULATOR_HOST}/emulator/v1/projects/${EMULATOR_PROJECT}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw new Error(`Could not clear the Firestore emulator: ${res.status}`);
}

/** Polls `check` until it returns true (or throws after `timeoutMs`). */
export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Waits a little to give a wrong write (e.g. a re-upload) the chance to happen. */
export const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));

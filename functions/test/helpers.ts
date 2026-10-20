import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/** Admin Firestore for an emulator project (requires FIRESTORE_EMULATOR_HOST). */
export function adminDb(projectId: string): Firestore {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run via `npm run test:emulator`');
  const app: App = getApps().find((a) => a.name === projectId) ?? initializeApp({ projectId }, projectId);
  return getFirestore(app);
}

/** Deletes every document in the emulator project. */
export async function clearProject(projectId: string): Promise<void> {
  const res = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw new Error(`clear failed: ${res.status}`);
}

import { Firestore, WriteBatch, writeBatch } from 'firebase/firestore';

/** Firestore rejects `undefined` field values, so drop them before writing a doc. */
export function stripUndefined<T extends object>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/** Firestore caps a single write batch at 500 operations. */
const MAX_BATCH_WRITES = 500;

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** JSON with sorted object keys and `undefined` fields dropped, for order-insensitive equality. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .filter((k) => v[k] !== undefined)
            .map((k) => [k, v[k]])
        )
      : v
  );
}

/** Items in `next` that are new or differ from the item with the same `id` in `prev`. */
export function changedDocs<T extends { id: string }>(next: T[], prev: T[]): T[] {
  const prevById = new Map(prev.map((item) => [item.id, stableStringify(item)]));
  return next.filter((item) => prevById.get(item.id) !== stableStringify(item));
}

/**
 * Applies `ops` across as many write batches as needed to stay under the
 * per-batch limit, committing them in order.
 */
export async function commitInBatches(
  db: Firestore,
  ops: Array<(batch: WriteBatch) => void>
): Promise<void> {
  for (const group of chunk(ops, MAX_BATCH_WRITES)) {
    const batch = writeBatch(db);
    group.forEach((op) => op(batch));
    await batch.commit();
  }
}

/** `.catch` handler for fire-and-forget writes: these usually fail on a `firestore.rules` mismatch. */
export const logWriteError = (context: string) => (err: unknown) => {
  console.error(`Firestore write failed (${context}):`, err);
};

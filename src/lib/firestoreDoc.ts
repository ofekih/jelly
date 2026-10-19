/** Firestore rejects `undefined` field values, so drop them before writing a doc. */
export function stripUndefined<T extends object>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

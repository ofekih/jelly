import { describe, expect, it } from 'vitest';
import { startBoundaryMerge, answerBoundaryQuestion } from './boundaryMerge';
import { loadImportSession, saveImportSession } from './session';
import { memoryStore } from './store';
import type { ImportSession } from './session';

describe('import sessions', () => {
  it('round-trips answers by fingerprint and starts empty for another export', async () => {
    const store = memoryStore<ImportSession>();
    const s = await loadImportSession('abc', store);
    const merge = answerBoundaryQuestion(startBoundaryMerge(['a', 'b', 'c'], { firstFine: 2 }), 'lower', 1);
    await saveImportSession({ ...s, merges: { restaurants: merge }, decisions: { k: { kind: 'skip' } } }, store);
    const back = await loadImportSession('abc', store);
    expect(back.merges.restaurants).toEqual(JSON.parse(JSON.stringify(merge)));
    expect(back.decisions).toEqual({ k: { kind: 'skip' } });
    expect((await loadImportSession('other', store)).decisions).toEqual({});
  });
});

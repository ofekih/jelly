import { describe, expect, it } from 'vitest';
import { changedDocs, chunk, logWriteError, onWriteError, stripUndefined } from './firestoreDoc';

describe('stripUndefined', () => {
  it('drops undefined fields but keeps other falsy values', () => {
    expect(stripUndefined({ a: 1, b: undefined, c: null, d: 0, e: '', f: false })).toEqual({
      a: 1,
      c: null,
      d: 0,
      e: '',
      f: false,
    });
  });
});

describe('chunk', () => {
  it('splits into groups of at most `size`', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 500)).toEqual([]);
    expect(chunk(Array.from({ length: 1001 }), 500).map((c) => c.length)).toEqual([500, 500, 1]);
  });
});

describe('changedDocs', () => {
  const prev = [
    { id: 'a', score: 8, tags: ['x'] },
    { id: 'b', score: 6, tags: [] as string[] },
  ];

  it('ignores key order and undefined fields', () => {
    const next = [
      { tags: ['x'], score: 8, id: 'a', note: undefined },
      { id: 'b', score: 6, tags: [] },
    ];
    expect(changedDocs(next, prev)).toEqual([]);
  });

  it('returns new and modified items', () => {
    const next = [
      { id: 'a', score: 8, tags: ['x', 'y'] },
      { id: 'b', score: 6, tags: [] },
      { id: 'c', score: 7, tags: [] },
    ];
    expect(changedDocs(next, prev).map((d) => d.id)).toEqual(['a', 'c']);
  });
});

describe('logWriteError', () => {
  it('logs and tells every listener until it unsubscribes', () => {
    const heard: string[] = [];
    const stop = onWriteError((context) => heard.push(context));
    const error = console.error;
    console.error = () => {};
    try {
      logWriteError('save list')(new Error('permission-denied'));
      stop();
      logWriteError('after stop')(new Error('x'));
    } finally {
      console.error = error;
    }
    expect(heard).toEqual(['save list']);
  });
});

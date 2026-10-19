import { describe, expect, it } from 'vitest';
import { stripUndefined } from './firestoreDoc';

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

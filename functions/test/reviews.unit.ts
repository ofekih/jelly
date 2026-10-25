import { describe, expect, it } from 'vitest';
import { reviewSyncAction } from '../src/reviews';

describe('reviewSyncAction', () => {
  it('leaves an up-to-date review alone', () => {
    expect(reviewSyncAction(8.4, true, 8.4)).toBe('none');
  });

  it('follows the entry score when the list shifts', () => {
    expect(reviewSyncAction(7.9, true, 8.4)).toEqual({ score: 7.9 });
  });

  it('deletes the review when the spot left the list or has no usable score', () => {
    expect(reviewSyncAction(undefined, false, 8.4)).toBe('delete');
    expect(reviewSyncAction('8', true, 8.4)).toBe('delete');
    expect(reviewSyncAction(Number.NaN, true, 8.4)).toBe('delete');
  });
});

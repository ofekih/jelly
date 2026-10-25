import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import {
  cleanReviewText,
  formatReviewDate,
  parseReview,
  PlaceReview,
  REVIEW_MAX_LENGTH,
  reviewKey,
  reviewKeyForEntry,
  sortReviews,
} from './reviews';

describe('review keys', () => {
  it('match placeStats and entry IDs', () => {
    expect(reviewKey('ChIJ123', 'restaurants')).toBe('ChIJ123__restaurants');
    expect(reviewKey('tmdb:movie:1', 'movies')).toBe('tmdb:movie:1__movies');
  });

  it('skip manual spots and IDs that are not valid doc IDs', () => {
    expect(reviewKey('manual_1', 'bars')).toBeNull();
    expect(reviewKey('a/b', 'bars')).toBeNull();
    expect(reviewKey(undefined, 'bars')).toBeNull();
  });

  it('only use an entry whose ID is that key (the rules look the entry up by it)', () => {
    expect(reviewKeyForEntry({ id: 'p1__bars', placeId: 'p1', category: 'bars' })).toBe('p1__bars');
    expect(reviewKeyForEntry({ id: 'legacy_id', placeId: 'p1', category: 'bars' })).toBeNull();
  });
});

describe('cleanReviewText', () => {
  it('trims and bounds the text', () => {
    expect(cleanReviewText('  Great  ')).toBe('Great');
    expect(cleanReviewText('   ')).toBeNull();
    expect(cleanReviewText('x'.repeat(REVIEW_MAX_LENGTH))).toHaveLength(REVIEW_MAX_LENGTH);
    expect(cleanReviewText('x'.repeat(REVIEW_MAX_LENGTH + 1))).toBeNull();
  });
});

describe('parseReview', () => {
  it('reads timestamps and rejects malformed docs', () => {
    const r = parseReview('u1', { text: 'Hi', score: 8, createdAt: Timestamp.fromMillis(5), updatedAt: 9 });
    expect(r).toEqual({ uid: 'u1', text: 'Hi', score: 8, createdAt: 5, updatedAt: 9 });
    expect(parseReview('u1', { text: '', score: 8 })).toBeNull();
    expect(parseReview('u1', { text: 'Hi' })).toBeNull();
    expect(parseReview('u1', undefined)).toBeNull();
  });
});

describe('sortReviews', () => {
  const r = (uid: string, updatedAt: number): PlaceReview => ({ uid, text: uid, score: 7, createdAt: 0, updatedAt });

  it('puts yours first, then friends, newest first within each', () => {
    const sorted = sortReviews([r('a', 5), r('friend1', 1), r('me', 0), r('b', 9), r('friend2', 3)], 'me', new Set(['friend1', 'friend2']));
    expect(sorted.map((x) => x.uid)).toEqual(['me', 'friend2', 'friend1', 'b', 'a']);
  });

  it('works signed out', () => {
    expect(sortReviews([r('a', 1), r('b', 2)], null, new Set()).map((x) => x.uid)).toEqual(['b', 'a']);
  });
});

describe('formatReviewDate', () => {
  const now = new Date(2026, 9, 25, 15).getTime();
  const daysAgo = (d: number) => new Date(2026, 9, 25 - d, 10).getTime();

  it('is relative for recent reviews', () => {
    expect(formatReviewDate(daysAgo(0), now)).toBe('Today');
    expect(formatReviewDate(daysAgo(1), now)).toBe('Yesterday');
    expect(formatReviewDate(daysAgo(3), now)).toBe('3 days ago');
    expect(formatReviewDate(daysAgo(7), now)).toBe('1 week ago');
    expect(formatReviewDate(daysAgo(20), now)).toBe('2 weeks ago');
  });

  it('shows a date for older ones, with the year only when it differs', () => {
    expect(formatReviewDate(new Date(2026, 8, 1).getTime(), now)).toBe('Sep 1');
    expect(formatReviewDate(new Date(2025, 8, 1).getTime(), now)).toBe('Sep 2025');
  });
});

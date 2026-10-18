import { describe, it, expect } from 'vitest';
import { computeSwipeDownDrag, shouldDismissSwipeDown } from './useSwipeDownDismiss';

describe('useSwipeDownDismiss helpers', () => {
  it('does not drag if movement is mostly horizontal', () => {
    // dy = 10, dx = 20 -> horizontal swipe
    const result = computeSwipeDownDrag(10, 20, 0, false, false);
    expect(result.isDragging).toBe(false);
    expect(result.dragY).toBe(0);
  });

  it('does not drag if content is scrolled down (scrollTop > 0)', () => {
    // dy = 20, dx = 0, but scrollTop = 45 -> user is scrolling down inside modal
    const result = computeSwipeDownDrag(20, 0, 45, false, false);
    expect(result.isDragging).toBe(false);
    expect(result.dragY).toBe(0);
  });

  it('initiates drag downwards when vertical and at top', () => {
    const result = computeSwipeDownDrag(25, 2, 0, false, false);
    expect(result.isDragging).toBe(true);
    expect(result.dragY).toBe(25);
  });

  it('applies resistance damping for large drag values (> 160px)', () => {
    const result = computeSwipeDownDrag(260, 0, 0, false, true);
    expect(result.isDragging).toBe(true);
    // 160 + (260 - 160) * 0.45 = 160 + 45 = 205
    expect(result.dragY).toBe(205);
  });

  it('immediately drags when forceSheet is true (e.g. handle touch), even if scrollTop > 0', () => {
    const result = computeSwipeDownDrag(30, 10, 100, true, false);
    expect(result.isDragging).toBe(true);
    expect(result.dragY).toBe(30);
  });

  it('evaluates dismiss threshold correctly', () => {
    expect(shouldDismissSwipeDown(50, 80)).toBe(false);
    expect(shouldDismissSwipeDown(80, 80)).toBe(false);
    expect(shouldDismissSwipeDown(81, 80)).toBe(true);
    expect(shouldDismissSwipeDown(120, 80)).toBe(true);
  });
});

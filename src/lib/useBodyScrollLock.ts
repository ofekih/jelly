import { useEffect } from 'react';

let lockCount = 0;
let savedScrollY = 0;
let savedStyles: Partial<CSSStyleDeclaration> = {};
let touchStartX = 0;
let touchStartY = 0;

/** Whether `el` can still scroll along the gesture's axis in the gesture's direction. */
function canScroll(el: HTMLElement, dx: number, dy: number): boolean {
  const style = window.getComputedStyle(el);
  if (Math.abs(dy) >= Math.abs(dx)) {
    if (!/(auto|scroll)/.test(style.overflowY) || el.scrollHeight <= el.clientHeight) return false;
    // Finger moving down scrolls toward the top, and vice versa
    return dy > 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  }
  if (!/(auto|scroll)/.test(style.overflowX) || el.scrollWidth <= el.clientWidth) return false;
  return dx > 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
}

function onTouchStart(e: TouchEvent) {
  if (e.touches.length !== 1) return;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}

/**
 * Cancels any touch drag that isn't scrolling an inner scroll area. With the iOS keyboard open
 * the visual viewport is shorter than the layout viewport, and an uncancelled drag pans the
 * whole page past the modal even though the body itself is pinned.
 */
function onTouchMove(e: TouchEvent) {
  if (e.touches.length !== 1) return;
  // Leave text fields alone so dragging the caret / selection keeps working
  if ((e.target as HTMLElement).closest?.('input, textarea')) return;
  const dx = e.touches[0].clientX - touchStartX;
  const dy = e.touches[0].clientY - touchStartY;
  for (let el = e.target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    if (canScroll(el, dx, dy)) return;
  }
  if (e.cancelable) e.preventDefault();
}

/**
 * Freezes page scrolling while a modal is mounted. `overflow: hidden` alone doesn't stop
 * iOS Safari from scrolling the page behind a fixed overlay, so the body is pinned with
 * `position: fixed` at its current offset and restored on unlock, and stray touch drags are
 * cancelled (see `onTouchMove`). Ref-counted so stacked modals (e.g. a ConfirmModal over a
 * Sheet) don't unlock early.
 */
export function useBodyScrollLock(active = true): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;

    if (lockCount === 0) {
      const { body } = document;
      savedScrollY = window.scrollY;
      savedStyles = {
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        overflow: body.style.overflow,
      };
      body.style.position = 'fixed';
      body.style.top = `-${savedScrollY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';
      body.style.overflow = 'hidden';
      document.addEventListener('touchstart', onTouchStart, { passive: true });
      document.addEventListener('touchmove', onTouchMove, { passive: false });
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount > 0) return;
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      Object.assign(document.body.style, savedStyles);
      window.scrollTo(0, savedScrollY);
    };
  }, [active]);
}

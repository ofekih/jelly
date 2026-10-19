import { useEffect } from 'react';

let lockCount = 0;
let savedScrollY = 0;
let savedStyles: Partial<CSSStyleDeclaration> = {};

/**
 * Freezes page scrolling while a modal is mounted. `overflow: hidden` alone doesn't stop
 * iOS Safari from scrolling the page behind a fixed overlay, so the body is pinned with
 * `position: fixed` at its current offset and restored on unlock. Ref-counted so stacked
 * modals (e.g. a ConfirmModal over a Sheet) don't unlock early.
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
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount > 0) return;
      Object.assign(document.body.style, savedStyles);
      window.scrollTo(0, savedScrollY);
    };
  }, [active]);
}

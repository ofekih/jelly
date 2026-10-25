import { useEffect, useState } from 'react';

/** How far (px) the page must move in one direction before the header reacts, so small jitters don't flicker it. */
const DIRECTION_THRESHOLD = 8;

export interface ScrollChrome {
  /** The header should slide out of view (scrolling down, past the header itself) */
  hidden: boolean;
  /** The page is scrolled at all (shows the header's hairline) */
  scrolled: boolean;
}

/**
 * Native-style collapsing chrome: hides the header while scrolling down and brings it back on any
 * scroll up or near the top. Scrolls caused by a modal pinning the body (`useBodyScrollLock`) are
 * ignored, so opening and closing a sheet never flips the header.
 */
export function useScrollChrome(revealWithin = 96): ScrollChrome {
  const [state, setState] = useState<ScrollChrome>({ hidden: false, scrolled: false });

  useEffect(() => {
    let lastY = Math.max(0, window.scrollY);
    let anchorY = lastY;
    let frame = 0;
    let wasLocked = false;

    const update = () => {
      frame = 0;
      if (document.body.style.position === 'fixed') {
        wasLocked = true;
        return;
      }
      const y = Math.max(0, window.scrollY);
      if (wasLocked) {
        // The lock just restored the scroll offset: start fresh from here, keep the header as it was
        wasLocked = false;
        lastY = anchorY = y;
        return;
      }
      const goingDown = y > lastY;
      const wasGoingDown = lastY > anchorY;
      if (y !== lastY && goingDown !== wasGoingDown) anchorY = lastY;
      lastY = y;

      setState((prev) => {
        const scrolled = y > 2;
        let hidden = prev.hidden;
        if (y <= revealWithin) hidden = false;
        else if (y - anchorY > DIRECTION_THRESHOLD) hidden = true;
        else if (anchorY - y > DIRECTION_THRESHOLD) hidden = false;
        return hidden === prev.hidden && scrolled === prev.scrolled ? prev : { hidden, scrolled };
      });
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [revealWithin]);

  return state;
}

/** Scrolls the page to the top, smoothly unless the user prefers reduced motion. */
export function scrollToTop(smooth = true): void {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: smooth && !reduce ? 'smooth' : 'auto' });
}

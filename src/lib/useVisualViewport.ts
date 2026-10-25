import { useEffect, useState, type CSSProperties } from 'react';

/**
 * Pins a full-screen page to the part of the screen you can see. With the iOS keyboard up the
 * visual viewport is shorter than the layout one (and may be scrolled down a bit); sizing the page
 * to it keeps the top bar under the status bar and lets the results scroll above the keyboard
 * instead of behind it. Falls back to `inset: 0` where `visualViewport` is missing.
 */
export function useVisualViewportBox(active = true): CSSProperties | undefined {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!active || !vv) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Only follow the viewport while it's actually smaller (keyboard open); otherwise inset: 0
        const shrunk = window.innerHeight - vv.height > 1 || vv.offsetTop > 0;
        setBox((prev) => {
          const next = shrunk ? { top: Math.max(0, vv.offsetTop), height: vv.height } : null;
          if (prev?.top === next?.top && prev?.height === next?.height) return prev;
          return next;
        });
      });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);

  return box ? { top: box.top, height: box.height, bottom: 'auto' } : undefined;
}

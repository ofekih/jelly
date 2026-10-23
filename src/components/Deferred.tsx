import React, { ComponentType, lazy, LazyExoticComponent, ReactNode, Suspense, useState } from 'react';

type Preloadable<T extends ComponentType<any>> = LazyExoticComponent<T> & { preload: () => Promise<unknown> };

/** A named export loaded in its own chunk; `preload()` fetches it ahead of first use. */
export function lazyNamed<M extends Record<K, ComponentType<any>>, K extends keyof M>(
  load: () => Promise<M>,
  name: K
): Preloadable<M[K]> {
  return Object.assign(
    lazy(() => load().then((m) => ({ default: m[name] }))),
    { preload: load }
  );
}

/** Fetches every chunk once the browser is idle, so the first open doesn't wait on the network. */
export function preloadWhenIdle(components: Array<{ preload: () => Promise<unknown> }>): void {
  const run = () => components.forEach((c) => c.preload().catch(() => {}));
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}

/**
 * Renders `children` from the first time `open` is true on (and keeps them, so closing can still
 * animate). Keeps modals that are never opened out of the first download.
 */
export const MountWhenOpened: React.FC<{ open: boolean; children: ReactNode }> = ({ open, children }) => {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened ? <Suspense fallback={null}>{children}</Suspense> : null;
};

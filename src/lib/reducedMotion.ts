/** The viewer asked the OS for less motion (autoplaying demos and tour animations stay still). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

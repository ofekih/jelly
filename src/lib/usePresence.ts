import { useEffect, useState } from 'react';

/**
 * Keeps a page mounted through its exit animation: `mounted` stays true for `exitMs` after `open`
 * turns false, and `visible` drives the enter/exit class.
 */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; visible: boolean } {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, exitMs]);
  return { mounted: mounted || open, visible: open };
}

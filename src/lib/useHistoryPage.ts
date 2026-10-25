import { useCallback, useEffect, useState } from 'react';

/**
 * Open state for a full-screen page that lives in the browser history, so the Android back
 * button, the iOS back swipe and the browser's Back all close it like a native pushed screen.
 * Opening pushes an entry tagged with `key`; closing pops it (or just closes if it isn't on top).
 */
export function useHistoryPage(key: string): [open: boolean, show: () => void, hide: () => void] {
  const isOurs = useCallback(
    () => Boolean((window.history.state as Record<string, unknown> | null)?.[key]),
    [key]
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // A reload while the page was open starts back on the main screen: untag the entry
    if (isOurs()) {
      const rest = { ...(window.history.state as Record<string, unknown>) };
      delete rest[key];
      window.history.replaceState(rest, '');
    }
  }, [isOurs, key]);

  useEffect(() => {
    const onPop = () => setOpen(isOurs());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [isOurs]);

  const show = useCallback(() => {
    if (!isOurs()) window.history.pushState({ ...(window.history.state ?? {}), [key]: true }, '');
    setOpen(true);
  }, [isOurs, key]);

  const hide = useCallback(() => {
    if (isOurs()) window.history.back();
    else setOpen(false);
  }, [isOurs]);

  return [open, show, hide];
}

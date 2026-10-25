import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastState {
  message: string;
  action?: ToastAction;
}

export type ShowToast = (message: string, action?: ToastAction, durationMs?: number) => void;

/** One toast at a time; a new one replaces the last and restarts the timer. */
export function useToast(): { toast: ToastState | null; showToast: ShowToast } {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = useCallback<ShowToast>((message, action, durationMs = 3200) => {
    clearTimeout(timerRef.current);
    setToast({ message, action });
    timerRef.current = setTimeout(() => setToast(null), durationMs);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return { toast, showToast };
}

/** Subtle toast (with optional Undo-style action) */
export const Toast: React.FC<{ toast: ToastState | null }> = ({ toast }) => {
  if (!toast) return null;
  return (
    <div className="fixed bottom-[calc(var(--jelly-bottom-bar,0px)+12px)] left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold shadow-xl flex items-center gap-3 whitespace-nowrap">
      <span>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={toast.action.onClick}
          className="px-2.5 py-0.5 -mr-1 rounded-full bg-emerald-500 text-zinc-950 font-bold hover:bg-emerald-400 transition-colors"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
};

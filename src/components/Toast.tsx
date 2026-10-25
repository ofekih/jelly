import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUpDown, Check, Info, Trash2, Undo2 } from 'lucide-react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

/** Picks the small leading icon; plain messages have none. */
export type ToastKind = 'success' | 'error' | 'info' | 'removed' | 'moved' | 'restored';

export interface ToastOptions {
  action?: ToastAction;
  durationMs?: number;
  kind?: ToastKind;
}

interface ToastState {
  id: number;
  message: string;
  action?: ToastAction;
  kind?: ToastKind;
  durationMs: number;
  /** Playing the exit animation; removed right after */
  leaving: boolean;
  dismiss: () => void;
  pause: () => void;
  resume: () => void;
}

/**
 * `showToast(message, action?, durationMs?)`, or `showToast(message, { action, durationMs, kind })`.
 * Toasts with an action stay up longer by default and show a countdown.
 */
export type ShowToast = (
  message: string,
  actionOrOptions?: ToastAction | ToastOptions,
  durationMs?: number
) => void;

const DEFAULT_MS = 3200;
const DEFAULT_ACTION_MS = 6000;
const EXIT_MS = 180;

/**
 * One toast at a time; a new one replaces the last and restarts the timer. The timer pauses
 * while the toast is hovered, touched, focused or the app is in the background.
 */
export function useToast(): { toast: ToastState | null; showToast: ShowToast } {
  const [toast, setToast] = useState<ToastState | null>(null);
  const idRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const deadlineRef = useRef(0);
  const remainingRef = useRef(0);

  const dismissId = useCallback((id: number) => {
    if (idRef.current !== id) return;
    clearTimeout(timerRef.current);
    setToast((t) => (t && t.id === id ? { ...t, leaving: true } : t));
    clearTimeout(exitTimerRef.current);
    exitTimerRef.current = setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), EXIT_MS);
  }, []);

  const showToast = useCallback<ShowToast>(
    (message, actionOrOptions, durationMs) => {
      const options: ToastOptions =
        actionOrOptions && 'onClick' in actionOrOptions ? { action: actionOrOptions } : actionOrOptions ?? {};
      const action = options.action;
      const total = durationMs ?? options.durationMs ?? (action ? DEFAULT_ACTION_MS : DEFAULT_MS);
      const id = ++idRef.current;

      clearTimeout(timerRef.current);
      clearTimeout(exitTimerRef.current);
      const start = (ms: number) => {
        deadlineRef.current = Date.now() + ms;
        timerRef.current = setTimeout(() => dismissId(id), ms);
      };
      start(total);

      setToast({
        id,
        message,
        action,
        kind: options.kind,
        durationMs: total,
        leaving: false,
        dismiss: () => dismissId(id),
        pause: () => {
          if (idRef.current !== id) return;
          clearTimeout(timerRef.current);
          remainingRef.current = Math.max(0, deadlineRef.current - Date.now());
        },
        resume: () => {
          if (idRef.current !== id) return;
          clearTimeout(timerRef.current);
          start(Math.max(remainingRef.current, 1200));
        },
      });
    },
    [dismissId]
  );

  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      clearTimeout(exitTimerRef.current);
    },
    []
  );

  return { toast, showToast };
}

/*
 * Where floating notices sit: above the bottom nav bar when there is one (`--jelly-bottom-bar`
 * is the bar's height *including* the safe area, so the safe area is not added again), otherwise
 * above the home indicator; and above the update notice while that is up
 * (`--jelly-update-notice`, its height plus the gap, set by `UpdateAvailableBanner`).
 */
export const NOTICE_BOTTOM = 'calc(var(--jelly-bottom-bar, env(safe-area-inset-bottom, 0px)) + 12px)';
const TOAST_BOTTOM = `calc(var(--jelly-bottom-bar, env(safe-area-inset-bottom, 0px)) + 12px + var(--jelly-update-notice, 0px))`;

/** The frosted card shared by toasts and the update notice. */
export const NOTICE_SURFACE =
  'rounded-2xl bg-zinc-900/90 dark:bg-zinc-800/85 text-white backdrop-blur-xl backdrop-saturate-150 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.45),0_2px_6px_rgba(0,0,0,0.12)] ring-1 ring-black/5 dark:ring-white/10';

/** A text action on the dark card: accent-colored (follows the group accent), 44px tall. */
export const NOTICE_ACTION =
  'shrink-0 min-h-11 px-3 -my-1.5 rounded-xl text-[13px] font-semibold text-emerald-300 hover:bg-white/10 active:bg-white/15 transition-colors focus-visible:outline-2 focus-visible:outline-emerald-300';

const KIND_ICON: Record<ToastKind, { Icon: React.ElementType; className: string }> = {
  success: { Icon: Check, className: 'text-emerald-300 bg-emerald-400/15' },
  restored: { Icon: Undo2, className: 'text-emerald-300 bg-emerald-400/15' },
  moved: { Icon: ArrowUpDown, className: 'text-emerald-300 bg-emerald-400/15' },
  removed: { Icon: Trash2, className: 'text-zinc-300 bg-white/10' },
  info: { Icon: Info, className: 'text-sky-300 bg-sky-400/15' },
  error: { Icon: AlertCircle, className: 'text-rose-300 bg-rose-400/15' },
};

type PauseReason = 'hover' | 'touch' | 'focus' | 'hidden';
const SWIPE_DISMISS_PX = 64;

const ToastCard: React.FC<{ toast: ToastState }> = ({ toast }) => {
  const [paused, setPaused] = useState(false);
  const reasonsRef = useRef(new Set<PauseReason>());
  const [drag, setDrag] = useState<{ x: number; y: number; settling: boolean } | null>(null);
  const [flung, setFlung] = useState<{ x: number; y: number } | null>(null);
  const pointerRef = useRef<{ id: number; x: number; y: number; axis?: 'x' | 'y'; t: number } | null>(null);

  const { pause, resume } = toast;
  const setReason = useCallback(
    (reason: PauseReason, on: boolean) => {
      const reasons = reasonsRef.current;
      const was = reasons.size > 0;
      if (on) reasons.add(reason);
      else reasons.delete(reason);
      const is = reasons.size > 0;
      if (was === is) return;
      setPaused(is);
      if (is) pause();
      else resume();
    },
    [pause, resume]
  );

  // Don't let an Undo run out while the app is in the background
  useEffect(() => {
    const onVisibility = () => setReason('hidden', document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [setReason]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    if (e.pointerType !== 'mouse') setReason('touch', true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointerRef.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.axis) {
      if (Math.hypot(dx, dy) < 8) return;
      // Sideways either way, or down (away from the content above)
      p.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      // Only now: capturing on press would retarget the action button's click to the card
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    setDrag(p.axis === 'x' ? { x: dx, y: 0, settling: false } : { x: 0, y: Math.max(0, dy) + Math.min(0, dy) * 0.2, settling: false });
  };

  const endPointer = (e: React.PointerEvent, cancelled = false) => {
    const p = pointerRef.current;
    if (!p || p.id !== e.pointerId) return;
    pointerRef.current = null;
    setReason('touch', false);
    if (!p.axis) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    const dt = Math.max(1, performance.now() - p.t);
    const distance = p.axis === 'x' ? Math.abs(dx) : dy;
    const fast = distance / dt > 0.5 && distance > 24;
    if (!cancelled && (distance > SWIPE_DISMISS_PX || fast)) {
      setFlung(p.axis === 'x' ? { x: Math.sign(dx) * window.innerWidth, y: 0 } : { x: 0, y: 160 });
      toast.dismiss();
    } else {
      setDrag({ x: 0, y: 0, settling: true });
    }
  };

  const offset = flung ?? drag;
  const style: React.CSSProperties = offset
    ? {
        transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
        opacity: flung ? 0 : 1 - Math.min(0.6, Math.abs(offset.x) / 320 + offset.y / 160),
        transition: flung || drag?.settling ? 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms ease-out' : 'none',
      }
    : {};

  const icon = toast.kind ? KIND_ICON[toast.kind] : undefined;

  return (
    <div
      className={`pointer-events-auto relative flex max-w-[min(28rem,100%)] items-center gap-3 overflow-hidden touch-none select-none ${NOTICE_SURFACE} ${
        icon ? 'pl-2.5' : 'pl-4'
      } ${toast.action ? 'pr-1.5' : 'pr-4'} py-2.5 min-h-12 ${
        toast.leaving && !flung ? 'animate-jelly-toast-out' : 'animate-jelly-toast-in'
      }`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPointer(e)}
      onPointerCancel={(e) => endPointer(e, true)}
      onMouseEnter={() => setReason('hover', true)}
      onMouseLeave={() => setReason('hover', false)}
      onFocus={() => setReason('focus', true)}
      onBlur={() => setReason('focus', false)}
    >
      {icon && (
        <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${icon.className}`}>
          <icon.Icon className="w-4 h-4" strokeWidth={2.25} aria-hidden="true" />
        </span>
      )}
      <p className="min-w-0 flex-1 text-[13px] leading-snug font-medium line-clamp-3 break-words">{toast.message}</p>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            const { onClick } = toast.action!;
            // Dismiss first: the action may show a toast of its own
            toast.dismiss();
            onClick();
          }}
          className={NOTICE_ACTION}
        >
          {toast.action.label}
        </button>
      )}
      {toast.action && (
        <span
          aria-hidden="true"
          className="absolute left-0 bottom-0 h-[2px] w-full origin-left bg-emerald-300/70 animate-jelly-toast-countdown"
          style={{ animationDuration: `${toast.durationMs}ms`, animationPlayState: paused ? 'paused' : 'running' }}
        />
      )}
    </div>
  );
};

/** The floating toast (with an optional Undo-style action). Always mounted so screen readers hear it. */
export const Toast: React.FC<{ toast: ToastState | null }> = ({ toast }) => (
  <div
    role="status"
    aria-live="polite"
    className="fixed inset-x-0 z-[80] flex justify-center px-3 pointer-events-none"
    style={{ bottom: TOAST_BOTTOM }}
  >
    {toast && <ToastCard key={toast.id} toast={toast} />}
  </div>
);

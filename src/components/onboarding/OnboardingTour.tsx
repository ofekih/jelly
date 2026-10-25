import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, LogIn, Plus } from 'lucide-react';
import { trackEvent } from '../../firebase';
import { useBodyScrollLock } from '../../lib/useBodyScrollLock';
import { SpectrumExplorer } from '../../about/demos/SpectrumExplorer';
import { DifferentVisual, FreeVisual, FriendsVisual, StartVisual, SxSVisual, WelcomeVisual } from './visuals';
import './onboarding.css';

export type OnboardingExit = 'skip' | 'done' | 'add_first' | 'sign_in';

interface OnboardingTourProps {
  /** Called once the tour closes, however it closed */
  onClose: (exit: OnboardingExit) => void;
  /** Opens the add flow for the first spot */
  onAddFirst: () => void;
  /** Google sign-in; omit when already signed in (the hint is then hidden) */
  onSignIn?: () => void;
}

interface TourPage {
  id: string;
  eyebrow: string;
  title: string;
  body: React.ReactNode;
  /** Soft glow behind the page */
  glow: string;
  visual: React.FC<{ active: boolean }>;
}

const SpectrumVisual: React.FC<{ active: boolean }> = ({ active }) => (
  <div className="w-full max-w-sm rounded-3xl border border-zinc-200/80 bg-white/90 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80">
    <SpectrumExplorer compact autoplay={active} />
  </div>
);

const PAGES: TourPage[] = [
  {
    id: 'welcome',
    eyebrow: 'Welcome to jelly',
    title: 'Rank everything you love',
    body: 'Restaurants, museums, trips, movies, books and games – each in its own list, all in one app.',
    glow: '#10b981',
    visual: WelcomeVisual,
  },
  {
    id: 'gut',
    eyebrow: 'Step 1 · Gut feeling',
    title: 'Start with how it felt',
    body: (
      <>
        Slide to a feeling – words, not stars. They’re calibrated low on purpose (“Loved it” is only about an 8.3), so
        you use the whole scale.
      </>
    ),
    glow: '#06b6d4',
    visual: SpectrumVisual,
  },
  {
    id: 'sxs',
    eyebrow: 'Step 2 · Side-by-side',
    title: 'Then a few quick picks',
    body: (
      <>
        “Which did you like more?” A handful of questions finds its exact place, and scores are fitted to your order, so
        they always agree with your choices.
      </>
    ),
    glow: '#14b8a6',
    visual: SxSVisual,
  },
  {
    id: 'friends',
    eyebrow: 'Friends',
    title: 'Better with friends',
    body: (
      <>
        See friends’ scores and the jelly average, plus a private guess of how much <i>you’ll</i> like something, based
        on whose taste matches yours. Then blend lists to decide together.
      </>
    ),
    glow: '#8b5cf6',
    visual: FriendsVisual,
  },
  {
    id: 'different',
    eyebrow: 'Why jelly',
    title: 'Made for honest lists',
    body: 'One app for everything you rank, with scores that actually mean something.',
    glow: '#0ea5e9',
    visual: DifferentVisual,
  },
  {
    id: 'free',
    eyebrow: 'Free, no ads',
    title: 'Here’s why it’s free',
    body: 'A quick note from the person who made jelly.',
    glow: '#f59e0b',
    visual: FreeVisual,
  },
  {
    id: 'start',
    eyebrow: 'Ready?',
    title: 'Rank your first spot',
    body: 'Think of something you loved lately – a dinner, a museum, a show – and see where it lands.',
    glow: '#10b981',
    visual: StartVisual,
  },
];

/** Shrinks a visual that is taller than the space left on short phones, instead of clipping it */
const FitHeight: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const measure = () => setScale(Math.min(1, (outer.clientHeight - 24) / Math.max(1, inner.offsetHeight)));
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={outerRef} className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden py-3">
      <div
        ref={innerRef}
        className="flex w-full shrink-0 justify-center"
        style={{ transform: scale < 1 ? `scale(${scale})` : undefined }}
      >
        {children}
      </div>
    </div>
  );
};

const LAST = PAGES.length - 1;
/** Drag distance (px) or flick speed (px/ms) that turns the page */
const SWIPE_DISTANCE = 56;
const SWIPE_VELOCITY = 0.45;

/**
 * Full-screen welcome tour for new users: one idea per page with a live visual, swipe or
 * Next/Back to move, Skip always visible. Loaded in its own chunk.
 */
export const OnboardingTour: React.FC<OnboardingTourProps> = ({ onClose, onAddFirst, onSignIn }) => {
  useBodyScrollLock();
  const [index, setIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; t: number; axis: 'x' | 'y' | null } | null>(null);
  const suppressClick = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closedRef = useRef(false);

  const go = useCallback((next: number) => {
    setIndex((cur) => {
      const target = Math.max(0, Math.min(LAST, next));
      return target === cur ? cur : target;
    });
  }, []);

  useEffect(() => {
    trackEvent('onboarding_step', { step: index + 1, page: PAGES[index].id });
  }, [index]);

  const close = useCallback(
    (exit: OnboardingExit) => {
      if (closedRef.current) return;
      closedRef.current = true;
      if (exit === 'skip') trackEvent('onboarding_skip', { step: index + 1, page: PAGES[index].id });
      else trackEvent('onboarding_complete', { action: exit });
      onClose(exit);
      if (exit === 'add_first') onAddFirst();
      if (exit === 'sign_in') onSignIn?.();
    },
    [index, onClose, onAddFirst, onSignIn]
  );

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(index + 1);
      else if (e.key === 'ArrowLeft') go(index - 1);
      else if (e.key === 'Escape') close('skip');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, go, close]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-no-swipe]')) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), axis: null };
    suppressClick.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (d.axis === 'x') {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDragging(true);
      }
    }
    if (d.axis !== 'x') return;
    suppressClick.current = true;
    // Rubber-band past either end
    const atEdge = (index === 0 && dx > 0) || (index === LAST && dx < 0);
    setDragX(atEdge ? dx / 3 : dx);
  };
  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || d.axis !== 'x') return;
    const dx = e.clientX - d.x;
    const v = dx / Math.max(1, performance.now() - d.t);
    if (dx < -SWIPE_DISTANCE || v < -SWIPE_VELOCITY) go(index + 1);
    else if (dx > SWIPE_DISTANCE || v > SWIPE_VELOCITY) go(index - 1);
    setDragging(false);
    setDragX(0);
  };

  const page = PAGES[index];
  const isLast = index === LAST;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to jelly"
      tabIndex={-1}
      className="tour-fade fixed inset-0 z-[60] flex flex-col overflow-hidden bg-zinc-50 text-zinc-900 outline-none dark:bg-zinc-950 dark:text-zinc-100"
    >
      {/* Glow that shifts colour with the page */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[18%] h-[26rem] w-[26rem] -translate-x-1/2 rounded-full opacity-25 blur-3xl transition-colors duration-700 motion-reduce:transition-none dark:opacity-20"
        style={{ backgroundColor: page.glow }}
      />

      {/* Top bar: Skip is always there */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="text-[13px] font-semibold tabular-nums text-zinc-400" aria-live="polite">
          {index + 1} / {PAGES.length}
        </div>
        <button
          type="button"
          onClick={() => close(isLast ? 'done' : 'skip')}
          className="rounded-full px-3.5 py-2 text-[13px] font-semibold text-zinc-500 transition hover:bg-zinc-200/60 hover:text-zinc-800 active:scale-95 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100"
        >
          {isLast ? 'Close' : 'Skip'}
        </button>
      </div>

      {/* Pages */}
      <div
        className="relative min-h-0 flex-1 touch-pan-y select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.stopPropagation();
            e.preventDefault();
            suppressClick.current = false;
          }
        }}
      >
        <div
          className={`flex h-full ${dragging ? '' : 'transition-transform duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none'}`}
          style={{ transform: `translate3d(calc(${-index * 100}% + ${dragX}px), 0, 0)` }}
        >
          {PAGES.map((p, i) => {
            const near = Math.abs(i - index) <= 1;
            const Visual = p.visual;
            return (
              <section
                key={p.id}
                aria-hidden={i !== index}
                inert={i !== index}
                className="flex h-full w-full shrink-0 flex-col items-center px-5"
              >
                <FitHeight>{near && <Visual active={i === index} />}</FitHeight>
                <div className="w-full max-w-md shrink-0 pb-2 text-center">
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-jade-600 dark:text-jade-400">
                    {p.eyebrow}
                  </div>
                  <h2 className="mt-1.5 text-[1.65rem] font-extrabold leading-tight tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">
                    {p.title}
                  </h2>
                  <div className="mx-auto mt-2 max-w-sm text-[14.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                    {p.body}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="relative z-10 mx-auto w-full max-w-md px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        <div className="mb-3 flex justify-center gap-1.5" role="tablist" aria-label="Tour pages">
          {PAGES.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Page ${i + 1}: ${p.title}`}
              onClick={() => go(i)}
              className="grid h-6 place-items-center px-0.5"
            >
              <span
                className={`block h-1.5 rounded-full transition-all duration-300 ${
                  i === index ? 'w-6 bg-jade-600 dark:bg-jade-400' : 'w-1.5 bg-zinc-300 dark:bg-zinc-700'
                }`}
              />
            </button>
          ))}
        </div>

        {isLast ? (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => close('add_first')}
              className="tour-pulse flex w-full items-center justify-center gap-2 rounded-full bg-jade-600 py-3.5 text-[15px] font-bold text-white shadow-lg shadow-jade-600/20 transition hover:bg-jade-700 active:scale-[0.98] dark:bg-jade-500 dark:text-jade-950 dark:hover:bg-jade-400"
            >
              <Plus className="h-4.5 w-4.5 stroke-[2.5]" /> Add your first spot
            </button>
            {onSignIn ? (
              <button
                type="button"
                onClick={() => close('sign_in')}
                className="flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 text-[13px] font-semibold text-zinc-600 transition hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800/70"
              >
                <LogIn className="h-3.5 w-3.5" /> Sign in to sync across devices
              </button>
            ) : (
              <button
                type="button"
                onClick={() => close('done')}
                className="w-full rounded-full py-2.5 text-[13px] font-semibold text-zinc-500 transition hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800/70"
              >
                Look around first
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                type="button"
                onClick={() => go(index - 1)}
                aria-label="Back"
                className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-zinc-600 shadow-sm ring-1 ring-zinc-200 transition hover:text-zinc-900 active:scale-95 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:text-zinc-50"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => go(index + 1)}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-zinc-900 text-[15px] font-bold text-white shadow-lg shadow-zinc-900/10 transition hover:bg-zinc-800 active:scale-[0.98] dark:bg-jade-500 dark:text-jade-950 dark:hover:bg-jade-400"
            >
              {index === 0 ? 'Show me how' : 'Next'} <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

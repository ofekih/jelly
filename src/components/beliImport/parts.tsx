import React, { useEffect, useState } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import { pctToSpectrumRating, spectrumGradient, spectrumRatingToPct } from '../../lib/rankingEngine';
import { RATING_TIERS, getRatingTier, getVibeLabel } from '../../lib/ratingTiers';

/** The five steps shown in the header's progress bar */
export const PROGRESS_STEPS = 5;

interface ShellProps {
  title: string;
  /** 1–5, or 0 for no progress bar */
  step: number;
  onBack?: () => void;
  onClose: () => void;
  /** Wider dialog on tablets / desktop (review lists) */
  wide?: boolean;
  /** Sized to its content on tablets / desktop (short screens like sign-in) */
  compact?: boolean;
  /** Under the header, above the scrolling body (the lookup progress strip) */
  strip?: React.ReactNode;
  footer?: React.ReactNode;
  /** Keyboard height to keep the page above (`useKeyboardInset`) */
  keyboardInset?: number;
  children: React.ReactNode;
  bodyRef?: React.Ref<HTMLDivElement>;
}

/**
 * The import's frame: a full-screen page on phones (and phone landscape), a centered dialog from
 * 640×560 up (`dialog:` variant). The body scrolls; the footer's button stays put above the home
 * indicator and the keyboard.
 */
export const ImportShell: React.FC<ShellProps> = ({
  title,
  step,
  onBack,
  onClose,
  wide,
  compact,
  strip,
  footer,
  keyboardInset = 0,
  children,
  bodyRef,
}) => (
  <div
    data-group="eat"
    className="fixed inset-0 z-[60] dialog:flex dialog:items-center dialog:justify-center dialog:p-6 dialog:bg-black/55 dialog:backdrop-blur-xs animate-jelly-backdrop"
    onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="beli-import-title"
      style={{ bottom: keyboardInset || undefined }}
      className={`absolute inset-0 flex flex-col bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 overscroll-contain animate-jelly-page-up-in dialog:animate-jelly-dialog dialog:relative dialog:inset-auto dialog:w-full dialog:rounded-3xl dialog:border dialog:border-zinc-200/80 dark:dialog:border-zinc-800 dialog:shadow-2xl dialog:overflow-hidden ${
        wide ? 'dialog:max-w-xl' : 'dialog:max-w-lg'
      } ${compact ? 'dialog:max-h-[calc(100dvh-3rem)]' : 'dialog:h-[min(760px,calc(100dvh-3rem))]'}`}
    >
      <header className="shrink-0 pt-[calc(env(safe-area-inset-top)+4px)] dialog:pt-3 short:pt-1 border-b border-zinc-100 dark:border-zinc-800 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        <div className="grid grid-cols-[44px_1fr_44px] items-center gap-1">
          {onBack ? (
            <IconButton label="Back" onClick={onBack}>
              <ChevronLeft className="w-5 h-5" />
            </IconButton>
          ) : (
            <span />
          )}
          <div className="text-center min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
              Import from Beli
            </p>
            <h2 id="beli-import-title" className="text-sm font-bold truncate">
              {title}
            </h2>
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X className="w-5 h-5" />
          </IconButton>
        </div>
        {step > 0 && (
          <div className="flex gap-1 px-1 pt-2 pb-2 short:hidden" aria-label={`Step ${step} of ${PROGRESS_STEPS}`}>
            {Array.from({ length: PROGRESS_STEPS }, (_, i) => (
              <span
                key={i}
                className={`h-[3px] flex-1 rounded-full ${i < step ? 'bg-emerald-500' : 'bg-zinc-200 dark:bg-zinc-700'}`}
              />
            ))}
          </div>
        )}
        {step === 0 && <div className="h-2 short:hidden" />}
      </header>
      {strip}
      <div
        ref={bodyRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] py-5 short:py-3"
      >
        <div className="max-w-md mx-auto w-full flex flex-col gap-4 short:max-w-2xl">{children}</div>
      </div>
      {footer && (
        <footer className="shrink-0 border-t border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 pt-2.5 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] dialog:pb-3.5">
          <div className="max-w-md mx-auto w-full flex flex-wrap items-center gap-2 short:max-w-2xl">{footer}</div>
        </footer>
      )}
    </div>
  </div>
);

const IconButton: React.FC<{ label: string; onClick: () => void; children: React.ReactNode }> = ({ label, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className="w-11 h-11 rounded-full flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
  >
    {children}
  </button>
);

export const PrimaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { grow?: boolean }> = ({
  className = '',
  grow = true,
  ...props
}) => (
  <button
    type="button"
    {...props}
    className={`min-h-11 px-5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors disabled:opacity-45 disabled:hover:bg-emerald-600 disabled:cursor-default active:scale-[0.99] ${
      grow ? 'flex-[1_1_9rem]' : ''
    } ${className}`}
  />
);

export const SecondaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { small?: boolean }> = ({
  className = '',
  small,
  ...props
}) => (
  <button
    type="button"
    {...props}
    className={`${small ? 'min-h-9 px-3 rounded-xl text-xs' : 'min-h-11 px-4 rounded-2xl text-sm'} bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-semibold transition-colors disabled:opacity-50 ${className}`}
  />
);

export const QuietButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = '', ...props }) => (
  <button
    type="button"
    {...props}
    className={`min-h-11 px-3 rounded-2xl text-sm font-semibold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors ${className}`}
  />
);

export const Hero: React.FC<{ title: string; children?: React.ReactNode; art?: React.ReactNode }> = ({ title, children, art }) => (
  <div className="text-center flex flex-col items-center gap-2">
    {art && <div className="short:hidden">{art}</div>}
    <h1 className="text-xl font-extrabold leading-tight text-balance">{title}</h1>
    {children && <div className="text-sm text-zinc-500 dark:text-zinc-400 max-w-[36ch]">{children}</div>}
  </div>
);

export const BeliToJellyArt: React.FC = () => (
  <div className="flex items-center gap-2.5" aria-hidden="true">
    <span className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center font-display font-extrabold text-lg text-zinc-500">
      B
    </span>
    <span className="text-zinc-400">→</span>
    <span className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/50 flex items-center justify-center">
      <img src="/jelly-logo.png" alt="" className="w-9 h-9" />
    </span>
  </div>
);

export const Switch: React.FC<{ checked: boolean }> = ({ checked }) => (
  <span
    aria-hidden="true"
    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
      checked ? 'bg-emerald-600' : 'bg-zinc-200 dark:bg-zinc-700'
    }`}
  >
    <span
      className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
    />
  </span>
);

/**
 * The gut-feeling spectrum as a native range input: drag or tap anywhere, arrow keys step it, and
 * screen readers hear the vibe label. `onChange` fires while dragging.
 */
export const SpectrumSlider: React.FC<{
  rating: number;
  linear: boolean;
  label: string;
  onChange: (rating: number) => void;
}> = ({ rating, linear, label, onChange }) => {
  const tier = getRatingTier(rating);
  return (
    <div className="flex flex-col gap-2">
      <span className={`self-center inline-flex px-3 py-1 rounded-full text-xs font-semibold border text-center ${tier.pillClass}`}>
        {getVibeLabel(rating, 'eat')}
      </span>
      <div className="relative">
        <input
          type="range"
          min={0}
          max={1000}
          step={1}
          value={Math.round(spectrumRatingToPct(rating, linear) * 10)}
          onChange={(e) => onChange(pctToSpectrumRating(Number(e.target.value) / 1000, linear))}
          aria-label={label}
          aria-valuetext={getVibeLabel(rating, 'eat')}
          className="jelly-spectrum-range w-full"
          style={{ backgroundImage: spectrumGradient(linear), ['--thumb' as string]: tier.thumbColor }}
        />
        {RATING_TIERS.slice(1).map((t) => (
          <span
            key={t.name}
            aria-hidden="true"
            className="absolute top-2.5 bottom-2.5 w-px bg-white/40 dark:bg-black/25 pointer-events-none"
            style={{ left: `${spectrumRatingToPct(t.from, linear)}%` }}
          />
        ))}
      </div>
      <div className="relative h-4 text-[10.5px] font-semibold select-none" aria-hidden="true">
        {RATING_TIERS.map((t) => (
          <span key={t.name} className={`absolute -translate-x-1/2 ${t.zoneClass}`} style={{ left: `${spectrumRatingToPct(t.zoneRating, linear)}%` }}>
            {t.name}
          </span>
        ))}
      </div>
    </div>
  );
};

/** How much of the layout viewport the on-screen keyboard covers (iOS doesn't resize the page) */
export function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) {
      setInset(0);
      return;
    }
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);
  return inset;
}

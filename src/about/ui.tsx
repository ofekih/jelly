import React, { useMemo } from 'react';
import katex from 'katex';
import { ChevronDown } from 'lucide-react';

/** KaTeX math, inline by default; `block` centres it on its own line (scrolls sideways if wide). */
export const Tex: React.FC<{ children: string; block?: boolean }> = ({ children, block }) => {
  const html = useMemo(
    () => katex.renderToString(children, { displayMode: !!block, throwOnError: false }),
    [children, block]
  );
  return block ? (
    <div
      className="my-3 overflow-x-auto overflow-y-hidden py-1 text-zinc-800 dark:text-zinc-100"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  );
};

export const Section: React.FC<{
  id: string;
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
}> = ({ id, eyebrow, title, children }) => (
  <section id={id} className="scroll-mt-6 pt-14">
    {eyebrow && (
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-jade-600 dark:text-jade-400">
        {eyebrow}
      </div>
    )}
    <h2 className="mt-1 text-2xl sm:text-[1.7rem] font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
      {title}
    </h2>
    <div className="mt-4 space-y-4 text-[15.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">
      {children}
    </div>
  </section>
);

/** A framed, interactive figure */
export const Demo: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({
  title,
  hint,
  children,
}) => (
  <figure className="not-prose my-6 rounded-3xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 shadow-sm overflow-hidden">
    <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 sm:px-5 pt-4">
      <span className="font-display font-bold text-zinc-900 dark:text-zinc-100">{title}</span>
      {hint && <span className="text-xs text-zinc-400 dark:text-zinc-500">{hint}</span>}
    </figcaption>
    <div className="p-4 sm:p-5 text-[14.5px] text-zinc-600 dark:text-zinc-300">{children}</div>
  </figure>
);

/** Collapsible "for the nerds" panel with the real formulas and constants */
export const Nerd: React.FC<{ title?: string; children: React.ReactNode }> = ({
  title = 'For the nerds',
  children,
}) => (
  <details className="group my-4 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-100/60 dark:bg-zinc-900/40">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300 [&::-webkit-details-marker]:hidden">
      <span className="text-base leading-none">∑</span>
      {title}
      <ChevronDown className="ml-auto h-4 w-4 transition-transform group-open:rotate-180" />
    </summary>
    <div className="space-y-3 px-4 pb-4 text-[14.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">
      {children}
    </div>
  </details>
);

export const Callout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <blockquote className="my-5 border-l-4 border-jade-400 dark:border-jade-600 pl-4 text-[17px] font-medium leading-snug text-zinc-800 dark:text-zinc-100">
    {children}
  </blockquote>
);

export const Pill: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className = '',
  children,
}) => (
  <span
    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}
  >
    {children}
  </span>
);

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'plain' }
> = ({ tone = 'plain', className = '', ...props }) => (
  <button
    type="button"
    {...props}
    className={`rounded-full px-3.5 py-2 text-sm font-semibold transition active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none ${
      tone === 'primary'
        ? 'bg-jade-600 text-white hover:bg-jade-700 dark:bg-jade-500 dark:text-jade-950 dark:hover:bg-jade-400'
        : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
    } ${className}`}
  />
);

import React, { useState } from 'react';
import { RATING_TIERS, getRatingTier, getVibeLabel } from '../../lib/ratingTiers';
import { pctToSpectrumRating, spectrumGradient, spectrumRatingToPct } from '../../lib/rankingEngine';
import { Demo, Pill } from '../ui';

// Chart geometry (SVG user units)
const W = 320;
const H = 190;
const PAD = { l: 28, r: 10, t: 10, b: 24 };
const x = (pct: number) => PAD.l + pct * (W - PAD.l - PAD.r);
const y = (rating: number) => PAD.t + (1 - (rating - 1) / 9) * (H - PAD.t - PAD.b);

export const SpectrumDemo: React.FC = () => {
  const [pct, setPct] = useState(0.62);
  const [linear, setLinear] = useState(false);
  const rating = pctToSpectrumRating(pct, linear);
  const tier = getRatingTier(rating);

  // The mapping is piecewise linear, so its corners (one per tier boundary) draw it exactly
  const curve = [...RATING_TIERS.map((t) => t.from), 10]
    .map((r) => `${x(spectrumRatingToPct(r) / 100).toFixed(1)},${y(r).toFixed(1)}`)
    .join(' ');

  const setFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPct(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
  };

  return (
    <Demo title="The gut-feeling spectrum" hint="Drag along the bar">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs text-zinc-400">How did it feel?</div>
          <div className="mt-0.5 text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">
            {getVibeLabel(rating, 'eat')}
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-4xl font-extrabold tabular-nums leading-none" style={{ color: tier.thumbColor }}>
            {rating.toFixed(1)}
          </div>
          <Pill className={`mt-1.5 ${tier.pillClass}`}>{tier.name}</Pill>
        </div>
      </div>

      <div
        role="slider"
        aria-label="Gut feeling"
        aria-valuemin={1}
        aria-valuemax={10}
        aria-valuenow={rating}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setPct((p) => Math.max(0, p - 0.01));
          if (e.key === 'ArrowRight') setPct((p) => Math.min(1, p + 0.01));
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setFromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons) setFromPointer(e);
        }}
        className="relative mt-4 h-12 w-full cursor-pointer touch-none select-none rounded-2xl shadow-inner ring-1 ring-inset ring-black/10 dark:ring-white/15 outline-none focus-visible:ring-2 focus-visible:ring-jade-500"
        style={{ backgroundImage: spectrumGradient(linear) }}
      >
        {RATING_TIERS.slice(1).map((t) => (
          <div
            key={t.name}
            className="pointer-events-none absolute top-2 bottom-2 w-px bg-white/40 dark:bg-black/25"
            style={{ left: `${spectrumRatingToPct(t.from, linear)}%` }}
          />
        ))}
        <div
          className="pointer-events-none absolute top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-white/25 shadow-lg backdrop-blur-sm"
          style={{ left: `${pct * 100}%` }}
        />
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] font-semibold">
        {RATING_TIERS.map((t, i) => {
          const from = spectrumRatingToPct(t.from, linear);
          const to = spectrumRatingToPct(RATING_TIERS[i + 1]?.from ?? 10, linear);
          return (
            <span
              key={t.name}
              className={`absolute -translate-x-1/2 whitespace-nowrap ${t.zoneClass}`}
              style={{ left: `${(from + to) / 2}%` }}
            >
              {t.name}
            </span>
          );
        })}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Slider position versus rating">
          {RATING_TIERS.map((t, i) => {
            const top = RATING_TIERS[i + 1]?.from ?? 10;
            return (
              <rect
                key={t.name}
                x={PAD.l}
                width={W - PAD.l - PAD.r}
                y={y(top)}
                height={y(t.from) - y(top)}
                fill={t.thumbColor}
                opacity={0.09}
              />
            );
          })}
          {[1, 4, 6, 7.5, 8.8, 10].map((r) => (
            <text key={r} x={PAD.l - 5} y={y(r) + 3.5} textAnchor="end" className="fill-zinc-400 text-[9px] tabular-nums">
              {r}
            </text>
          ))}
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((p) => (
            <text key={p} x={x(p)} y={H - 8} textAnchor="middle" className="fill-zinc-400 text-[9px]">
              {Math.round(p * 100)}%
            </text>
          ))}
          <line x1={x(0)} y1={y(1)} x2={x(1)} y2={y(10)} strokeDasharray="4 4" className="stroke-zinc-400" strokeWidth={1.2} />
          <polyline points={curve} fill="none" stroke="#059669" strokeWidth={2.5} strokeLinejoin="round" />
          <line x1={x(pct)} y1={y(1)} x2={x(pct)} y2={y(rating)} className="stroke-zinc-300 dark:stroke-zinc-600" strokeDasharray="2 3" />
          <line x1={x(0)} y1={y(rating)} x2={x(pct)} y2={y(rating)} className="stroke-zinc-300 dark:stroke-zinc-600" strokeDasharray="2 3" />
          <circle cx={x(pct)} cy={y(rating)} r={5.5} fill={tier.thumbColor} stroke="white" strokeWidth={2} />
        </svg>
        <div className="space-y-2 text-[13px] sm:w-44">
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-6 rounded bg-jade-600" /> jelly's scale
          </div>
          <div className="flex items-center gap-2">
            <span className="w-6 border-t-2 border-dashed border-zinc-400" /> a plain 1–10 line
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-zinc-500">
            <input
              type="checkbox"
              checked={linear}
              onChange={(e) => setLinear(e.target.checked)}
              className="accent-jade-600"
            />
            Use the linear bar
          </label>
        </div>
      </div>
    </Demo>
  );
};

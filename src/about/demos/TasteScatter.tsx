import React from 'react';
import { getRatingTier } from '../../lib/ratingTiers';

/** Sample spots shared by the About page's taste demo and the onboarding tour */
export const TASTE_SPOTS = ['Hanami Omakase', 'Osteria Lucia', 'Smoke & Ember', 'Casa Verde', 'Pho Saigon', 'Burger Barn'];
export const TASTE_MINE = [9.4, 8.9, 8.3, 7.6, 7.0, 5.8];

export const TASTE_PRESETS: Array<{ label: string; friend: number[] }> = [
  { label: 'Tougher grader', friend: TASTE_MINE.map((s) => Math.round((s - 1.8) * 10) / 10) },
  { label: 'Kindred palate', friend: [9.1, 9.2, 8.0, 7.9, 6.6, 6.1] },
  { label: 'Opposite taste', friend: [5.9, 6.5, 7.2, 8.1, 8.8, 9.3] },
];

// Scatter geometry
const S = 200;
const P = 24;
const sx = (v: number) => P + ((v - 3) / 7) * (S - P - 8);
const sy = (v: number) => S - P - ((v - 3) / 7) * (S - P - 8);

/** Your scores (x) against a friend's (y) for the spots you've both ranked; dots glide between presets */
export const TasteScatter: React.FC<{ mine: number[]; friend: number[]; shared?: number; className?: string }> = ({
  mine,
  friend,
  shared = mine.length,
  className = 'mx-auto w-full max-w-[220px]',
}) => (
  <svg viewBox={`0 0 ${S} ${S}`} className={className} role="img" aria-label="Your scores versus your friend's">
    <rect x={P} y={8} width={S - P - 8} height={S - P - 8} rx={8} className="fill-zinc-50 dark:fill-zinc-950/60" />
    <line x1={sx(3)} y1={sy(3)} x2={sx(10)} y2={sy(10)} className="stroke-zinc-300 dark:stroke-zinc-700" strokeDasharray="3 3" />
    {[4, 6, 8, 10].map((v) => (
      <g key={v} className="fill-zinc-400 text-[8px] tabular-nums">
        <text x={sx(v)} y={S - P + 11} textAnchor="middle">{v}</text>
        <text x={P - 4} y={sy(v) + 3} textAnchor="end">{v}</text>
      </g>
    ))}
    <text x={(S + P) / 2} y={S - 2} textAnchor="middle" className="fill-zinc-500 text-[8.5px] font-semibold">you</text>
    <text x={7} y={(S - P) / 2} textAnchor="middle" transform={`rotate(-90 7 ${(S - P) / 2})`} className="fill-zinc-500 text-[8.5px] font-semibold">
      friend
    </text>
    {mine.slice(0, shared).map((m, i) => (
      <circle
        key={i}
        cx={sx(m)}
        cy={sy(friend[i])}
        r={5}
        fill={getRatingTier(friend[i]).thumbColor}
        stroke="white"
        strokeWidth={1.5}
        className="transition-all duration-500"
      />
    ))}
  </svg>
);

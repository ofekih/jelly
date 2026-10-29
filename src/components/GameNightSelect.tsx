import React from 'react';

export const PLAYER_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];
export const PRICE_OPTIONS = [10, 20, 30, 50, 75, 100];
export const MINUTE_OPTIONS = [20, 30, 45, 60, 90, 120, 180];

/** A filter pill (like the city filter) for a game list's player count, play time or price */
export const GameNightSelect: React.FC<{
  label: string;
  value: number | 'ALL';
  options: Array<[number, string]>;
  anyLabel: string;
  onChange: (value: number | 'ALL') => void;
  small?: boolean;
}> = ({ label, value, options, anyLabel, onChange, small = false }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
    aria-label={label}
    className={`${small ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'} rounded-full font-semibold shrink-0 appearance-none cursor-pointer transition-colors focus:outline-none ${
      value !== 'ALL'
        ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950'
        : 'bg-zinc-200/70 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800'
    }`}
  >
    <option value="ALL">{anyLabel}</option>
    {options.map(([v, text]) => (
      <option key={v} value={v}>
        {text}
      </option>
    ))}
  </select>
);

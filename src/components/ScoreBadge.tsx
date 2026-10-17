import React from 'react';

interface ScoreBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
}

export function getScoreColorClasses(score: number): {
  circle: string;
  label: string;
} {
  if (score >= 8.5) {
    return {
      circle:
        'border-emerald-600/80 text-emerald-700 bg-emerald-50/70 dark:border-emerald-400/70 dark:text-emerald-300 dark:bg-emerald-950/60',
      label: 'Loved it',
    };
  }
  if (score >= 7.2) {
    return {
      circle:
        'border-teal-600/75 text-teal-700 bg-teal-50/60 dark:border-teal-400/60 dark:text-teal-300 dark:bg-teal-950/50',
      label: 'Liked it',
    };
  }
  if (score >= 5.5) {
    return {
      circle:
        'border-amber-500/80 text-amber-700 bg-amber-50/60 dark:border-amber-400/70 dark:text-amber-300 dark:bg-amber-950/50',
      label: 'It was okay',
    };
  }
  return {
    circle:
      'border-rose-500/80 text-rose-700 bg-rose-50/60 dark:border-rose-400/70 dark:text-rose-300 dark:bg-rose-950/50',
    label: 'Didn’t like it',
  };
}

export const ScoreBadge: React.FC<ScoreBadgeProps> = ({ score, size = 'md' }) => {
  const { circle } = getScoreColorClasses(score);

  const sizeClasses =
    size === 'lg'
      ? 'w-14 h-14 text-lg font-extrabold border-2'
      : size === 'sm'
      ? 'w-9 h-9 text-xs font-bold border-[1.5px]'
      : 'w-11 h-11 text-sm font-extrabold border-[1.75px]';

  return (
    <div
      className={`rounded-full flex items-center justify-center shrink-0 tabular-nums tracking-tight select-none ${circle} ${sizeClasses}`}
    >
      {score.toFixed(1)}
    </div>
  );
};

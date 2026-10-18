import React, { useId } from 'react';

interface JellyBeanIconProps {
  className?: string;
  size?: number;
}

// Bean silhouette: a horizontal kidney shape (dent on top), centered on the origin.
const BEAN_PATH =
  'M-16 3 C-16 -4 -11 -8 -6 -6 C-2 -4.5 2 -4.5 6 -7 C11 -10 16 -6 16 0 C16 6 9 9 0 9 C-8 9 -16 9 -16 3 Z';

/**
 * Two overlapping jelly beans (mint in back, berry in front), matching the
 * home-screen app icon artwork.
 */
export const JellyBeanIcon: React.FC<JellyBeanIconProps> = ({
  className = '',
  size = 24,
}) => {
  const uid = useId().replace(/:/g, '');
  const greenId = `jellyEmerald-${uid}`;
  const berryId = `jellyBerry-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="6 6 52 52"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={greenId} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#a7f3d0" />
          <stop offset="45%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <linearGradient id={berryId} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#fda4af" />
          <stop offset="45%" stopColor="#f43f5e" />
          <stop offset="100%" stopColor="#be123c" />
        </linearGradient>
      </defs>

      {/* Mint bean, back (upper-left) */}
      <g transform="translate(24 28) rotate(-26) scale(0.92 1.05)">
        <path d={BEAN_PATH} fill={`url(#${greenId})`} />
        <path
          d="M-12 -1 C-11 -4 -8.5 -5 -6.5 -4"
          stroke="#ffffff"
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.75"
        />
        <path
          d="M8 -6 C10 -7 12 -6.5 13 -5"
          stroke="#ffffff"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.6"
        />
      </g>

      {/* Berry bean, front (lower-right), mirrored so its big lobe is on the right */}
      <g transform="translate(39 36) rotate(-20) scale(-1.02 1.2)">
        <path
          d={BEAN_PATH}
          fill={`url(#${berryId})`}
          className="stroke-white dark:stroke-zinc-900"
          strokeWidth="1.2"
        />
        <path
          d="M8 -6 C10 -7 12 -6.5 13 -5"
          stroke="#ffffff"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.7"
        />
        <path
          d="M-6.5 -4 C-9 -5 -11 -4 -12 -2"
          stroke="#ffffff"
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.7"
        />
      </g>
    </svg>
  );
};

import React from 'react';

interface JellyBeanIconProps {
  className?: string;
  size?: number;
}

export const JellyBeanIcon: React.FC<JellyBeanIconProps> = ({
  className = '',
  size = 24,
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="jellyEmeraldGrad"
          x1="10"
          y1="10"
          x2="36"
          y2="50"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#6ee7b7" />
          <stop offset="52%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#047857" />
        </linearGradient>
        <linearGradient
          id="jellyBerryGrad"
          x1="26"
          y1="16"
          x2="54"
          y2="56"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#fda4af" />
          <stop offset="52%" stopColor="#f43f5e" />
          <stop offset="100%" stopColor="#be123c" />
        </linearGradient>
      </defs>

      {/* Left Emerald-Mint Jelly Bean (upright, no tilt) */}
      <g>
        <path
          d="M15 13 C24 10, 33 15, 33 25 C33 31, 29 34, 30 40 C31 47, 25 51, 17 49 C8 47, 9 36, 13 29 C15 23, 8 16, 15 13 Z"
          fill="url(#jellyEmeraldGrad)"
        />
        <path
          d="M17.5 17 C22 15.5, 26.5 18, 26.5 23.5 C26.5 27, 23.5 31.5, 21 35"
          stroke="#ffffff"
          strokeWidth="2.8"
          strokeLinecap="round"
          opacity="0.7"
        />
      </g>

      {/* Right Berry-Coral Jelly Bean (upright, no tilt) */}
      <g>
        <path
          d="M33 18 C42 15, 51 20, 51 30 C51 36, 47 39, 48 45 C49 52, 43 56, 35 54 C26 52, 27 41, 31 34 C33 28, 26 21, 33 18 Z"
          fill="url(#jellyBerryGrad)"
        />
        <path
          d="M35.5 22 C40 20.5, 44.5 23, 44.5 28.5 C44.5 32, 41.5 36.5, 39 40"
          stroke="#ffffff"
          strokeWidth="2.8"
          strokeLinecap="round"
          opacity="0.7"
        />
      </g>
    </svg>
  );
};

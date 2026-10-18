import React from 'react';

interface JellyBeanIconProps {
  className?: string;
  size?: number;
}

/**
 * jelly logo: a cropped version of the original app icon artwork
 * with its flat dark background converted to transparency (`/jelly-logo.png`).
 */
export const JellyBeanIcon: React.FC<JellyBeanIconProps> = ({
  className = '',
  size = 24,
}) => {
  return (
    <img
      src="/jelly-logo.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`shrink-0 select-none object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
};

import React from 'react';
import { UserRound } from 'lucide-react';

interface AvatarProps {
  /** Signed-in account; omit (or null) for the generic signed-out person */
  photoURL?: string | null;
  name?: string | null;
  /** Pixel size of the circle */
  size: number;
  className?: string;
}

/** Round profile picture: the account photo, else its initial, else a generic person. */
export const Avatar: React.FC<AvatarProps> = ({ photoURL, name, size, className = '' }) => {
  const style = { width: size, height: size };
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt=""
        referrerPolicy="no-referrer"
        draggable={false}
        style={style}
        className={`max-w-none shrink-0 rounded-full object-cover bg-zinc-200 dark:bg-zinc-800 ${className}`}
      />
    );
  }
  if (name) {
    return (
      <span
        aria-hidden="true"
        style={{ ...style, fontSize: Math.round(size * 0.42) }}
        className={`shrink-0 rounded-full bg-emerald-500 text-white dark:text-zinc-950 font-bold flex items-center justify-center select-none ${className}`}
      >
        {name.trim()[0]?.toUpperCase() || '?'}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      style={style}
      className={`shrink-0 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 flex items-center justify-center ${className}`}
    >
      <UserRound style={{ width: size * 0.58, height: size * 0.58 }} />
    </span>
  );
};

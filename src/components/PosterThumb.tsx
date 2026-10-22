import React, { useState } from 'react';
import { Film } from 'lucide-react';

/** A movie or show poster (2:3), or a film-strip placeholder when there's none or it fails to load */
export const PosterThumb: React.FC<{ src?: string; className?: string }> = ({ src, className = '' }) => {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={`shrink-0 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800 ring-1 ring-black/5 dark:ring-white/10 flex items-center justify-center ${className}`}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <Film className="w-1/2 h-1/2 max-w-5 max-h-5 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
      )}
    </div>
  );
};

/** TMDB's required attribution, shown wherever title search results appear */
export const TmdbCredit: React.FC = () => (
  <p className="pt-2 text-center text-[10px] text-zinc-400 dark:text-zinc-600">
    Movie & TV data from{' '}
    <a
      href="https://www.themoviedb.org"
      target="_blank"
      rel="noopener noreferrer"
      className="underline hover:text-zinc-600 dark:hover:text-zinc-400"
    >
      TMDB
    </a>
    . jelly uses the TMDB API but is not endorsed or certified by TMDB.
  </p>
);

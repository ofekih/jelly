import React, { useState } from 'react';
import { Film } from 'lucide-react';
import type { SpotCategory } from '../types';

/**
 * A title's poster or cover in a 2:3 frame (or a square one as tall, for board games), fitted, not
 * cropped, over a blurred copy that fills the rest of the frame, or a film-strip placeholder when
 * there's none or it fails to load
 */
export const PosterThumb: React.FC<{ src?: string; square?: boolean; className?: string }> = ({
  src,
  square = false,
  className = '',
}) => {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800 ring-1 ring-black/5 dark:ring-white/10 flex items-center justify-center ${className} ${square ? 'w-auto! aspect-square' : ''}`}
    >
      {src && !failed ? (
        <>
          <img
            src={src}
            alt=""
            aria-hidden="true"
            loading="lazy"
            draggable={false}
            className="absolute inset-0 w-full h-full object-cover scale-125 blur-sm opacity-70"
          />
          <img
            src={src}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setFailed(true)}
            className="relative w-full h-full object-contain"
          />
        </>
      ) : (
        <Film className="w-1/2 h-1/2 max-w-5 max-h-5 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
      )}
    </div>
  );
};

const creditLink = 'underline hover:text-zinc-600 dark:hover:text-zinc-400';

/** BGG's official badge, which public apps using its API must show, linking back to BGG */
export const PoweredByBgg: React.FC<{ className?: string }> = ({ className = '' }) => (
  <a
    href="https://boardgamegeek.com"
    target="_blank"
    rel="noopener noreferrer"
    className={`inline-block ${className}`}
    title="Board game data from BoardGameGeek"
  >
    <img
      src="https://cf.geekdo-images.com/HZy35cmzmmyV9BarSuk6ug__small/img/gbE7sulIurZE_Tx8EQJXnZSKI6w=/fit-in/200x150/filters:strip_icc()/pic7779581.png"
      alt="Powered by BGG"
      width={120}
      height={35}
      className="rounded-sm"
    />
  </a>
);

/** The data source's required attribution, shown wherever a list's search results appear */
export const TitleCredit: React.FC<{ category: SpotCategory }> = ({ category }) => (
  <p className="pt-2 text-center text-[10px] text-zinc-400 dark:text-zinc-600">
    {category === 'board_games' ? (
      <PoweredByBgg />
    ) : category === 'video_games' ? (
      <>
        Video game data from{' '}
        <a href="https://www.igdb.com" target="_blank" rel="noopener noreferrer" className={creditLink}>
          IGDB
        </a>
        .
      </>
    ) : category === 'fiction' || category === 'nonfiction' ? (
      <>
        Book data from{' '}
        <a href="https://books.google.com" target="_blank" rel="noopener noreferrer" className={creditLink}>
          Google Books
        </a>
        .
      </>
    ) : (
      <>
        Movie & TV data from{' '}
        <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" className={creditLink}>
          TMDB
        </a>
        . jelly uses the TMDB API but is not endorsed or certified by TMDB.
      </>
    )}
  </p>
);

import React from 'react';
import { ChevronRight, Download, LogOut, MapPin, MessageCircleHeart, Navigation, Sparkles } from 'lucide-react';
import { CURRENT_VERSION, displayVersion } from '../lib/changelog';
import { spectrumGradient, spectrumRatingToPct } from '../lib/rankingEngine';
import { RATING_TIERS } from '../lib/ratingTiers';
import { Sheet, SheetHeader } from './Sheet';

interface SettingsModalProps {
  isOpen: boolean;
  /** Closing (X, backdrop or swipe down) saves whatever changed */
  onClose: () => void;
  useCurrentLocation: boolean;
  onToggleCurrentLocation: () => void;
  /** The device location is known */
  hasLocation: boolean;
  defaultCity: string;
  onDefaultCityChange: (city: string) => void;
  linearRatingScale: boolean;
  onLinearRatingScaleChange: (linear: boolean) => void;
  onExport: () => void;
  hasUnseenChangelog: boolean;
  onOpenWhatsNew: () => void;
  /** Opens the feedback / bug report sheet */
  onOpenFeedback?: () => void;
  /** The signed-in account's email; undefined when signed out */
  email?: string | null;
  onSignOut: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  useCurrentLocation,
  onToggleCurrentLocation,
  hasLocation,
  defaultCity,
  onDefaultCityChange,
  linearRatingScale,
  onLinearRatingScaleChange,
  onExport,
  hasUnseenChangelog,
  onOpenWhatsNew,
  onOpenFeedback,
  email,
  onSignOut,
}) => {
  if (!isOpen) return null;

  return (
    <Sheet onClose={onClose} maxWidthClassName="max-w-sm" maxHeightClassName="max-h-[88vh]">
      {(scrollContainerRef) => (
        <>
          <SheetHeader title="Settings" onClose={onClose} />
          <div ref={scrollContainerRef} className="p-5 space-y-4 overflow-y-auto flex-1">
            {/* Location Bias Card */}
            <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/70 dark:border-zinc-800 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <Navigation className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                      <span>Search Nearby First</span>
                      {useCurrentLocation && hasLocation && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-md text-[9px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          GPS
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                      {useCurrentLocation
                        ? hasLocation
                          ? 'Using your device location'
                          : 'Will use device location when allowed'
                        : 'Off · searching by city name only'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onToggleCurrentLocation}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    useCurrentLocation ? 'bg-emerald-600' : 'bg-zinc-200 dark:bg-zinc-700'
                  }`}
                  role="switch"
                  aria-checked={useCurrentLocation}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                      useCurrentLocation ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="pt-1 space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 block">
                  {useCurrentLocation ? 'Fallback Search City' : 'Default Search City'}
                </label>
                <div className="relative flex items-center">
                  <MapPin className="w-3.5 h-3.5 text-zinc-400 absolute left-3 pointer-events-none" />
                  <input
                    type="text"
                    value={defaultCity}
                    onChange={(e) => onDefaultCityChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                    enterKeyHint="done"
                    placeholder={useCurrentLocation ? 'e.g. San Francisco (used if GPS off)' : 'e.g. San Francisco'}
                    className="w-full text-xs pl-8 pr-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-normal">
                  {useCurrentLocation
                    ? 'Searches prioritize nearby spots. If GPS is off or unavailable, jelly searches around this city.'
                    : 'All restaurant searches will be biased toward this city.'}
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 block">
                Gut-Feeling Spectrum Scale
              </label>
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800">
                <button
                  type="button"
                  onClick={() => onLinearRatingScaleChange(false)}
                  className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold transition-all ${
                    !linearRatingScale
                      ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                >
                  Tiered
                </button>
                <button
                  type="button"
                  onClick={() => onLinearRatingScaleChange(true)}
                  className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold transition-all ${
                    linearRatingScale
                      ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                >
                  Linear
                </button>
              </div>
              <div className="pt-1">
                <div
                  className="relative h-8 w-full rounded-xl ring-1 ring-inset ring-black/10 dark:ring-white/15"
                  style={{ backgroundImage: spectrumGradient(linearRatingScale), backgroundOrigin: 'border-box' }}
                >
                  {RATING_TIERS.slice(1).map((tier) => (
                    <div
                      key={tier.name}
                      className="absolute top-1.5 bottom-1.5 w-px bg-white/35 dark:bg-black/25"
                      style={{ left: `${spectrumRatingToPct(tier.from, linearRatingScale)}%` }}
                    />
                  ))}
                </div>
                <div className="relative h-5 mt-1.5 text-[10px] font-semibold select-none">
                  {RATING_TIERS.map((zone) => (
                    <span
                      key={zone.name}
                      className={`absolute -translate-x-1/2 ${zone.zoneClass}`}
                      style={{ left: `${spectrumRatingToPct(zone.zoneRating, linearRatingScale)}%` }}
                    >
                      {zone.name}
                    </span>
                  ))}
                </div>
              </div>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-snug min-h-[2.75em]">
                {linearRatingScale
                  ? 'Uniform spacing across the entire spectrum.'
                  : 'Each vibe tier gets room by how often people feel it, so the common middle is easier to tell apart.'}
              </p>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={onExport}
                className="px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-medium flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export JSON</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onOpenWhatsNew}
              className="w-full pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2 text-xs text-left group"
            >
              <span className="flex items-center gap-2 font-medium text-zinc-700 dark:text-zinc-300 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                What’s new
                {hasUnseenChangelog && (
                  <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                    New
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1 text-zinc-400 dark:text-zinc-500 tabular-nums">
                v{displayVersion(CURRENT_VERSION)}
                <ChevronRight className="w-3.5 h-3.5" />
              </span>
            </button>

            {onOpenFeedback && (
              <button
                type="button"
                onClick={onOpenFeedback}
                className="w-full pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2 text-xs text-left group"
              >
                <span className="flex items-center gap-2 font-medium text-zinc-700 dark:text-zinc-300 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                  <MessageCircleHeart className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  Send feedback / Report a bug
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
              </button>
            )}

            {email !== undefined && (
              <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-500">
                <span className="truncate">{email}</span>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1 shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign out</span>
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
};

import React, { useEffect, useState } from 'react';
import { Check, Copy, Download, Link2, Loader2, Share2 } from 'lucide-react';
import { BookmarkEntry, CATEGORY_LABEL, RestaurantEntry, SpotCategory } from '../types';
import { Sheet, SheetHeader } from './Sheet';
import { JellyBeanIcon } from './JellyBeanIcon';
import { spotPlaceLabel } from '../lib/media';
import { cardPixelSize, drawShareCard, type CardSpot } from '../lib/shareCard';
import { ScoreBadge } from './ScoreBadge';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  restaurants: RestaurantEntry[];
  bookmarks: BookmarkEntry[];
  selectedCategory: SpotCategory;
  selectedCity: string | 'ALL';
  selectedCuisine: string | 'ALL';
  ownerName: string;
  isSignedIn: boolean;
  darkMode?: boolean;
  onPublishShareLink: () => Promise<string | null>;
}

let logoImage: Promise<HTMLImageElement | null> | null = null;

/** The transparent logo drawn on the card, loaded once. */
function loadLogoImage(): Promise<HTMLImageElement | null> {
  logoImage ??= new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = '/jelly-logo.png';
  });
  return logoImage;
}

const toCardSpot = (r: RestaurantEntry): CardSpot => ({
  name: r.name,
  sub: [r.cuisines[0] || r.primaryTypeDisplay, spotPlaceLabel(r)].filter(Boolean).join(' · '),
  score: r.magicScore,
});

interface CardSpec {
  heading: string;
  spots: CardSpot[];
  dark: boolean;
  fileName: string;
}

/** The portrait top-10 card as a PNG file, ready for `navigator.share` or a download. */
async function renderCardFile({ fileName, ...content }: CardSpec): Promise<File | null> {
  const { width, height } = cardPixelSize('portrait', content.spots.length);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawShareCard(ctx, 'portrait', { ...content, logo: await loadLogoImage() });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob && new File([blob], fileName, { type: 'image/png' });
}

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  restaurants,
  selectedCategory,
  selectedCity,
  selectedCuisine,
  ownerName,
  isSignedIn,
  darkMode,
  onPublishShareLink,
}) => {
  const [isPublishing, setIsPublishing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [card, setCard] = useState<{ key: string; file: File | null } | null>(null);

  const topSpots = restaurants.slice(0, 10);

  // e.g. "Top Japanese Restaurants · Seattle" or "Top Coffee & Tea"
  const cardTitle = `Top ${selectedCuisine !== 'ALL' ? `${selectedCuisine} ` : ''}${
    CATEGORY_LABEL[selectedCategory]
  }${selectedCity !== 'ALL' ? ` · ${selectedCity}` : ''}`;

  const cardKey = JSON.stringify({
    heading: `${ownerName ? `${ownerName} · ` : ''}${cardTitle}`,
    spots: topSpots.map(toCardSpot),
    dark: darkMode ?? document.documentElement.classList.contains('dark'),
    fileName: `jelly-${cardTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`,
  } satisfies CardSpec);

  // Drawn ahead of time, so tapping Share opens the share sheet right away (iOS only allows that
  // straight from the tap)
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    renderCardFile(JSON.parse(cardKey) as CardSpec).then((file) => {
      if (!cancelled) setCard({ key: cardKey, file });
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, cardKey]);

  if (!isOpen) return null;

  const cardFile = card?.key === cardKey ? card.file : null;

  const canNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const canShareCard =
    canNativeShare &&
    typeof navigator.canShare === 'function' &&
    (!cardFile || navigator.canShare({ files: [cardFile] }));

  const buildTextSummary = (urlToInclude?: string | null) => {
    const lines = [
      `🍬 ${ownerName ? `${ownerName}'s ` : ''}${cardTitle} on jelly`,
      ...topSpots.map(
        (r, i) =>
          `${i + 1}. ${r.name} (${r.magicScore.toFixed(1)}) – ${[
            r.cuisines[0] || r.primaryTypeDisplay,
            spotPlaceLabel(r),
          ]
            .filter(Boolean)
            .join(' · ')}`
      ),
      urlToInclude || shareUrl || 'https://eatwithjelly.com',
    ];
    return lines.join('\n');
  };

  const handleCopyShareLink = async () => {
    setIsPublishing(true);
    try {
      const url = await onPublishShareLink();
      if (url) {
        setShareUrl(url);
        await navigator.clipboard.writeText(url);
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2500);
      }
    } finally {
      setIsPublishing(false);
    }
  };

  const handleNativeShareLink = async () => {
    setIsPublishing(true);
    try {
      const url = isSignedIn ? await onPublishShareLink() : window.location.origin;
      if (url && isSignedIn) setShareUrl(url);
      const effectiveUrl = url || window.location.origin;

      if (canNativeShare) {
        try {
          await navigator.share({
            title: `${ownerName ? `${ownerName}'s ` : ''}jelly list`,
            text: `Check out ${ownerName ? `${ownerName}'s ` : 'my '}${cardTitle} on jelly!`,
            url: effectiveUrl,
          });
          return;
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
        }
      }

      await navigator.clipboard.writeText(effectiveUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } finally {
      setIsPublishing(false);
    }
  };

  const handleCopyTextSummary = async () => {
    await navigator.clipboard.writeText(buildTextSummary());
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2500);
  };

  const handleDownloadCardPng = async () => {
    const file = cardFile ?? (await renderCardFile(JSON.parse(cardKey) as CardSpec));
    if (!file) return;
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleShareCard = async () => {
    if (!cardFile) return;
    try {
      // The image alone: apps handed an image plus text often send only the text
      await navigator.share({
        files: [cardFile],
        title: `${ownerName ? `${ownerName}'s ` : ''}${cardTitle} on jelly`,
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') await handleDownloadCardPng();
    }
  };

  return (
    <Sheet onClose={onClose} maxWidthClassName="max-w-md" maxHeightClassName="max-h-[90vh]">
      {(scrollContainerRef) => (
        <>
          <SheetHeader
            icon={<Share2 className="w-4 h-4 text-emerald-500" />}
            title="Share your jelly list"
            onClose={onClose}
          />

          <div ref={scrollContainerRef} className="p-5 space-y-4 overflow-y-auto">
            {/* Live Read-Only Share Link Section */}
            <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/70 dark:border-zinc-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                    Read-Only Public Link
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Anyone with the link can browse your ranked list &amp; map
                  </div>
                </div>

                {isSignedIn ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {canNativeShare && (
                      <button
                        type="button"
                        onClick={handleNativeShareLink}
                        disabled={isPublishing}
                        className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-zinc-950 text-xs font-bold flex items-center gap-1.5 transition-colors"
                      >
                        {isPublishing ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Share2 className="w-3.5 h-3.5" />
                        )}
                        <span>Share</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={handleCopyShareLink}
                      disabled={isPublishing}
                      className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors ${
                        canNativeShare
                          ? 'bg-zinc-200/80 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200'
                          : 'bg-zinc-900 hover:bg-zinc-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-zinc-950'
                      }`}
                    >
                      {isPublishing && !canNativeShare ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : copiedLink ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Link2 className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedLink ? 'Copied!' : 'Copy Link'}</span>
                    </button>
                  </div>
                ) : (
                  <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                    Sign in to create live link
                  </span>
                )}
              </div>

              {shareUrl && (
                <div className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-[11px] font-mono text-zinc-600 dark:text-zinc-300 truncate">
                  {shareUrl}
                </div>
              )}
            </div>

            {/* Preview of Top 10 Snapshot Card (matches light / dark theme) */}
            <div className="rounded-2xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 p-4 border border-zinc-200/90 dark:border-zinc-800 space-y-3 shadow-inner">
              <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800/80 pb-2.5">
                <div className="flex items-center gap-2">
                  <JellyBeanIcon size={20} />
                  <div>
                    <div className="font-display font-extrabold text-sm leading-none text-zinc-900 dark:text-white">
                      jelly
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                      {ownerName ? `${ownerName} · ` : ''}
                      {cardTitle}
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  eatwithjelly.com
                </span>
              </div>

              <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {topSpots.map((spot, idx) => (
                  <div key={spot.id} className="py-2 flex items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-4 text-xs font-bold text-zinc-400 dark:text-zinc-500 tabular-nums shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                          {spot.name}
                        </div>
                        <div className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
                          {[
                            spot.cuisines[0] || spot.primaryTypeDisplay,
                            spotPlaceLabel(spot),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                    </div>
                    <ScoreBadge score={spot.magicScore} size="sm" />
                  </div>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-1">
              {canShareCard && (
                <button
                  type="button"
                  onClick={handleShareCard}
                  disabled={!cardFile}
                  className="w-full disabled:opacity-60 py-3 px-4 rounded-2xl bg-zinc-900 hover:bg-zinc-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-zinc-950 text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-2xs"
                >
                  <Share2 className="w-4 h-4" />
                  <span>Share Top 10 Card</span>
                </button>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={handleDownloadCardPng}
                  className="py-2.5 px-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Save Card PNG</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyTextSummary}
                  className="py-2.5 px-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  {copiedText ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedText ? 'Copied Text!' : 'Copy as Text'}</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </Sheet>
  );
};

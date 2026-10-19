import React, { useState } from 'react';
import { Check, Copy, Download, Link2, Loader2, Share2, X } from 'lucide-react';
import { BookmarkEntry, CATEGORY_LABEL, RestaurantEntry, SpotCategory } from '../types';
import { useSwipeDownDismiss } from '../lib/useSwipeDownDismiss';
import { JellyBeanIcon } from './JellyBeanIcon';
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

function getScoreBadgeHex(score: number): string {
  if (score >= 9.0) return '#059669';
  if (score >= 7.8) return '#0d9488';
  if (score >= 6.5) return '#d97706';
  return '#e11d48';
}

function loadLogoImage(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = '/jelly-logo.png';
  });
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

  const {
    sheetStyle,
    backdropStyle,
    sheetRef,
    scrollContainerRef,
    bindSheetTouch,
    bindHandleTouch,
  } = useSwipeDownDismiss({ onClose });

  if (!isOpen) return null;

  const topSpots = restaurants.slice(0, 10);

  // e.g. "Top Japanese Restaurants · Seattle" or "Top Coffee & Tea"
  const cardTitle = `Top ${selectedCuisine !== 'ALL' ? `${selectedCuisine} ` : ''}${
    CATEGORY_LABEL[selectedCategory]
  }${selectedCity !== 'ALL' ? ` · ${selectedCity}` : ''}`;

  const canNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const buildTextSummary = (urlToInclude?: string | null) => {
    const lines = [
      `🍬 ${ownerName ? `${ownerName}'s ` : ''}${cardTitle} on jelly`,
      ...topSpots.map(
        (r, i) =>
          `${i + 1}. ${r.name} (${r.magicScore.toFixed(1)}) — ${[
            r.cuisines[0] || r.primaryTypeDisplay,
            r.neighborhood || r.city,
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
            title: `${ownerName ? `${ownerName}'s ` : ''}jelly restaurant list`,
            text: `Check out ${ownerName ? `${ownerName}'s ` : 'my '}ranked restaurant list on jelly!`,
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

  const renderCardCanvas = async (): Promise<HTMLCanvasElement | null> => {
    const scale = 2;
    const width = 440;
    const rowHeight = 46;
    const headerHeight = 96;
    const footerHeight = 52;
    const height = headerHeight + Math.max(1, topSpots.length) * rowHeight + footerHeight;

    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.scale(scale, scale);

    const isDark =
      darkMode ??
      (typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));

    const colors = isDark
      ? {
          bg: '#09090b',
          border: '#27272a',
          headerTitle: '#f4f4f5',
          headerSub: '#a1a1aa',
          divider: '#18181b',
          rank: '#71717a',
          name: '#f4f4f5',
          sub: '#71717a',
          footer: '#52525b',
        }
      : {
          bg: '#ffffff',
          border: '#e4e4e7',
          headerTitle: '#18181b',
          headerSub: '#71717a',
          divider: '#f4f4f5',
          rank: '#a1a1aa',
          name: '#18181b',
          sub: '#71717a',
          footer: '#71717a',
        };

    // Background
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);

    // Border
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, width - 2, height - 2);

    // Header Logo & Title
    const logoImg = await loadLogoImage();
    if (logoImg) {
      ctx.drawImage(logoImg, 26, 26, 24, 24);
      ctx.fillStyle = colors.headerTitle;
      ctx.font = '800 20px Inter, system-ui, sans-serif';
      ctx.fillText('jelly', 58, 44);
    } else {
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(34, 38, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(46, 42, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = colors.headerTitle;
      ctx.font = '800 20px Inter, system-ui, sans-serif';
      ctx.fillText('jelly', 62, 45);
    }

    ctx.fillStyle = colors.headerSub;
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.fillText(
      `${ownerName ? `${ownerName} · ` : ''}${cardTitle}`,
      26,
      74
    );

    // Divider
    ctx.strokeStyle = colors.divider;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(24, 88);
    ctx.lineTo(width - 24, 88);
    ctx.stroke();

    // Rows
    topSpots.forEach((spot, idx) => {
      const y = headerHeight + idx * rowHeight;

      // Rank
      ctx.fillStyle = colors.rank;
      ctx.font = '700 13px Inter, system-ui, sans-serif';
      ctx.fillText(`${idx + 1}`, 26, y + 24);

      // Name
      ctx.fillStyle = colors.name;
      ctx.font = '700 14px Inter, system-ui, sans-serif';
      const maxNameWidth = 270;
      let displayName = spot.name;
      while (ctx.measureText(displayName).width > maxNameWidth && displayName.length > 4) {
        displayName = displayName.slice(0, -2) + '…';
      }
      ctx.fillText(displayName, 54, y + 19);

      // Subtitle
      const sub = [
        spot.cuisines[0] || spot.primaryTypeDisplay,
        spot.neighborhood || spot.city,
      ]
        .filter(Boolean)
        .join(' · ');
      ctx.fillStyle = colors.sub;
      ctx.font = '500 11px Inter, system-ui, sans-serif';
      ctx.fillText(sub, 54, y + 35);

      // Score circle
      const badgeX = width - 42;
      const badgeY = y + 22;
      ctx.fillStyle = getScoreBadgeHex(spot.magicScore);
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, 15, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = '800 11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(spot.magicScore.toFixed(1), badgeX, badgeY + 4);
      ctx.textAlign = 'left';
    });

    // Footer
    ctx.fillStyle = colors.footer;
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.fillText('eatwithjelly.com', 26, height - 20);

    return canvas;
  };

  const handleDownloadCardPng = async () => {
    const canvas = await renderCardCanvas();
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `jelly-${cardTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
    a.click();
  };

  const handleNativeShareListOrCard = async () => {
    setIsPublishing(true);
    let effectiveUrl = shareUrl;
    if (!effectiveUrl && isSignedIn) {
      try {
        effectiveUrl = await onPublishShareLink();
        if (effectiveUrl) setShareUrl(effectiveUrl);
      } catch {
        // Fall back to origin
      }
    }
    const finalUrl =
      effectiveUrl || (typeof window !== 'undefined' ? window.location.origin : 'https://eatwithjelly.com');
    const title = `${ownerName ? `${ownerName}'s ` : ''}${cardTitle} on jelly`;
    const blurb = `🍬 Check out ${ownerName ? `${ownerName}'s ` : 'my '}${cardTitle.toLowerCase()} on jelly! ${finalUrl}`;

    try {
      if (canNativeShare) {
        const canvas = await renderCardCanvas();
        if (canvas && typeof navigator.canShare === 'function') {
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob((b) => resolve(b), 'image/png')
          );
          if (blob) {
            const fileName = `jelly-${cardTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
            const file = new File([blob], fileName, { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({
                files: [file],
                title,
                text: blurb,
              });
              return;
            }
          }
        }
        await navigator.share({
          title,
          text: blurb,
          url: finalUrl,
        });
        return;
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
    } finally {
      setIsPublishing(false);
    }

    await handleCopyTextSummary();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-xs p-0 sm:p-4 animate-jelly-backdrop overscroll-contain"
      style={backdropStyle}
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        {...bindSheetTouch}
        style={sheetStyle}
        className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800 overflow-hidden flex flex-col max-h-[90vh] animate-jelly-sheet overscroll-contain touch-manipulation"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile Swipe-Down Handle Pill */}
        <div
          {...bindHandleTouch}
          className="w-full pt-2.5 pb-1 flex justify-center sm:hidden cursor-grab active:cursor-grabbing shrink-0 touch-none select-none"
        >
          <div className="w-10 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700 pointer-events-none" />
        </div>

        <div className="px-5 pt-3 sm:pt-4 pb-3 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 touch-none select-none">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-emerald-500" />
            <h2 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
              Share your jelly list
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

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
                          spot.neighborhood || spot.city,
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
            {canNativeShare && (
              <button
                type="button"
                onClick={handleNativeShareListOrCard}
                className="w-full py-3 px-4 rounded-2xl bg-zinc-900 hover:bg-zinc-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-zinc-950 text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-2xs"
              >
                <Share2 className="w-4 h-4" />
                <span>Share Top 10 Card &amp; List</span>
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
      </div>
    </div>
  );
};

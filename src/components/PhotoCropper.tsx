import React, { useEffect, useRef, useState } from 'react';
import { Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';
import {
  centeredCrop,
  clampCrop,
  Crop,
  DecodedPhoto,
  MAX_ZOOM,
  MIN_ZOOM,
  renderCroppedPhoto,
  zoomAround,
} from '../lib/photoCrop';

interface PhotoCropperProps {
  photo: DecodedPhoto;
  onCancel: () => void;
  /** Gets the cropped 512×512 picture; resolve true to close, false to stay (e.g. upload failed) */
  onSave: (blob: Blob) => Promise<boolean>;
  /** The crop couldn't be drawn or encoded */
  onError: () => void;
}

interface Pointer {
  x: number;
  y: number;
}

/**
 * Full-screen square crop for a new profile picture: centred by default, drag to move, pinch
 * (or scroll, or the slider) to zoom. The circle shows what friends will see.
 */
export const PhotoCropper: React.FC<PhotoCropperProps> = ({ photo, onCancel, onSave, onError }) => {
  useBodyScrollLock();
  const { width, height } = photo;
  const [crop, setCrop] = useState<Crop>(centeredCrop);
  const [saving, setSaving] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Pointer>());
  const gesture = useRef<{ crop: Crop; center: Pointer; distance: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel, saving]);

  // Wheel zoom needs a non-passive listener to stop the page from scrolling
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = frame.getBoundingClientRect();
      const focus = {
        x: (e.clientX - rect.left) / rect.width - 0.5,
        y: (e.clientY - rect.top) / rect.height - 0.5,
      };
      setCrop((c) => zoomAround(width, height, c, c.zoom * Math.exp(-e.deltaY / 300), focus));
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
  }, [width, height]);

  /** Starts a fresh gesture from the fingers currently down (so adding/lifting one doesn't jump). */
  const restartGesture = (current: Crop) => {
    const pts = [...pointers.current.values()];
    if (pts.length === 0) {
      gesture.current = null;
      return;
    }
    const center = {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
    const distance = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = { crop: current, center, distance };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (saving) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    restartGesture(crop);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current || !frameRef.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const side = frameRef.current.getBoundingClientRect().width || 1;
    const rect = frameRef.current.getBoundingClientRect();
    const pts = [...pointers.current.values()];
    const start = gesture.current;
    const center = {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
    // Move with the fingers' midpoint…
    let next: Crop = {
      ...start.crop,
      x: start.crop.x + (center.x - start.center.x) / side,
      y: start.crop.y + (center.y - start.center.y) / side,
    };
    // …and zoom by how far they spread, around that midpoint
    if (pts.length > 1 && start.distance > 0) {
      const distance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const focus = {
        x: (center.x - rect.left) / side - 0.5,
        y: (center.y - rect.top) / side - 0.5,
      };
      next = zoomAround(width, height, next, start.crop.zoom * (distance / start.distance), focus);
    }
    setCrop(clampCrop(width, height, next));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    restartGesture(crop);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    let done = false;
    try {
      done = await onSave(await renderCroppedPhoto(photo, crop));
    } catch (err) {
      console.error('Could not prepare the photo:', err);
      onError();
    } finally {
      if (!done) setSaving(false);
    }
  };

  // The picture's on-screen box, as percentages of the square
  const short = Math.min(width, height);
  const boxW = (width / short) * crop.zoom * 100;
  const boxH = (height / short) * crop.zoom * 100;
  const left = 50 + crop.x * 100 - boxW / 2;
  const top = 50 + crop.y * 100 - boxH / 2;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Move and scale your photo"
      className="fixed inset-0 z-[60] bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col animate-jelly-backdrop"
    >
      <div className="pt-[env(safe-area-inset-top)] border-b border-zinc-900/10 dark:border-white/10">
        <div className="max-w-xl mx-auto h-12 px-2 grid grid-cols-[5.5rem_1fr_5.5rem] items-center">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="h-10 px-3 justify-self-start rounded-full text-[15px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 disabled:opacity-40"
          >
            Cancel
          </button>
          <h2 className="text-center text-[15px] font-bold truncate">Move and scale</h2>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="h-9 min-w-[4.5rem] px-4 justify-self-end rounded-full bg-emerald-500 text-white dark:text-zinc-950 text-sm font-bold flex items-center justify-center gap-1.5 active:scale-[0.97] transition disabled:opacity-70"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-label="Saving" /> : 'Save'}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-6 px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        <div
          ref={frameRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative w-[min(100%,22rem,calc(100dvh-16rem))] aspect-square overflow-hidden rounded-3xl bg-zinc-200 dark:bg-zinc-900 touch-none select-none cursor-grab active:cursor-grabbing"
        >
          <img
            src={photo.previewURL}
            alt=""
            draggable={false}
            className="absolute max-w-none pointer-events-none"
            style={{ left: `${left}%`, top: `${top}%`, width: `${boxW}%`, height: `${boxH}%` }}
          />
          {/* Dim everything outside the circle friends will see */}
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-full pointer-events-none shadow-[0_0_0_100vmax_rgba(250,250,250,0.72)] dark:shadow-[0_0_0_100vmax_rgba(9,9,11,0.66)] ring-2 ring-white/90 dark:ring-white/70"
          />
        </div>

        <div className="w-[min(100%,22rem)] flex items-center gap-3 text-zinc-400 dark:text-zinc-500">
          <ZoomOut className="w-4 h-4 shrink-0" aria-hidden="true" />
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            disabled={saving}
            onChange={(e) => setCrop((c) => zoomAround(width, height, c, Number(e.target.value)))}
            aria-label="Zoom"
            className="flex-1 accent-emerald-500"
          />
          <ZoomIn className="w-4 h-4 shrink-0" aria-hidden="true" />
        </div>
        <p className="-mt-3 text-xs text-zinc-500 dark:text-zinc-400">Drag to move · pinch to zoom</p>
      </div>
    </div>
  );
};

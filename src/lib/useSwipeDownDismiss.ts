import { CSSProperties, useRef, useState } from 'react';

export interface UseSwipeDownDismissOptions {
  onClose: () => void;
  threshold?: number;
  dismissDurationMs?: number;
}

export function computeSwipeDownDrag(
  dy: number,
  dx: number,
  scrollTop: number,
  forceSheet: boolean,
  wasDragging: boolean
): { isDragging: boolean; dragY: number } {
  if (forceSheet) {
    if (dy > 0) {
      const clamped = dy > 160 ? 160 + (dy - 160) * 0.45 : dy;
      return { isDragging: true, dragY: clamped };
    }
    return { isDragging: false, dragY: 0 };
  }

  if (!wasDragging) {
    if (dy > 8 && Math.abs(dy) > Math.abs(dx) * 1.25 && scrollTop <= 0) {
      return { isDragging: true, dragY: dy };
    }
    return { isDragging: false, dragY: 0 };
  }

  if (dy > 0) {
    const clamped = dy > 160 ? 160 + (dy - 160) * 0.45 : dy;
    return { isDragging: true, dragY: clamped };
  }
  return { isDragging: false, dragY: 0 };
}

export function shouldDismissSwipeDown(dragY: number, threshold = 80): boolean {
  return dragY > threshold;
}

export function useSwipeDownDismiss({
  onClose,
  threshold = 80,
  dismissDurationMs = 200,
}: UseSwipeDownDismissOptions) {
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);

  const scrollContainerNodeRef = useRef<HTMLElement | null>(null);
  const scrollContainerRef = (node: HTMLElement | null) => {
    scrollContainerNodeRef.current = node;
  };

  const touchStartRef = useRef<{
    startY: number;
    startX: number;
    forceSheet: boolean;
  } | null>(null);

  const handleTouchStart = (e: React.TouchEvent, forceSheet = false) => {
    if (e.touches.length !== 1 || isDismissing) return;
    touchStartRef.current = {
      startY: e.touches[0].clientY,
      startX: e.touches[0].clientX,
      forceSheet,
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current || e.touches.length !== 1 || isDismissing) return;
    const dy = e.touches[0].clientY - touchStartRef.current.startY;
    const dx = e.touches[0].clientX - touchStartRef.current.startX;
    const scrollTop = scrollContainerNodeRef.current ? scrollContainerNodeRef.current.scrollTop : 0;

    const next = computeSwipeDownDrag(
      dy,
      dx,
      scrollTop,
      touchStartRef.current.forceSheet,
      isDragging
    );
    setIsDragging(next.isDragging);
    setDragY(next.dragY);
  };

  const handleTouchEnd = () => {
    if (!touchStartRef.current) return;
    touchStartRef.current = null;

    if (isDragging) {
      setIsDragging(false);
      if (shouldDismissSwipeDown(dragY, threshold)) {
        setIsDismissing(true);
        setTimeout(() => {
          onClose();
          setIsDismissing(false);
          setDragY(0);
        }, dismissDurationMs);
      } else {
        setDragY(0);
      }
    }
  };

  const sheetStyle: CSSProperties = {
    transform: isDismissing
      ? 'translate3d(0, 100%, 0)'
      : dragY > 0
      ? `translate3d(0, ${dragY}px, 0)`
      : undefined,
    transition: isDismissing
      ? `transform ${dismissDurationMs}ms cubic-bezier(0.16, 1, 0.3, 1)`
      : isDragging
      ? 'none'
      : 'transform 240ms cubic-bezier(0.16, 1, 0.3, 1)',
  };

  const backdropOpacity = isDismissing
    ? 0
    : dragY > 0
    ? Math.max(0.15, 1 - dragY / 280)
    : 1;

  const backdropStyle: CSSProperties = {
    opacity: backdropOpacity,
    transition: isDismissing
      ? `opacity ${dismissDurationMs}ms ease-out`
      : isDragging
      ? 'none'
      : 'opacity 240ms ease-out',
  };

  return {
    dragY,
    isDragging,
    isDismissing,
    sheetStyle,
    backdropStyle,
    scrollContainerRef,
    bindSheetTouch: {
      onTouchStart: (e: React.TouchEvent) => handleTouchStart(e, false),
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: handleTouchEnd,
    },
    bindHandleTouch: {
      onTouchStart: (e: React.TouchEvent) => handleTouchStart(e, true),
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: handleTouchEnd,
    },
  };
}

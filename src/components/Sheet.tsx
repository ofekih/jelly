import React from 'react';
import { X } from 'lucide-react';
import { useSwipeDownDismiss } from '../lib/useSwipeDownDismiss';

interface SheetProps {
  onClose: () => void;
  /** Tailwind max-width class for the sheet, e.g. `max-w-md`. */
  maxWidthClassName?: string;
  /** Tailwind max-height class for the sheet, e.g. `max-h-[88vh]`. */
  maxHeightClassName?: string;
  /**
   * Render prop receiving the ref for the sheet's scrollable body, so swipe-down only
   * engages when that body is scrolled to the top.
   */
  children: (scrollContainerRef: (node: HTMLElement | null) => void) => React.ReactNode;
}

/**
 * Shared modal shell: backdrop, bottom sheet on mobile (dialog on desktop), and the
 * swipe-down-to-dismiss handle. Render only while open.
 */
export const Sheet: React.FC<SheetProps> = ({
  onClose,
  maxWidthClassName = 'max-w-md',
  maxHeightClassName = 'max-h-[88vh]',
  children,
}) => {
  const {
    sheetStyle,
    backdropStyle,
    sheetRef,
    scrollContainerRef,
    bindSheetTouch,
    bindHandleTouch,
  } = useSwipeDownDismiss({ onClose });

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
        className={`w-full ${maxWidthClassName} ${maxHeightClassName} bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800 overflow-hidden flex flex-col animate-jelly-sheet overscroll-contain touch-manipulation`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile Swipe-Down Handle Pill */}
        <div
          {...bindHandleTouch}
          className="w-full pt-2.5 pb-1 flex justify-center sm:hidden cursor-grab active:cursor-grabbing shrink-0 touch-none select-none"
        >
          <div className="w-10 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700 pointer-events-none" />
        </div>

        {children(scrollContainerRef)}
      </div>
    </div>
  );
};

interface SheetHeaderProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** Extra content rendered after the title (e.g. a badge). */
  children?: React.ReactNode;
  onClose: () => void;
}

/** Standard compact header: icon + title on the left, close button on the right. */
export const SheetHeader: React.FC<SheetHeaderProps> = ({ icon, title, children, onClose }) => (
  <div className="px-5 pt-3 sm:pt-4 pb-3 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 touch-none select-none">
    <div className="flex items-center gap-2">
      {icon}
      <h2 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">{title}</h2>
      {children}
    </div>
    <CloseButton onClick={onClose} />
  </div>
);

export const CloseButton: React.FC<{ onClick: () => void; className?: string; iconClassName?: string }> = ({
  onClick,
  className = '-mr-1.5',
  iconClassName = 'w-4 h-4',
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`p-1.5 rounded-full text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${className}`}
    aria-label="Close"
  >
    <X className={iconClassName} />
  </button>
);

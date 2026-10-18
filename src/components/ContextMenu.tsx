import React, { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

export interface ContextMenuProps {
  isOpen: boolean;
  x: number;
  y: number;
  title?: string;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  isOpen,
  x,
  y,
  title,
  items,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleWindowClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const handleScroll = () => {
      onClose();
    };

    window.addEventListener('click', handleWindowClick);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('click', handleWindowClick);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Clamp positioning to keep menu inside viewport
  const menuWidth = 220;
  const menuHeight = items.length * 36 + (title ? 36 : 0) + 16;
  const clampedX = Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : 800) - menuWidth - 12);
  const clampedY = Math.min(y, (typeof window !== 'undefined' ? window.innerHeight : 600) - menuHeight - 12);

  return (
    <div
      ref={menuRef}
      style={{
        left: `${Math.max(12, clampedX)}px`,
        top: `${Math.max(12, clampedY)}px`,
      }}
      className="fixed z-[100] w-56 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 shadow-2xl p-1.5 text-xs text-zinc-900 dark:text-zinc-100 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {title && (
        <div className="px-3 py-1.5 font-bold text-[11px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider truncate border-b border-zinc-100 dark:border-zinc-800/80 mb-1">
          {title}
        </div>
      )}
      <div className="space-y-0.5">
        {items.map((item, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left font-medium transition-colors ${
              item.danger
                ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200'
            }`}
          >
            {item.icon && <span className="shrink-0">{item.icon}</span>}
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

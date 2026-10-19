import React from 'react';
import { LogOut, Trash2, X } from 'lucide-react';
import { useBodyScrollLock } from '../lib/useBodyScrollLock';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  iconVariant?: 'danger' | 'logout';
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Remove',
  cancelLabel = 'Cancel',
  iconVariant = 'danger',
  onConfirm,
  onCancel,
}) => {
  useBodyScrollLock(isOpen);
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-xs p-4 animate-jelly-backdrop"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-xs bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800 overflow-hidden p-5 space-y-4 animate-jelly-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-8 h-8 rounded-2xl flex items-center justify-center shrink-0 ${
                iconVariant === 'logout'
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
              }`}
            >
              {iconVariant === 'logout' ? (
                <LogOut className="w-4 h-4" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </div>
            <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100 leading-snug">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
          {message}
        </p>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="py-2.5 px-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-semibold transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

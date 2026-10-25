import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { decodePhoto, DecodedPhoto } from '../lib/photoCrop';
import { Avatar } from './Avatar';
import { PhotoCropper } from './PhotoCropper';
import { Sheet, SheetHeader } from './Sheet';

interface ProfilePhotoButtonProps {
  /** The photo shown now (`displayPhotoURL`) */
  photoURL: string | null;
  name: string | null;
  size: number;
  className?: string;
  /** Whether an uploaded picture is in use (offers "Remove photo") */
  hasCustomPhoto: boolean;
  /** Uploads the cropped picture; resolves true once it's in use */
  onSave: (photo: Blob) => Promise<boolean>;
  onRemove: () => Promise<void>;
  onError: (message: string) => void;
}

/**
 * Your avatar on the profile page with a camera badge: tap to pick a picture (camera or photo
 * library on phones), crop it to a square, upload. With an uploaded picture, tapping first offers
 * a new one or going back to your Google photo.
 */
export const ProfilePhotoButton: React.FC<ProfilePhotoButtonProps> = ({
  photoURL,
  name,
  size,
  className = '',
  hasCustomPhoto,
  onSave,
  onRemove,
  onError,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [photo, setPhoto] = useState<DecodedPhoto | null>(null);
  const [busy, setBusy] = useState(false);

  // Free the preview's object URL when the cropper closes
  useEffect(() => {
    if (!photo) return;
    return () => URL.revokeObjectURL(photo.previewURL);
  }, [photo]);

  // iOS only opens the picker straight from a tap, so this runs inside the click handler
  const pickFile = () => {
    setMenuOpen(false);
    inputRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      setPhoto(await decodePhoto(file));
    } catch (err) {
      console.error('Could not open the picture:', err);
      onError('Couldn’t open that picture – try a JPEG or PNG');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setMenuOpen(false);
    setBusy(true);
    try {
      await onRemove();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => (hasCustomPhoto ? setMenuOpen(true) : pickFile())}
        disabled={busy}
        aria-label={hasCustomPhoto ? 'Change profile photo' : 'Upload a profile photo'}
        className="relative rounded-full active:scale-[0.97] transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-500"
      >
        <Avatar photoURL={photoURL} name={name} size={size} className={className} />
        {busy && (
          <span className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          </span>
        )}
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -bottom-0.5 w-8 h-8 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 ring-[3px] ring-zinc-50 dark:ring-zinc-950 flex items-center justify-center shadow-sm"
        >
          <Camera className="w-4 h-4" />
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={onFile}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="profile-photo-input"
      />

      {/* Portaled: the profile page's own stacking context sits under the bottom bar */}
      {menuOpen &&
        createPortal(
          <Sheet onClose={() => setMenuOpen(false)} maxWidthClassName="max-w-sm" maxHeightClassName="max-h-[60vh]">
            {() => (
              <>
                <SheetHeader title="Profile photo" onClose={() => setMenuOpen(false)} />
                <div className="p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] space-y-1">
                  <button
                    type="button"
                    onClick={pickFile}
                    className="w-full min-h-[3.25rem] px-3 rounded-xl flex items-center gap-3 text-[15px] font-medium text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:bg-zinc-100 dark:active:bg-zinc-800 transition-colors"
                  >
                    <ImagePlus className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />
                    Choose a new photo
                  </button>
                  <button
                    type="button"
                    onClick={remove}
                    className="w-full min-h-[3.25rem] px-3 rounded-xl flex items-center gap-3 text-[15px] font-medium text-rose-600 dark:text-rose-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:bg-zinc-100 dark:active:bg-zinc-800 transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                    Remove photo
                  </button>
                </div>
              </>
            )}
          </Sheet>,
          document.body
        )}

      {photo &&
        createPortal(
          <PhotoCropper
            photo={photo}
            onCancel={() => setPhoto(null)}
            onError={() => onError('Couldn’t prepare that picture – try another one')}
            onSave={async (blob) => {
              const ok = await onSave(blob);
              if (ok) setPhoto(null);
              return ok;
            }}
          />,
          document.body
        )}
    </>
  );
};

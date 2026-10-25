/**
 * The square crop behind uploading a profile picture (`PhotoCropper`). Pure math plus the
 * browser-only decode/encode steps; no Firebase here.
 *
 * A crop is described independently of the on-screen size: `zoom` 1 means the picture's short
 * side exactly fills the square, and `x`/`y` are how far the picture's centre sits from the
 * square's centre, as a fraction of the square's side.
 */
export interface Crop {
  zoom: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
/** Side of the uploaded square, in pixels */
export const PHOTO_OUTPUT_SIZE = 512;
/** Long side the decoded picture is scaled down to before cropping (keeps phones' memory low) */
const MAX_SOURCE_SIDE = 2048;

export const centeredCrop = (): Crop => ({ zoom: 1, x: 0, y: 0 });

/** Keeps the zoom in range and the picture covering the whole square. */
export function clampCrop(width: number, height: number, crop: Crop): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, crop.zoom));
  const short = Math.min(width, height);
  const maxX = ((width / short) * zoom - 1) / 2;
  const maxY = ((height / short) * zoom - 1) / 2;
  const clamp = (v: number, max: number) => Math.min(max, Math.max(-max, v)) || 0;
  return { zoom, x: clamp(crop.x, maxX), y: clamp(crop.y, maxY) };
}

/**
 * Zooms to `zoom` keeping the point at `focus` (relative to the square's centre, as a fraction
 * of its side) still, like pinching around your fingers.
 */
export function zoomAround(width: number, height: number, crop: Crop, zoom: number, focus = { x: 0, y: 0 }): Crop {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const ratio = next / crop.zoom;
  return clampCrop(width, height, {
    zoom: next,
    x: focus.x - (focus.x - crop.x) * ratio,
    y: focus.y - (focus.y - crop.y) * ratio,
  });
}

/** The part of the picture (in its own pixels) that the square shows. */
export function cropRect(width: number, height: number, crop: Crop): { sx: number; sy: number; size: number } {
  const c = clampCrop(width, height, crop);
  const size = Math.min(width, height) / c.zoom;
  return {
    sx: width / 2 - (0.5 + c.x) * size,
    sy: height / 2 - (0.5 + c.y) * size,
    size,
  };
}

/** A decoded picture, already upright (EXIF orientation applied) and at most 2048px long. */
export interface DecodedPhoto {
  source: HTMLCanvasElement;
  width: number;
  height: number;
  /** Object URL of the original file for the on-screen preview; revoke when done */
  previewURL: string;
}

/**
 * Decodes a picked file. Browsers apply EXIF orientation when drawing an `<img>`, and iPhones
 * hand Safari a JPEG (or Safari decodes HEIC itself), so an `<img>` covers what the picker gives.
 */
export function decodePhoto(file: Blob): Promise<DecodedPhoto> {
  const previewURL = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) {
        URL.revokeObjectURL(previewURL);
        reject(new Error('empty image'));
        return;
      }
      const scale = Math.min(1, MAX_SOURCE_SIDE / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(previewURL);
        reject(new Error('no canvas'));
        return;
      }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({ source: canvas, width: canvas.width, height: canvas.height, previewURL });
    };
    img.onerror = () => {
      URL.revokeObjectURL(previewURL);
      reject(new Error('unsupported image'));
    };
    img.src = previewURL;
  });
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * The cropped 512×512 square as WebP, or JPEG where the browser can't encode WebP (older iOS
 * Safari quietly returns a PNG for `image/webp`, so the result's type is checked).
 */
export async function renderCroppedPhoto(photo: DecodedPhoto, crop: Crop): Promise<Blob> {
  const { sx, sy, size } = cropRect(photo.width, photo.height, crop);
  const canvas = document.createElement('canvas');
  canvas.width = PHOTO_OUTPUT_SIZE;
  canvas.height = PHOTO_OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  // JPEG has no transparency: give see-through PNGs a white background instead of black
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PHOTO_OUTPUT_SIZE, PHOTO_OUTPUT_SIZE);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(photo.source, sx, sy, size, size, 0, 0, PHOTO_OUTPUT_SIZE, PHOTO_OUTPUT_SIZE);

  const webp = await toBlob(canvas, 'image/webp', 0.8);
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await toBlob(canvas, 'image/jpeg', 0.82);
  if (jpeg && jpeg.type === 'image/jpeg') return jpeg;
  throw new Error('could not encode the photo');
}

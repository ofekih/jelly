/**
 * Draws a share link's preview card as a PNG with `@napi-rs/canvas` (Skia), using the same
 * drawing code as the Share modal. Loaded lazily: only `sharePage` needs the native module.
 */
import path from 'node:path';
import { createCanvas, GlobalFonts, loadImage, type Image } from '@napi-rs/canvas';
import { drawShareCard, LANDSCAPE_PX, type CardSpot } from '../../src/lib/shareCard';

/** `functions/assets`: Inter (the app's font) and the transparent logo, `public/jelly-logo.png` */
const ASSETS = path.join(__dirname, '../../../assets');

let logo: Promise<Image | null> | null = null;

function setUp(): Promise<Image | null> {
  if (!logo) {
    for (const weight of [500, 600, 700, 800]) {
      GlobalFonts.registerFromPath(path.join(ASSETS, `Inter-${weight}.ttf`), 'Inter');
    }
    logo = loadImage(path.join(ASSETS, 'jelly-logo.png')).catch(() => null);
  }
  return logo;
}

export async function renderCardPng(heading: string, spots: CardSpot[]): Promise<Buffer> {
  const canvas = createCanvas(LANDSCAPE_PX.width, LANDSCAPE_PX.height);
  drawShareCard(canvas.getContext('2d'), 'landscape', { heading, spots, dark: true, logo: await setUp() });
  return canvas.encode('png');
}

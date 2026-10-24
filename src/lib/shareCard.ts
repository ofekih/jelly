/**
 * The top-10 card shared from the Share modal (a portrait PNG) and shown as the link preview of
 * `/l/<uid>` share links (a 1200×630 landscape PNG drawn by the `sharePage` function). Pure
 * drawing on a 2D context, so the browser canvas and `@napi-rs/canvas` share it.
 */

/** The parts of a 2D canvas context the card uses (the browser's and `@napi-rs/canvas`'s fit). */
export interface CardContext {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  font: string;
  textAlign: string;
  scale(x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  drawImage(image: never, x: number, y: number, w: number, h: number): void;
}

export interface CardSpot {
  name: string;
  /** "Japanese · Capitol Hill", "2019 · Bong Joon-ho" */
  sub: string;
  score: number;
}

export interface ShareCardContent {
  /** "Ofek · Top Restaurants · Seattle" */
  heading: string;
  spots: CardSpot[];
  dark: boolean;
  /** The transparent jelly logo (`/jelly-logo.png`); two drawn beans when missing */
  logo?: unknown;
}

/** Portrait: the card people share as an image. Landscape: the link preview (1.91:1). */
export type CardLayout = 'portrait' | 'landscape';

/** Link previews are drawn at this size (logical size × `LANDSCAPE_SCALE`). */
export const LANDSCAPE_PX = { width: 1200, height: 630 } as const;
const LANDSCAPE_SCALE = 2;

const FONT = 'Inter, system-ui, sans-serif';
const PORTRAIT = { width: 440, header: 96, row: 46, footer: 52 };
const LANDSCAPE = { header: 100, row: 38, gap: 28, margin: 28 };

export function getScoreBadgeHex(score: number): string {
  if (score >= 9.0) return '#059669';
  if (score >= 7.8) return '#0d9488';
  if (score >= 6.5) return '#d97706';
  return '#e11d48';
}

/** Canvas size in pixels (both layouts are drawn at 2× their logical size). */
export function cardPixelSize(layout: CardLayout, spotCount: number): { width: number; height: number } {
  if (layout === 'landscape') return { ...LANDSCAPE_PX };
  const height = PORTRAIT.header + Math.max(1, spotCount) * PORTRAIT.row + PORTRAIT.footer;
  return { width: PORTRAIT.width * 2, height: height * 2 };
}

function colorsFor(dark: boolean) {
  return dark
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
}

/** Cuts text to fit `maxWidth` in the current font, ending in "…". */
function fitText(ctx: CardContext, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** Draws the card onto a context sized by `cardPixelSize`. */
export function drawShareCard(ctx: CardContext, layout: CardLayout, content: ShareCardContent): void {
  const { width: px, height: py } = cardPixelSize(layout, content.spots.length);
  const scale = layout === 'landscape' ? LANDSCAPE_SCALE : 2;
  const width = px / scale;
  const height = py / scale;
  const big = layout === 'landscape' ? 1.15 : 1;
  const colors = colorsFor(content.dark);
  ctx.scale(scale, scale);

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  // Logo, wordmark and heading
  const logoSize = 24 * big;
  if (content.logo) {
    ctx.drawImage(content.logo as never, 26, 26, logoSize, logoSize);
  } else {
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(34, 38, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.arc(46, 42, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = colors.headerTitle;
  ctx.font = `800 ${20 * big}px ${FONT}`;
  ctx.fillText('jelly', 26 + logoSize + 8, 26 + logoSize * 0.75);

  ctx.fillStyle = colors.headerSub;
  ctx.font = `600 ${12 * big}px ${FONT}`;
  ctx.fillText(fitText(ctx, content.heading, width - 52), 26, 74 * big);

  const dividerY = 88 * big;
  ctx.strokeStyle = colors.divider;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(24, dividerY);
  ctx.lineTo(width - 24, dividerY);
  ctx.stroke();

  // Spots: one column on the portrait card; two columns of five on the link preview
  const landscape = layout === 'landscape';
  const columns = landscape && content.spots.length > 5 ? 2 : 1;
  const margin = landscape ? LANDSCAPE.margin : 26;
  const columnWidth = (width - margin * 2 - (columns - 1) * LANDSCAPE.gap) / columns;
  const rowHeight = landscape ? LANDSCAPE.row : PORTRAIT.row;
  const top = landscape ? LANDSCAPE.header + 4 : PORTRAIT.header;
  const badgeRadius = landscape ? 14 : 15;

  content.spots.forEach((spot, idx) => {
    const column = landscape ? Math.floor(idx / 5) : 0;
    const row = landscape ? idx % 5 : idx;
    const x = margin + column * (columnWidth + LANDSCAPE.gap);
    const y = top + row * rowHeight;
    const nameX = x + 28;
    const badgeX = x + columnWidth - badgeRadius - 2;
    const textWidth = badgeX - badgeRadius - 10 - nameX;

    ctx.fillStyle = colors.rank;
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText(`${idx + 1}`, x, y + 24);

    ctx.fillStyle = colors.name;
    ctx.font = `700 14px ${FONT}`;
    ctx.fillText(fitText(ctx, spot.name, textWidth), nameX, y + 19);

    ctx.fillStyle = colors.sub;
    ctx.font = `500 11px ${FONT}`;
    ctx.fillText(fitText(ctx, spot.sub, textWidth), nameX, y + 35);

    ctx.fillStyle = getScoreBadgeHex(spot.score);
    ctx.beginPath();
    ctx.arc(badgeX, y + 22, badgeRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(spot.score.toFixed(1), badgeX, y + 26);
    ctx.textAlign = 'left';
  });

  if (content.spots.length === 0) {
    ctx.fillStyle = colors.sub;
    ctx.font = `600 13px ${FONT}`;
    ctx.fillText('Nothing ranked here yet', margin, top + 24);
  }

  // Link previews show the site already
  if (landscape) return;
  ctx.fillStyle = colors.footer;
  ctx.font = `600 11px ${FONT}`;
  ctx.fillText('eatwithjelly.com', 26, height - 20);
}

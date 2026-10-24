/**
 * Link previews for share links. Messaging apps build a link's preview from the page's meta tags,
 * and the app is one static page, so `/l/<uid>?c=<category>` (a Hosting rewrite) serves the app's
 * own index.html with that list's title, description and card in its share-meta block, and
 * `/l/<uid>/card.png?c=` draws the card (`src/lib/shareCard.ts`, see `shareCardImage.ts`).
 */
import { ALL_CATEGORIES, CATEGORY_LABEL, isSpotCategory, type SpotCategory } from '../../src/types';
import { spotPlaceLabel } from '../../src/lib/media';
import type { CardSpot } from '../../src/lib/shareCard';

export const SITE = 'https://eatwithjelly.com';
/** Hosts whose index.html the function will serve; anything else gets the main site's. */
const SITE_HOSTS = new Set([
  'eatwithjelly.com',
  'www.eatwithjelly.com',
  'ofek-beli-ranker.web.app',
  'ofek-beli-ranker.firebaseapp.com',
]);
const SHARE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const TOP = 10;

export interface ShareTarget {
  shareId: string;
  kind: 'page' | 'card';
}

export function parseSharePath(path: string): ShareTarget | null {
  const match = path.match(/^\/l\/([^/]+?)(\/card\.png)?\/?$/);
  if (!match || !SHARE_ID.test(match[1])) return null;
  return { shareId: match[1], kind: match[2] ? 'card' : 'page' };
}

/** The site a request came through (Hosting sets `x-forwarded-host`). */
export function siteOrigin(forwardedHost: string | undefined): string {
  const host = forwardedHost?.split(',')[0].trim().toLowerCase();
  return host && SITE_HOSTS.has(host) ? `https://${host}` : SITE;
}

export interface ListPreview {
  ownerName: string;
  category: SpotCategory;
  spots: CardSpot[];
  /** Everything ranked in this list, not just the top */
  total: number;
  updatedAt: number;
}

/** The top of one list in a `sharedLists` doc: the one asked for, else the longest. */
export function listPreview(data: Record<string, unknown>, requested: unknown): ListPreview {
  const ranked = (Array.isArray(data.restaurants) ? data.restaurants : []).filter(
    (r): r is Record<string, any> =>
      !!r && typeof r.name === 'string' && isSpotCategory(r.category) && Number.isFinite(r.magicScore)
  );
  const counts = new Map<SpotCategory, number>();
  for (const r of ranked) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const category = isSpotCategory(requested)
    ? requested
    : ALL_CATEGORIES.reduce((best, c) => ((counts.get(c) ?? 0) > (counts.get(best) ?? 0) ? c : best));
  const rankOf = (r: Record<string, any>) => (Number.isFinite(r.rankIndex) ? r.rankIndex : Infinity);
  const list = ranked.filter((r) => r.category === category).sort((a, b) => rankOf(a) - rankOf(b));
  return {
    ownerName: typeof data.ownerName === 'string' && data.ownerName ? data.ownerName : 'Friend',
    category,
    spots: list.slice(0, TOP).map((r) => {
      const tag = Array.isArray(r.cuisines) && r.cuisines[0] ? r.cuisines[0] : r.primaryTypeDisplay;
      return {
        name: r.name,
        sub: [tag, spotPlaceLabel(r)].filter((part) => typeof part === 'string' && part).join(' · '),
        score: r.magicScore,
      };
    }),
    total: list.length,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
  };
}

export interface ShareMeta {
  title: string;
  description: string;
  url: string;
  image: string;
  imageAlt: string;
}

/** "Ofek's Top Restaurants on jelly" and its top three, like the Share modal words it. */
export function previewMeta(preview: ListPreview, shareId: string, origin: string): ShareMeta {
  const listName = `Top ${CATEGORY_LABEL[preview.category]}`;
  const top = preview.spots
    .slice(0, 3)
    .map((s, i) => `${i + 1}. ${s.name} (${s.score.toFixed(1)})`)
    .join(' · ');
  const more = preview.total > 3 ? ` · and ${preview.total - 3} more` : '';
  const path = `/l/${shareId}?c=${preview.category}`;
  return {
    title: `${preview.ownerName}'s ${listName} on jelly`,
    description: top ? `${top}${more}` : `${preview.ownerName}'s lists on jelly`,
    url: `${origin}${path}`,
    image: `${origin}/l/${shareId}/card.png?c=${preview.category}&v=${preview.updatedAt}`,
    imageAlt: `${preview.ownerName}'s ${listName.toLowerCase()} on jelly, ranked`,
  };
}

/** The share card's heading, as the Share modal draws it. */
export function cardHeading(preview: ListPreview): string {
  return `${preview.ownerName} · Top ${CATEGORY_LABEL[preview.category]}`;
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** index.html with its share-meta block and title for this list; null when the block is missing. */
export function withShareMeta(html: string, meta: ShareMeta): string | null {
  const block = /<!-- share-meta[\s\S]*?<!-- \/share-meta -->/;
  if (!block.test(html)) return null;
  const tag = (attr: 'property' | 'name', key: string, value: string) =>
    `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`;
  const tags = [
    tag('property', 'og:site_name', 'jelly'),
    tag('property', 'og:type', 'website'),
    tag('property', 'og:url', meta.url),
    tag('property', 'og:title', meta.title),
    tag('property', 'og:description', meta.description),
    tag('property', 'og:image', meta.image),
    tag('property', 'og:image:width', '1200'),
    tag('property', 'og:image:height', '630'),
    tag('property', 'og:image:alt', meta.imageAlt),
    tag('name', 'twitter:card', 'summary_large_image'),
  ].join('\n    ');
  return html
    .replace(block, () => tags)
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(meta.title)}</title>`);
}

const HTML_TTL_MS = 5 * 60 * 1000;
const htmlCache = new Map<string, { html: string; at: number }>();

/** The deployed app's index.html (its asset names change every deploy), cached briefly. */
export async function appHtml(origin: string): Promise<string | null> {
  const cached = htmlCache.get(origin);
  if (cached && Date.now() - cached.at < HTML_TTL_MS) return cached.html;
  try {
    const res = await fetch(`${origin}/index.html`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return cached?.html ?? null;
    const html = await res.text();
    htmlCache.set(origin, { html, at: Date.now() });
    return html;
  } catch {
    return cached?.html ?? null;
  }
}

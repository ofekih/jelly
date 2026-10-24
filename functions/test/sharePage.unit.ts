import { describe, expect, it } from 'vitest';
import { listPreview, parseSharePath, previewMeta, siteOrigin, withShareMeta } from '../src/sharePage';

const spot = (name: string, category: string, rankIndex: number, magicScore: number, extra = {}) => ({
  name,
  category,
  rankIndex,
  magicScore,
  cuisines: [],
  ...extra,
});

describe('parseSharePath', () => {
  it('reads the page and the card', () => {
    expect(parseSharePath('/l/abc_1')).toEqual({ shareId: 'abc_1', kind: 'page' });
    expect(parseSharePath('/l/abc_1/')).toEqual({ shareId: 'abc_1', kind: 'page' });
    expect(parseSharePath('/l/abc_1/card.png')).toEqual({ shareId: 'abc_1', kind: 'card' });
  });

  it('rejects anything else', () => {
    expect(parseSharePath('/l/')).toBeNull();
    expect(parseSharePath('/l/a.b')).toBeNull();
    expect(parseSharePath('/l/abc/other')).toBeNull();
    expect(parseSharePath('/about')).toBeNull();
  });
});

describe('siteOrigin', () => {
  it('serves only jelly’s own hosts', () => {
    expect(siteOrigin('ofek-beli-ranker.web.app')).toBe('https://ofek-beli-ranker.web.app');
    expect(siteOrigin('evil.example.com')).toBe('https://eatwithjelly.com');
    expect(siteOrigin(undefined)).toBe('https://eatwithjelly.com');
  });
});

describe('listPreview', () => {
  const data = {
    ownerName: 'Ofek',
    updatedAt: 42,
    restaurants: [
      spot('B', 'restaurants', 1, 8, { cuisines: ['Thai'], city: 'Seattle' }),
      spot('A', 'restaurants', 0, 9, { primaryTypeDisplay: 'Restaurant', neighborhood: 'Fremont' }),
      spot('Dune', 'movies', 0, 9.5, { media: { year: 2021, creator: 'Denis Villeneuve' } }),
      spot('Paddington 2', 'movies', 1, 9.2),
      spot('Heat', 'movies', 2, 9),
      { name: 'broken', category: 'movies' },
    ],
  };

  it('picks the requested list in rank order', () => {
    const preview = listPreview(data, 'restaurants');
    expect(preview.category).toBe('restaurants');
    expect(preview.spots).toEqual([
      { name: 'A', sub: 'Restaurant · Fremont', score: 9 },
      { name: 'B', sub: 'Thai · Seattle', score: 8 },
    ]);
    expect(preview.updatedAt).toBe(42);
  });

  it('falls back to the longest list', () => {
    const preview = listPreview(data, 'nope');
    expect(preview.category).toBe('movies');
    expect(preview.total).toBe(3);
    expect(preview.spots[0]).toEqual({ name: 'Dune', sub: '2021 · Denis Villeneuve', score: 9.5 });
  });

  it('keeps the top ten', () => {
    const many = Array.from({ length: 14 }, (_, i) => spot(`S${i}`, 'bars', i, 9 - i / 10));
    const preview = listPreview({ restaurants: many }, 'bars');
    expect(preview.spots).toHaveLength(10);
    expect(preview.total).toBe(14);
    expect(preview.ownerName).toBe('Friend');
  });
});

describe('previewMeta + withShareMeta', () => {
  const html = `<head>
    <title>jelly</title>
    <!-- share-meta: replaced -->
    <meta property="og:title" content="jelly" />
    <!-- /share-meta -->
  </head>`;

  it('puts the list in the title, description and image', () => {
    const preview = listPreview(
      { ownerName: 'Ofek "O" <3', updatedAt: 7, restaurants: [spot('A & B', 'bars', 0, 8.84), spot('C', 'bars', 1, 8)] },
      'bars'
    );
    const meta = previewMeta(preview, 'abc', 'https://eatwithjelly.com');
    expect(meta.title).toBe('Ofek "O" <3\'s Top Bars on jelly');
    expect(meta.description).toBe('1. A & B (8.8) · 2. C (8.0)');
    expect(meta.image).toBe('https://eatwithjelly.com/l/abc/card.png?c=bars&v=7');
    expect(meta.url).toBe('https://eatwithjelly.com/l/abc?c=bars');

    const page = withShareMeta(html, meta)!;
    expect(page).toContain('<title>Ofek &quot;O&quot; &lt;3&#39;s Top Bars on jelly</title>');
    expect(page).toContain('<meta property="og:description" content="1. A &amp; B (8.8) · 2. C (8.0)" />');
    expect(page).toContain('content="https://eatwithjelly.com/l/abc/card.png?c=bars&amp;v=7"');
    expect(page).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(page).not.toContain('content="jelly" />\n    <!-- /share-meta');
  });

  it('counts the rest past the top three', () => {
    const many = Array.from({ length: 5 }, (_, i) => spot(`S${i}`, 'bars', i, 9));
    expect(previewMeta(listPreview({ restaurants: many }, 'bars'), 'x', 'https://a').description).toMatch(
      / · and 2 more$/
    );
  });

  it('gives up when the page has no share-meta block', () => {
    const meta = previewMeta(listPreview({ restaurants: [] }, 'bars'), 'x', 'https://a');
    expect(withShareMeta('<title>jelly</title>', meta)).toBeNull();
  });
});

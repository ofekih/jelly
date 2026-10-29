/**
 * Book search for the Read lists, proxied so the Google Books key stays server-side and repeat
 * searches are served from the Hosting CDN (`/api/books/search?q=` rewrites here).
 *
 * Google Books lists every edition separately, so a book is identified by its first author's
 * surname and its title (`book:<surname>:<title>`): every edition of it is one book, however the
 * author's name is spelled ("J.R.R. Tolkien", "John Ronald Reuel Tolkien").
 */
import type { BookResult, ItemPrice } from '../../src/types';

const API = 'https://www.googleapis.com/books/v1/volumes';
const MAX_RESULTS = 10;
const FIELDS = 'items(volumeInfo(title,authors,publishedDate,categories,imageLinks/thumbnail))';

/** Google Books categories → Read tags; `Science` must not match "Science Fiction". */
const TAG_RULES: Array<[RegExp, string]> = [
  [/science fiction/i, 'Sci-Fi'],
  [/fantasy/i, 'Fantasy'],
  [/mystery|detective/i, 'Mystery'],
  [/thriller|suspense/i, 'Thriller'],
  [/romance/i, 'Romance'],
  [/horror/i, 'Horror'],
  [/historical/i, 'Historical'],
  [/literary/i, 'Literary'],
  [/classic/i, 'Classics'],
  [/young adult/i, 'Young Adult'],
  [/juvenile/i, 'Kids'],
  [/comics|graphic novel/i, 'Graphic Novel'],
  [/poetry/i, 'Poetry'],
  [/biography|autobiography|memoir/i, 'Biography'],
  [/^history/i, 'History'],
  [/^(?!.*fiction).*science/i, 'Science'],
  [/business|economics/i, 'Business'],
  [/self-help/i, 'Self-Help'],
  [/psychology/i, 'Psychology'],
  [/philosophy/i, 'Philosophy'],
  [/political/i, 'Politics'],
  [/religion/i, 'Religion'],
  [/true crime/i, 'True Crime'],
  [/^travel/i, 'Travel'],
  [/cooking/i, 'Food'],
];

export function bookTags(categories: string[]): string[] {
  return [...new Set(categories.flatMap((c) => TAG_RULES.filter(([re]) => re.test(c)).map(([, tag]) => tag)))];
}

/** Which Read list the categories point to, or undefined when Google gives none. */
export function bookList(categories: string[]): BookResult['list'] {
  if (categories.length === 0) return undefined;
  if (categories.some((c) => /nonfiction/i.test(c))) return 'nonfiction';
  return categories.some((c) => /fiction|comics|graphic novel|poetry|drama/i.test(c)) ? 'fiction' : 'nonfiction';
}

/** Lowercase, accent-free words joined by "-" (letters of any script kept); never contains ":". */
export function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** "The Hobbit (Deluxe Edition)" → "The Hobbit" */
export function cleanTitle(title: string): string {
  return title.replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "Weir, Andy" → "Andy Weir" */
function cleanAuthor(author: string): string {
  const [last, first, ...rest] = author.split(',').map((s) => s.trim());
  return first && rest.length === 0 ? `${first} ${last}` : author.trim();
}

function surname(author: string): string {
  const words = cleanAuthor(author).replace(/,?\s+(jr|sr|ii|iii|iv)\.?$/i, '').split(/\s+/);
  return words[words.length - 1] || author;
}

export function bookPlaceId(title: string, author: string): string {
  return `book:${slug(surname(author))}:${slug(cleanTitle(title))}`;
}

/** Summaries, workbooks and the like, which crowd out the real book in search results */
const COMPANION = /\b(summary|summaries|summari[sz]ed|workbook|study guide|sparknotes|cliffsnotes|analysis of|review|in 30 minutes|ringkasan)\b/i;

function joinNames(names: string[]): string | undefined {
  const list = [...new Set(names)].slice(0, 3);
  if (list.length <= 1) return list[0];
  return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`;
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** One volume as a book, or null without a title or author. */
export function toBook(raw: Record<string, any>): BookResult | null {
  const info = raw?.volumeInfo ?? {};
  const title = text(info.title);
  const authors: string[] = Array.isArray(info.authors) ? info.authors.map(text).filter(Boolean).map(cleanAuthor) : [];
  if (!title || authors.length === 0 || COMPANION.test(title) || authors.some((a) => COMPANION.test(a))) return null;
  const categories: string[] = Array.isArray(info.categories) ? info.categories.filter((c: unknown) => typeof c === 'string') : [];
  const thumb = text(info.imageLinks?.thumbnail);
  // Bare catalog stubs (no cover, no category) are almost never the book being looked for
  if (!thumb && categories.length === 0) return null;
  const year = Number(text(info.publishedDate)?.slice(0, 4));
  return {
    placeId: bookPlaceId(title, authors[0]),
    title: cleanTitle(title) || title,
    year: Number.isInteger(year) && year > 0 ? year : undefined,
    cover: thumb?.replace(/^http:/, 'https:').replace(/&edge=curl/, ''),
    creator: joinNames(authors),
    list: bookList(categories),
    tags: bookTags(categories),
  };
}

/** Editions of one book merged: first-found title, earliest year, any cover, every tag. */
export function mergeEditions(books: BookResult[]): BookResult[] {
  const byId = new Map<string, BookResult>();
  for (const book of books) {
    const seen = byId.get(book.placeId);
    if (!seen) {
      byId.set(book.placeId, { ...book, tags: [...book.tags] });
      continue;
    }
    if (book.year && (!seen.year || book.year < seen.year)) seen.year = book.year;
    seen.cover ??= book.cover;
    seen.list ??= book.list;
    seen.tags = [...new Set([...seen.tags, ...book.tags])];
  }
  return [...byId.values()];
}

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/** Books matching `query`, most relevant first, editions merged. */
export async function searchBooks(query: string, key: string, fetchFn: Fetch = fetch): Promise<BookResult[]> {
  const params = new URLSearchParams({ q: query, printType: 'books', maxResults: '30', fields: FIELDS, key });
  const res = await fetchFn(`${API}?${params}`);
  if (!res.ok) throw new Error(`Google Books ${res.status}`);
  const data = await res.json();
  const books = (Array.isArray(data?.items) ? data.items : []).map(toBook).filter((b: BookResult | null): b is BookResult => b !== null);
  return mergeEditions(books).slice(0, MAX_RESULTS);
}

/** "Andy Weir, Someone Else & Third" → "Andy Weir" */
export function firstAuthor(creator: string): string {
  return creator.split(/,|&|\band\b/)[0].trim();
}

/**
 * The cheapest ebook edition's price (Google Play Books, in dollars) of the book `placeId` names,
 * or null when no edition is for sale or free. Google Books has no print prices.
 */
export async function bookPrice(
  placeId: string,
  title: string,
  creator: string,
  key: string,
  fetchFn: Fetch = fetch
): Promise<ItemPrice | null> {
  const author = firstAuthor(creator);
  const params = new URLSearchParams({
    // Plain words: quoted `intitle:"…"` phrases come back empty for most books
    q: `${cleanTitle(title)} ${author}`,
    printType: 'books',
    country: 'US',
    maxResults: '30',
    fields: 'items(volumeInfo(title,authors),saleInfo(saleability,isEbook,listPrice,retailPrice))',
    key,
  });
  const res = await fetchFn(`${API}?${params}`);
  if (!res.ok) throw new Error(`Google Books ${res.status}`);
  const items: any[] = (await res.json())?.items ?? [];
  let best: { amount: number; was?: number } | undefined;
  for (const item of items) {
    const sale = item?.saleInfo;
    const authors: string[] = item?.volumeInfo?.authors ?? [];
    if (!sale?.isEbook || !item?.volumeInfo?.title || authors.length === 0) continue;
    // Other editions and companions of the search are a different book
    if (bookPlaceId(item.volumeInfo.title, cleanAuthor(authors[0])) !== placeId) continue;
    const amount = sale.saleability === 'FREE' ? 0 : sale.saleability === 'FOR_SALE' ? Number(sale.retailPrice?.amount) : NaN;
    if (!Number.isFinite(amount) || amount < 0 || (amount > 0 && sale.retailPrice?.currencyCode !== 'USD')) continue;
    if (best && best.amount <= amount) continue;
    const list = Number(sale.listPrice?.amount);
    best = { amount, ...(list > amount && sale.listPrice?.currencyCode === 'USD' ? { was: list } : {}) };
  }
  return best ? { source: 'google_books', new: { currency: 'USD', ...best } } : null;
}

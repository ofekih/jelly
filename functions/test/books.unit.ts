import { describe, expect, it } from 'vitest';
import { bookList, bookPlaceId, bookTags, cleanTitle, mergeEditions, searchBooks, slug, toBook } from '../src/books';

describe('book identity', () => {
  it('is the same for every edition of a book', () => {
    const id = bookPlaceId('Project Hail Mary', 'Andy Weir');
    expect(id).toBe('book:weir:project-hail-mary');
    expect(bookPlaceId('Project Hail Mary (Deluxe Edition)', 'Weir, Andy')).toBe(id);
    expect(bookPlaceId('PROJECT HAIL MARY', 'Andy Weir ')).toBe(id);
    const hobbit = bookPlaceId('The Hobbit', 'J.R.R. Tolkien');
    expect(bookPlaceId('The Hobbit', 'John Ronald Reuel Tolkien')).toBe(hobbit);
    expect(bookPlaceId('The Hobbit', 'J. R. R. Tolkien')).toBe(hobbit);
    expect(bookPlaceId('Book', 'Martin Luther King Jr.')).toBe('book:king:book');
  });

  it('keeps accents out, other scripts in, and never contains a ":" or "/"', () => {
    expect(slug('Cien años de soledad')).toBe('cien-anos-de-soledad');
    expect(slug('הנסיך הקטן')).toBe('הנסיך-הקטן');
    expect(slug('Harry Potter & the Philosopher’s Stone')).toBe('harry-potter-and-the-philosophers-stone');
    expect(bookPlaceId('A: B / C', 'X Y')).toBe('book:y:a-b-c');
    expect(cleanTitle('The Hobbit [Illustrated] (50th Anniversary)')).toBe('The Hobbit');
  });
});

describe('lists and tags', () => {
  it('sorts books into Fiction or Nonfiction, or neither without categories', () => {
    expect(bookList(['Fiction'])).toBe('fiction');
    expect(bookList(['Juvenile Fiction'])).toBe('fiction');
    expect(bookList(['Comics & Graphic Novels'])).toBe('fiction');
    expect(bookList(['Juvenile Nonfiction'])).toBe('nonfiction');
    expect(bookList(['Biography & Autobiography'])).toBe('nonfiction');
    expect(bookList([])).toBeUndefined();
  });

  it('maps categories to tags without mistaking science fiction for science', () => {
    expect(bookTags(['Fiction / Science Fiction / General'])).toEqual(['Sci-Fi']);
    expect(bookTags(['Science'])).toEqual(['Science']);
    expect(bookTags(['Biography & Autobiography', 'History'])).toEqual(['Biography', 'History']);
    expect(bookTags(['Young Adult Fiction'])).toEqual(['Young Adult']);
  });
});

describe('toBook and mergeEditions', () => {
  const v = (title: string, authors: string[] | undefined, publishedDate?: string, categories?: string[], thumbnail?: string) => ({
    volumeInfo: { title, authors, publishedDate, categories, imageLinks: thumbnail ? { thumbnail } : undefined },
  });

  it('maps a volume, upgrading the cover to https without the page curl', () => {
    expect(
      toBook(v('Project Hail Mary', ['Andy Weir'], '2021-05-04', ['Fiction'], 'http://books.google.com/books/content?id=x&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api'))
    ).toEqual({
      placeId: 'book:weir:project-hail-mary',
      title: 'Project Hail Mary',
      year: 2021,
      cover: 'https://books.google.com/books/content?id=x&printsec=frontcover&img=1&zoom=1&source=gbs_api',
      creator: 'Andy Weir',
      list: 'fiction',
      tags: [],
    });
    expect(toBook(v('Anonymous', undefined, '2000', ['Fiction']))).toBeNull();
    expect(toBook(v('Good Omens', ['Terry Pratchett', 'Neil Gaiman'], '1990', ['Fiction']))!.creator).toBe('Terry Pratchett & Neil Gaiman');
  });

  it('skips summaries, workbooks and bare catalog stubs', () => {
    expect(toBook(v('Summary of Sapiens', ['Someone'], '2019', ['History']))).toBeNull();
    expect(toBook(v('WORKBOOK for Thinking, Fast and Slow', ['Someone'], '2021', ['Psychology']))).toBeNull();
    expect(toBook(v('Project Hail Mary', ['Mgm'], '2026'))).toBeNull();
    expect(toBook(v('Thinking, Fast and Slow - Summarized for Busy People', ['X'], '2018', ['Psychology']))).toBeNull();
    expect(toBook(v('Thinking, Fast and Slow', ['Save Time Summaries Staff'], '2014', ['Psychology']))).toBeNull();
    expect(toBook(v('Project Hail Mary', ['Andy Weir'], '2021', undefined, 'https://c'))).not.toBeNull();
  });

  it('merges editions: first title, earliest year, any cover, every tag', () => {
    const books = [
      toBook(v('Dune', ['Frank Herbert'], '2019', ['Fiction'])),
      toBook(v('Dune (Deluxe Edition)', ['Frank Herbert'], '1965', undefined, 'https://c')),
      toBook(v('Dune Messiah', ['Frank Herbert'], '1969', undefined, 'https://m')),
    ].filter((b) => b !== null);
    const merged = mergeEditions(books);
    expect(merged.map((b) => [b.title, b.year, b.cover, b.list])).toEqual([
      ['Dune', 1965, 'https://c', 'fiction'],
      ['Dune Messiah', 1969, 'https://m', undefined],
    ]);
  });
});

describe('searchBooks', () => {
  it('asks for books only, with the key, and merges editions', async () => {
    let url = '';
    const fetchFn = async (u: string) => {
      url = u;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            { volumeInfo: { title: 'Project Hail Mary', authors: ['Andy Weir'], publishedDate: '2021', categories: ['Fiction'] } },
            { volumeInfo: { title: 'Project Hail Mary', authors: ['Andy Weir'], publishedDate: '2022', categories: ['Fiction'] } },
          ],
        }),
      };
    };
    const books = await searchBooks('project hail mary', 'k', fetchFn);
    expect(books).toHaveLength(1);
    expect(url).toContain('printType=books');
    expect(url).toContain('key=k');
    await expect(searchBooks('x', 'k', async () => ({ ok: false, status: 429, json: async () => ({}) }))).rejects.toThrow('Google Books 429');
  });
});

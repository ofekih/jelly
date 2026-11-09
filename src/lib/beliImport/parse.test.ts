import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { syntheticBeliTexts, syntheticBeliZip } from './fixtures';
import {
  beliPlaceKey,
  BeliImportError,
  parseBeliDate,
  parseBeliExport,
  parseVisitDates,
  readBeliFiles,
  unzipBeliExport,
} from './parse';

const fileOf = (name: string, data: string | Uint8Array) => ({
  name,
  text: async () => (typeof data === 'string' ? data : new TextDecoder().decode(data)),
  arrayBuffer: async () => {
    const bytes = typeof data === 'string' ? strToU8(data) : data;
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  },
});

describe('parseCsv', () => {
  it('handles quotes, commas, doubled quotes and line breaks inside fields', () => {
    const rows = parseCsv('a,b,c\n"x, y","say ""hi""","line1\nline2"\nlast,,\n');
    expect(rows.map((r) => r.fields)).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line1\nline2'],
      ['last', '', ''],
    ]);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4]);
  });

  it('handles CRLF, a BOM, blank lines and no trailing newline', () => {
    const rows = parseCsv('﻿a,b\r\n\r\n1,"2\r\n3"\r\n4,5');
    expect(rows.map((r) => r.fields)).toEqual([['a', 'b'], ['1', '2\r\n3'], ['4', '5']]);
  });

  it('keeps a quoted empty field and a lone quote mid-field', () => {
    expect(parseCsv('"",a"b\n').map((r) => r.fields)).toEqual([['', 'a"b']]);
  });
});

describe('dates', () => {
  it('reads Beli timestamps with and without microseconds', () => {
    expect(parseBeliDate('2025-06-01 18:30:00.123456+00:00')).toBe(Date.parse('2025-06-01T18:30:00.123Z'));
    expect(parseBeliDate('2025-06-01 18:30:00+02:00')).toBe(Date.parse('2025-06-01T16:30:00Z'));
    expect(parseBeliDate('')).toBeUndefined();
    expect(parseBeliDate('yesterday')).toBeUndefined();
  });

  it('reads the Python visit-date repr', () => {
    expect(parseVisitDates('[datetime.date(2026, 10, 3), datetime.date(2025, 1, 12)]')).toEqual(['2026-10-03', '2025-01-12']);
    expect(parseVisitDates('[]')).toEqual([]);
  });
});

describe('beliPlaceKey', () => {
  it('folds case, accents, curly quotes and spaces', () => {
    expect(beliPlaceKey('Café  Lumière', 'Tel Aviv-Yafo')).toBe(beliPlaceKey('cafe lumiere', 'tel aviv-yafo'));
    expect(beliPlaceKey('Nonna’s', 'NY')).toBe(beliPlaceKey("Nonna's", 'ny'));
  });
});

describe('parseBeliExport', () => {
  const parsed = parseBeliExport(syntheticBeliTexts({ restaurants: 30 }) as any, Object.keys(syntheticBeliTexts()));

  it('maps list codes onto jelly lists in rank order and reports unknown codes', () => {
    expect(Object.keys(parsed.lists).sort()).toEqual(['bakeries', 'coffee_tea', 'dessert', 'restaurants']);
    expect(parsed.lists.restaurants).toHaveLength(30);
    expect(parsed.lists.restaurants!.map((r) => r.rank)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(parsed.report.unknownCategories).toEqual({ XYZ: 1 });
    expect(parsed.report.rankIssues).toEqual([]);
  });

  it('keeps names with commas and quotes, and bare cities', () => {
    const names = parsed.lists.restaurants!.map((r) => r.name);
    expect(names).toContain('Nonna’s Kitchen, Pasta & Wine');
    expect(names).toContain('The "Best" Tacos');
    expect(parsed.lists.restaurants![0].city).toBe('Tel Aviv-Yafo');
  });

  it('joins notes, dishes and private notes by (name, city), several of a kind with a blank line', () => {
    const cafe = parsed.lists.restaurants![0];
    expect(cafe.notes).toBe('Great shakshuka, slow service.\nWould go back, "for sure".\n\nSecond visit: even better.');
    expect(cafe.favoriteDishes).toBe('Shakshuka, labneh');
    expect(cafe.privateNotes).toBeUndefined();
    const nonna = parsed.lists.restaurants![1];
    expect(nonna.privateNotes).toBe('Ask for the back table');
    expect(nonna.notes).toBeUndefined();
    expect(parsed.bookmarks.find((b) => b.name === 'Saffron Road')!.notes).toBe('Friend says the biryani is the move');
    expect(parsed.report.unmatchedNotes).toBe(1);
  });

  it('dedupes bookmarks, counts labels, parses follows and dates', () => {
    expect(parsed.bookmarks.map((b) => b.name)).toEqual(['Saffron Road', 'Crust Club', 'Matcha Lab']);
    expect(parsed.report.duplicateRows).toBe(1);
    expect(parsed.report.labelsDropped).toBe(3);
    expect(parsed.lists.restaurants![0].labelCount).toBe(2);
    expect(parsed.follows.map((f) => f.username)).toEqual(['foodfriend_1', 'pending_pal']);
    expect(parsed.follows[1].acceptedAt).toBeUndefined();
    expect(parsed.lists.restaurants![0].visitDates).toEqual(['2026-10-03', '2025-01-12']);
    expect(parsed.lists.restaurants![0].createdAt).toBe(Date.parse('2025-06-01T18:30:00.123Z'));
  });

  it('reports ignored files and a stable fingerprint', () => {
    expect(parsed.report.ignoredFiles.sort()).toEqual(['photos.csv', 'user_profile.csv']);
    expect(parsed.report.missingFiles).toEqual([]);
    expect(parseBeliExport(syntheticBeliTexts() as any).fingerprint).toBe(parsed.fingerprint);
    expect(parseBeliExport(syntheticBeliTexts({ restaurants: 31 }) as any).fingerprint).not.toBe(parsed.fingerprint);
  });

  it('sorts by rank when the file is out of order and flags rank problems', () => {
    const texts = {
      'rankings.csv':
        'Rank,Restaurant Name,City,Category,Created Date,Visit Dates\n3,C,X,RES,,[]\n1,A,X,RES,,[]\n2,B,X,RES,,[]\n5,E,X,BAR,,[]\nx,Bad,X,RES,,[]\n',
    };
    const out = parseBeliExport(texts);
    expect(out.lists.restaurants!.map((r) => r.name)).toEqual(['A', 'B', 'C']);
    expect(out.report.rankIssues).toEqual([{ category: 'bars', reason: 'gaps in ranks' }]);
    expect(out.report.badRows).toEqual([{ file: 'rankings.csv', line: 6, reason: 'bad rank' }]);
    expect(out.report.missingFiles).toContain('bookmarks.csv');
  });

  it('cuts text longer than jelly allows', () => {
    const long = 'x'.repeat(6000);
    const out = parseBeliExport({
      'rankings.csv': 'Rank,Restaurant Name,City,Category\n1,A,X,RES\n',
      'notes_dishes.csv': `Field Type,Business Name,City,Note Text,Created Date\nNotes,A,X,${long},\n`,
    });
    expect(out.lists.restaurants![0].notes!.length).toBe(5000);
    expect(out.report.truncatedTexts).toBe(1);
  });

  it('rejects exports without rankings.csv or with other columns', () => {
    expect(() => parseBeliExport({ 'bookmarks.csv': 'a\n' })).toThrow(BeliImportError);
    expect(() => parseBeliExport({ 'rankings.csv': 'Name,Score\nA,9\n' })).toThrow(/columns/);
  });
});

describe('zip and loose files', () => {
  it('reads only the five CSVs out of a zip (inside a folder), listing the rest by name', () => {
    const { texts, files } = unzipBeliExport(syntheticBeliZip());
    expect(Object.keys(texts).sort()).toEqual(['bookmarks.csv', 'follows.csv', 'labels.csv', 'notes_dishes.csv', 'rankings.csv']);
    expect(files).toContain('photos.csv');
    expect(files).toContain('user_profile.csv');
  });

  it('skips macOS resource forks', () => {
    const zip = zipSync({
      'rankings.csv': strToU8('Rank,Restaurant Name,City,Category\n1,A,X,RES\n'),
      '__MACOSX/._rankings.csv': strToU8('junk'),
    });
    expect(unzipBeliExport(zip).files).toEqual(['rankings.csv']);
  });

  it('reads a picked zip or loose CSVs the same way', async () => {
    const fromZip = await readBeliFiles([fileOf('nisha_data_export.zip', syntheticBeliZip())]);
    const texts = syntheticBeliTexts();
    const fromCsvs = await readBeliFiles(Object.entries(texts).map(([n, t]) => fileOf(n, t)));
    expect(fromCsvs.fingerprint).toBe(fromZip.fingerprint);
    expect(fromCsvs.lists).toEqual(fromZip.lists);
  });

  it('rejects a .zip that is not a zip', async () => {
    await expect(readBeliFiles([fileOf('x.zip', 'hello')])).rejects.toThrow(/not a zip/);
  });
});

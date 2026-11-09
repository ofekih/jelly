import { unzipSync } from 'fflate';
import type { SpotCategory } from '../../types';
import { parseCsvRecords } from './csv';
import {
  BELI_CATEGORY_MAP,
  BELI_FILES,
  type BeliBookmarkRow,
  type BeliExport,
  type BeliFileName,
  type BeliFollow,
  type BeliParseReport,
  type BeliRankedRow,
  type BeliSpotText,
} from './types';

/** jelly's limits (firestore.rules): longer text is cut and counted in the report */
const MAX_NAME = 200;
const MAX_CITY = 200;
const MAX_NOTES = 5000;
const MAX_DISHES = 2000;

/** Lowercase, accents and curly quotes folded, spaces collapsed: for comparing names and cities. */
export function foldText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** How a Beli place is recognised: by (name, city), the only identity the export has. */
export function beliPlaceKey(name: string, city: string): string {
  return `${foldText(name)}|${foldText(city)}`;
}

/** Beli timestamps: "2026-10-03 18:22:11.123456+00:00" (microseconds optional) → ms, or undefined. */
export function parseBeliDate(raw: string): number | undefined {
  const m = raw
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) {
    const dateOnly = raw.trim().match(/^\d{4}-\d{2}-\d{2}$/);
    return dateOnly ? Date.parse(`${dateOnly[0]}T00:00:00Z`) : undefined;
  }
  const ms = (m[3] || '').padEnd(3, '0').slice(0, 3);
  const zone = m[4] ? (m[4] === 'Z' ? 'Z' : m[4].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')) : 'Z';
  const t = Date.parse(`${m[1]}T${m[2]}.${ms}${zone}`);
  return Number.isFinite(t) ? t : undefined;
}

/** Visit Dates is a Python repr: "[datetime.date(2026, 10, 3), …]" or "[]" → ["2026-10-03", …]. */
export function parseVisitDates(raw: string): string[] {
  const out: string[] = [];
  for (const m of raw.matchAll(/date\(\s*(\d{4})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\)/g)) {
    out.push(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
  }
  return out;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** macOS resource forks and folders in a re-zipped export */
function isJunkEntry(path: string): boolean {
  return path.endsWith('/') || path.startsWith('__MACOSX/') || baseName(path).startsWith('._');
}

function isWantedFile(name: string): name is BeliFileName {
  return (BELI_FILES as readonly string[]).includes(name.toLowerCase());
}

/**
 * The CSVs the engine reads out of an export zip. Other entries (photos, devices, profile, …) are
 * listed by name only: the filter runs before decompression, so their contents are never inflated.
 */
export function unzipBeliExport(zip: Uint8Array): { texts: Partial<Record<BeliFileName, string>>; files: string[] } {
  const files: string[] = [];
  const unzipped = unzipSync(zip, {
    filter: (file) => {
      if (isJunkEntry(file.name)) return false;
      files.push(baseName(file.name));
      return isWantedFile(baseName(file.name));
    },
  });
  const decoder = new TextDecoder('utf-8');
  const texts: Partial<Record<BeliFileName, string>> = {};
  for (const [path, bytes] of Object.entries(unzipped)) {
    const name = baseName(path).toLowerCase() as BeliFileName;
    if (!(name in texts)) texts[name] = decoder.decode(bytes);
  }
  return { texts, files };
}

/** The first bytes of a zip ("PK\x03\x04", or an empty archive's "PK\x05\x06") */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5);
}

/**
 * Reads what the user picked: one export .zip, or loose CSVs (any of the five, by file name).
 * Unwanted loose files are listed but not read.
 */
export async function readBeliFiles(files: Array<Pick<File, 'name' | 'arrayBuffer' | 'text'>>): Promise<BeliExport> {
  const texts: Partial<Record<BeliFileName, string>> = {};
  const names: string[] = [];
  for (const file of files) {
    const name = baseName(file.name);
    if (/\.zip$/i.test(name)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!looksLikeZip(bytes)) throw new BeliImportError('not_zip', `${name} is not a zip file`);
      const unzipped = unzipBeliExport(bytes);
      names.push(...unzipped.files);
      for (const [k, v] of Object.entries(unzipped.texts)) texts[k as BeliFileName] ??= v;
    } else {
      names.push(name);
      if (isWantedFile(name)) texts[name.toLowerCase() as BeliFileName] ??= await file.text();
    }
  }
  return parseBeliExport(texts, names);
}

export class BeliImportError extends Error {
  constructor(
    readonly code: 'not_zip' | 'no_rankings' | 'not_beli',
    message: string
  ) {
    super(message);
    this.name = 'BeliImportError';
  }
}

function clip(text: string, max: number, onClip: () => void): string {
  if (text.length <= max) return text;
  onClip();
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** cyrb53: a fast, stable 53-bit string hash (not cryptographic) */
function hash53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function categoryFor(code: string): SpotCategory | undefined {
  return (BELI_CATEGORY_MAP as Record<string, SpotCategory>)[code.trim().toUpperCase()];
}

const RANKINGS_COLUMNS = ['Rank', 'Restaurant Name', 'City', 'Category'];

/**
 * Parses the export's CSV texts (by file name) into lists, bookmarks and follows, with notes and
 * dishes joined to spots by (name, city). `files` lists every file name in the export, for the report.
 * Throws `BeliImportError('no_rankings')` without rankings.csv, `('not_beli')` if its columns are wrong.
 */
export function parseBeliExport(texts: Partial<Record<BeliFileName, string>>, files: string[] = Object.keys(texts)): BeliExport {
  const report: BeliParseReport = {
    files: [...files],
    ignoredFiles: files.filter((f) => !isWantedFile(f)),
    missingFiles: BELI_FILES.filter((f) => texts[f] === undefined),
    unknownCategories: {},
    badRows: [],
    rankIssues: [],
    duplicateRows: 0,
    unmatchedNotes: 0,
    truncatedTexts: 0,
    labelsDropped: 0,
  };
  if (texts['rankings.csv'] === undefined) throw new BeliImportError('no_rankings', 'The export has no rankings.csv');
  const truncated = () => report.truncatedTexts++;
  const unknown = (code: string) => {
    const c = code.trim() || '(blank)';
    report.unknownCategories[c] = (report.unknownCategories[c] || 0) + 1;
  };

  // rankings.csv
  const rankings = parseCsvRecords(texts['rankings.csv']);
  const header = rankings.header.map((h) => h.toLowerCase());
  if (!RANKINGS_COLUMNS.every((c) => header.includes(c.toLowerCase()))) {
    throw new BeliImportError('not_beli', 'rankings.csv does not have Beli’s columns');
  }
  const byList = new Map<SpotCategory, Array<BeliRankedRow & { order: number }>>();
  const seen = new Set<string>();
  rankings.records.forEach((rec, order) => {
    const name = rec.get('Restaurant Name').trim();
    const city = rec.get('City').trim();
    const code = rec.get('Category');
    const rank = Number(rec.get('Rank').trim());
    if (!name) return report.badRows.push({ file: 'rankings.csv', line: rec.line, reason: 'no name' });
    if (!Number.isInteger(rank) || rank < 1) {
      return report.badRows.push({ file: 'rankings.csv', line: rec.line, reason: 'bad rank' });
    }
    const category = categoryFor(code);
    if (!category) return unknown(code);
    const key = beliPlaceKey(name, city);
    if (seen.has(`${category}|${key}`)) return report.duplicateRows++;
    seen.add(`${category}|${key}`);
    const list = byList.get(category) ?? [];
    list.push({
      key,
      name: clip(name, MAX_NAME, truncated),
      city: clip(city, MAX_CITY, truncated),
      category,
      rank,
      createdAt: parseBeliDate(rec.get('Created Date')),
      visitDates: parseVisitDates(rec.get('Visit Dates')),
      labelCount: 0,
      order,
    });
    byList.set(category, list);
  });
  const lists: Partial<Record<SpotCategory, BeliRankedRow[]>> = {};
  for (const [category, rows] of byList) {
    rows.sort((a, b) => a.rank - b.rank || a.order - b.order);
    const ranks = rows.map((r) => r.rank);
    if (new Set(ranks).size !== ranks.length) report.rankIssues.push({ category, reason: 'repeated ranks' });
    else if (ranks[ranks.length - 1] !== ranks.length) report.rankIssues.push({ category, reason: 'gaps in ranks' });
    lists[category] = rows.map(({ order: _order, ...row }) => row);
  }

  // bookmarks.csv
  const bookmarks: BeliBookmarkRow[] = [];
  const seenBookmarks = new Set<string>();
  if (texts['bookmarks.csv'] !== undefined) {
    for (const rec of parseCsvRecords(texts['bookmarks.csv']).records) {
      const name = rec.get('Business Name').trim();
      const city = rec.get('City').trim();
      if (!name) {
        report.badRows.push({ file: 'bookmarks.csv', line: rec.line, reason: 'no name' });
        continue;
      }
      const category = categoryFor(rec.get('Category'));
      if (!category) {
        unknown(rec.get('Category'));
        continue;
      }
      const key = beliPlaceKey(name, city);
      if (seenBookmarks.has(key)) {
        report.duplicateRows++;
        continue;
      }
      seenBookmarks.add(key);
      bookmarks.push({
        key,
        name: clip(name, MAX_NAME, truncated),
        city: clip(city, MAX_CITY, truncated),
        category,
        createdAt: parseBeliDate(rec.get('Bookmarked Date')),
      });
    }
  }

  // notes_dishes.csv: joined to every ranked row and bookmark with the same (name, city)
  const targets = new Map<string, BeliSpotText[]>();
  for (const row of [...Object.values(lists).flat(), ...bookmarks]) {
    if (!row) continue;
    targets.set(row.key, [...(targets.get(row.key) ?? []), row]);
  }
  if (texts['notes_dishes.csv'] !== undefined) {
    const collected = new Map<string, { notes: string[]; favoriteDishes: string[]; privateNotes: string[] }>();
    for (const rec of parseCsvRecords(texts['notes_dishes.csv']).records) {
      const text = rec.get('Note Text').trim();
      if (!text) continue;
      const kind = foldText(rec.get('Field Type'));
      const field =
        kind === 'notes' ? 'notes' : kind === 'favorite dishes' ? 'favoriteDishes' : kind === 'private notes' ? 'privateNotes' : null;
      if (!field) {
        report.badRows.push({ file: 'notes_dishes.csv', line: rec.line, reason: 'unknown field type' });
        continue;
      }
      const key = beliPlaceKey(rec.get('Business Name'), rec.get('City'));
      if (!targets.has(key)) {
        report.unmatchedNotes++;
        continue;
      }
      const entry = collected.get(key) ?? { notes: [], favoriteDishes: [], privateNotes: [] };
      entry[field].push(text);
      collected.set(key, entry);
    }
    for (const [key, entry] of collected) {
      for (const target of targets.get(key) ?? []) {
        if (entry.notes.length) target.notes = clip(entry.notes.join('\n\n'), MAX_NOTES, truncated);
        if (entry.favoriteDishes.length) target.favoriteDishes = clip(entry.favoriteDishes.join('\n\n'), MAX_DISHES, truncated);
        if (entry.privateNotes.length) target.privateNotes = clip(entry.privateNotes.join('\n\n'), MAX_NOTES, truncated);
      }
    }
  }

  // labels.csv: dropped (decided with the user), only counted
  if (texts['labels.csv'] !== undefined) {
    const ranked = new Map(Object.values(lists).flat().map((r) => [r!.key, r!]));
    for (const rec of parseCsvRecords(texts['labels.csv']).records) {
      if (!rec.get('Label Name').trim()) continue;
      report.labelsDropped++;
      const row = ranked.get(beliPlaceKey(rec.get('Business Name'), rec.get('City')));
      if (row) row.labelCount++;
    }
  }

  // follows.csv
  const follows: BeliFollow[] = [];
  if (texts['follows.csv'] !== undefined) {
    for (const rec of parseCsvRecords(texts['follows.csv']).records) {
      const username = rec.get('Username').trim();
      if (!username) continue;
      follows.push({
        username,
        requestedAt: parseBeliDate(rec.get('Request Date')),
        acceptedAt: parseBeliDate(rec.get('Accept Date')),
      });
    }
  }

  const fingerprint = hash53(
    JSON.stringify([
      Object.entries(lists).map(([c, rows]) => [c, rows!.map((r) => r.key)]),
      bookmarks.map((b) => [b.category, b.key]),
    ])
  );
  return { lists, bookmarks, follows, report, fingerprint };
}

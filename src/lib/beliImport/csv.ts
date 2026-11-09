/**
 * RFC 4180 CSV: quoted fields may hold commas, doubled quotes ("") and line breaks; CRLF, LF or
 * CR line ends; a leading BOM is dropped. Returns rows of raw strings plus each row's 1-based
 * starting line (for error reports). Blank lines are skipped.
 */
export function parseCsv(text: string): Array<{ line: number; fields: string[] }> {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: Array<{ line: number; fields: string[] }> = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let rowHasContent = false;

  const endField = () => {
    fields.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (rowHasContent || fields.length > 1 || fields[0] !== '') rows.push({ line: rowLine, fields });
    fields = [];
    rowHasContent = false;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n' || (ch === '\r' && src[i + 1] !== '\n')) line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      rowHasContent = true;
    } else if (ch === ',') {
      endField();
      rowHasContent = true;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      field += ch;
    }
  }
  if (field !== '' || fields.length > 0 || rowHasContent) endRow();
  return rows;
}

/**
 * CSV rows as objects keyed by the header row (trimmed). Missing trailing fields read as ''.
 * `line` is where the row starts in the file.
 */
export function parseCsvRecords(text: string): { header: string[]; records: Array<{ line: number; get: (column: string) => string }> } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { header: [], records: [] };
  const header = rows[0].fields.map((h) => h.trim());
  const index = new Map(header.map((h, i) => [h.toLowerCase(), i]));
  return {
    header,
    records: rows.slice(1).map(({ line, fields }) => ({
      line,
      get: (column: string) => {
        const i = index.get(column.toLowerCase());
        return i === undefined ? '' : fields[i] ?? '';
      },
    })),
  };
}

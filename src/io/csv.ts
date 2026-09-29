/**
 * CSV writer and reader (RFC 4180): the time traces of a run, one row per history frame.
 *
 * Layout: a header row of keys (`t`, then the diagnostics), one row per frame, numbers in the shortest form
 * that reads back as the same double. An empty field is NaN (a diagnostic the frame does not have); the
 * infinities are written `Infinity` and `-Infinity`. Optional `# ` comment lines before the header carry
 * provenance; readers such as pandas need `comment='#'` to skip them, so they are off by default.
 * Fields are quoted when they contain the delimiter, a quote, a line break or edge spaces.
 *
 * Pure TypeScript, browser-safe.
 */
import { type RunSource, formatNumber, tableFromSource } from './table';

export interface CsvOptions {
  /** the diagnostics to write, in order (default: all of them) */
  keys?: readonly string[];
  /** the name of the time column (default 't') */
  timeKey?: string;
  /** field delimiter, default ',' */
  delimiter?: string;
  /** line terminator, default '\n' (RFC 4180 says CRLF: pass '\r\n') */
  newline?: '\n' | '\r\n';
  /** lines written before the header, each prefixed with '# ' */
  comments?: readonly string[];
  /** write every n-th frame (default 1: all); the first and the last frame are always written (the last carries the end state or the disruption) */
  every?: number;
}

const needsQuote = (s: string, delim: string): boolean =>
  s.includes(delim) || s.includes('"') || s.includes('\n') || s.includes('\r') || s.startsWith(' ') || s.endsWith(' ');

/** One field: numbers as text (NaN empty), strings quoted where needed. */
export function csvField(v: number | string, delimiter = ','): string {
  if (typeof v === 'number') return Number.isNaN(v) ? '' : formatNumber(v);
  return needsQuote(v, delimiter) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Rows of fields as CSV text; the last row is terminated too. */
export function csvFromRows(rows: readonly (readonly (number | string)[])[], opts: { delimiter?: string; newline?: '\n' | '\r\n' } = {}): string {
  const d = opts.delimiter ?? ',', nl = opts.newline ?? '\n';
  return rows.map((r) => r.map((v) => csvField(v, d)).join(d) + nl).join('');
}

/** The time traces of a run as CSV. */
export function writeCsv(src: RunSource, opts: CsvOptions = {}): string {
  const tab = tableFromSource(src, opts.keys);
  const every = Math.max(1, Math.floor(opts.every ?? 1));
  const nl = opts.newline ?? '\n';
  const rows: (number | string)[][] = [[opts.timeKey ?? 't', ...tab.columns.map((c) => c.key)]];
  const n = tab.t.length;
  for (let i = 0; i < n; i++) if (i % every === 0 || i === n - 1) rows.push([tab.t[i], ...tab.values.map((col) => col[i])]);
  const head = (opts.comments ?? []).map((c) => `# ${c.replace(/[\r\n]+/g, ' ')}${nl}`).join('');
  return head + csvFromRows(rows, opts);
}

/** Splits CSV text into records of string fields (quotes, doubled quotes and embedded line breaks handled). */
export function parseCsvRows(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', i = 0, quoted = false, started = false;
  const endField = () => { row.push(field); field = ''; started = false; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '' && !started) { quoted = true; started = true; i++; continue; }
    if (ch === delimiter) { endField(); i++; continue; }
    if (ch === '\r' || ch === '\n') {
      endRow();
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch; started = true; i++;
  }
  if (quoted) throw new Error('CSV: unterminated quoted field');
  if (field !== '' || started || row.length) endRow();
  return rows;
}

export interface ParsedCsv {
  header: string[];
  /** every column as numbers (an empty field is NaN); a column with a non-numeric field is kept as strings in `text` */
  columns: Record<string, number[]>;
  text: Record<string, string[]>;
  /** the '# ' comment lines that preceded the header, without the prefix */
  comments: string[];
}

/** Reads numeric CSV (what writeCsv writes, or any CSV with a header row) into columns. */
export function parseCsv(input: string, delimiter = ','): ParsedCsv {
  const comments: string[] = [];
  let text = input;
  for (;;) {
    const m = /^#[ ]?([^\r\n]*)\r?\n/.exec(text);
    if (!m) break;
    comments.push(m[1]);
    text = text.slice(m[0].length);
  }
  const rows = parseCsvRows(text, delimiter);
  if (!rows.length) throw new Error('CSV: no header row');
  const header = rows[0];
  const columns: Record<string, number[]> = {}, strs: Record<string, string[]> = {};
  const ragged = rows.slice(1).findIndex((r) => r.length !== header.length);
  if (ragged >= 0) throw new Error(`CSV: row ${ragged + 2} has ${rows[ragged + 1].length} fields, the header has ${header.length}`);
  header.forEach((name, c) => {
    const raw = rows.slice(1).map((r) => r[c]);
    const nums = raw.map((s) => (s === '' ? NaN : /^(NaN|-?(Infinity|\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?))$/.test(s) ? Number(s) : undefined));
    if (nums.every((v) => v !== undefined)) columns[name] = nums as number[];
    else strs[name] = raw;
  });
  return { header, columns, text: strs, comments };
}

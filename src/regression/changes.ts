/**
 * Text of the golden change log (test/golden/CHANGES.md): the reason given to `npm run golden:update` and the
 * per-case description of what a re-record changed. Pure functions (no file or process access), so that the
 * CLI (src/cli/golden.cli.ts) stays thin and the format is unit-tested.
 */
import { GoldenDiff, SnapshotChange, countBySection } from './golden';

/** How many keys of each kind (moved, added, removed) a log entry lists per case. */
export const LIST_KEYS = 12;

/** A re-recorded case for the log. */
export interface Changed {
  id: string;
  /** undefined if the old file could not be read */
  change?: SnapshotChange;
  /** extra note, e.g. a Node version change or an unreadable old file */
  meta?: string;
}

/** The reason of a re-record: a one-line title and optional further paragraphs. */
export interface Reason {
  title: string;
  body: string[];
}

/**
 * Splits the reason text into paragraphs (separated by blank lines; a line break inside a paragraph is a
 * space). The first paragraph is the title of the log entry, the rest follows it as body text, so a long reason
 * kept in a file (`--reason-file`) can be structured. A one-paragraph text, which is all `--reason` ever took,
 * gives the title alone. Returns undefined for a text without a word.
 */
export function parseReason(text: string): Reason | undefined {
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p !== '');
  if (!paragraphs.length) return undefined;
  return { title: paragraphs[0], body: paragraphs.slice(1) };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** "a, b, c, … (+7 more)": the first `LIST_KEYS` keys of a list. */
function listKeys(diffs: readonly GoldenDiff[]): string {
  const shown = diffs.slice(0, LIST_KEYS).map((d) => d.key).join(', ');
  return diffs.length > LIST_KEYS ? `${shown}, … (+${diffs.length - LIST_KEYS} more)` : shown;
}

/** Moved keys with the largest relative change first (a change of type or of a label counts as the largest), then by key. */
function largestFirst(moved: readonly GoldenDiff[]): GoldenDiff[] {
  return [...moved].sort((a, b) => (b.rel === a.rel ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : b.rel - a.rel));
}

/**
 * The log lines of one changed case. The first line gives the counts: the schema change if any, how many existing
 * keys moved (with the largest relative change), how many keys were added and removed, by section. The keys
 * themselves follow as labelled sub-lists — moved (largest change first), added, removed — each cut at
 * {@link LIST_KEYS}, so that a key that merely moved is never read as one that was added. A format-only re-record
 * therefore reads "schema 1 → 2; 0 keys moved; N keys added (…)" followed by the added keys.
 */
export function describeChange(c: Changed): string[] {
  const parts: string[] = [];
  const lists: string[] = [];
  if (c.change) {
    const { schema, moved, added, removed } = c.change;
    if (schema) parts.push(`schema ${String(schema[0])} → ${String(schema[1])}`);
    const numeric = moved.filter((d) => Number.isFinite(d.rel));
    parts.push(`${plural(moved.length, 'key')} moved` + (numeric.length ? `; max rel. diff ${Math.max(...numeric.map((d) => d.rel)).toExponential(2)}` : ''));
    if (added.length) parts.push(`${plural(added.length, 'key')} added (${countBySection(added)})`);
    if (removed.length) parts.push(`${plural(removed.length, 'key')} removed (${countBySection(removed)})`);
    if (moved.length) lists.push(`    - moved, largest change first: ${listKeys(largestFirst(moved))}`);
    if (added.length) lists.push(`    - added: ${listKeys(added)}`);
    if (removed.length) lists.push(`    - removed: ${listKeys(removed)}`);
  }
  if (c.meta) parts.push(c.meta);
  return [`  - ${c.id}: ${parts.join('; ')}`, ...lists];
}

/** Everything one `golden:update` run adds to the log. */
export interface EntryInput {
  reason: Reason;
  added: readonly string[];
  changed: readonly Changed[];
  unchanged: readonly string[];
  failed: readonly string[];
  /** the --only selection, if any */
  only: readonly string[] | undefined;
}

/** The Markdown entry appended to CHANGES.md (starts with a blank line, ends with a newline). */
export function changesEntry(x: EntryInput, now: Date = new Date(), node: string = process.version): string {
  const iso = now.toISOString();
  const stamp = `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  const L: string[] = ['', `## ${stamp} — ${x.reason.title}`, ''];
  for (const p of x.reason.body) L.push(p, '');
  L.push(`Node ${node} · \`npm run golden:update\` · ${x.only ? `--only ${x.only.join(',')}` : 'all cases'}`, '');
  if (x.added.length) L.push(`- Added (${x.added.length}): ${x.added.join(', ')}`);
  if (x.changed.length) {
    L.push(`- Changed (${x.changed.length}):`);
    for (const c of x.changed) L.push(...describeChange(c));
  }
  if (x.unchanged.length) L.push(`- Unchanged (${x.unchanged.length}): ${x.unchanged.join(', ')}`);
  if (x.failed.length) L.push(`- Failed to run, not written (${x.failed.length}): ${x.failed.join(', ')}`);
  return L.join('\n') + '\n';
}

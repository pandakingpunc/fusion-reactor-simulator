/**
 * Figure registry: figure specifications, id selection and merging of captions.md, so that a
 * partial run (`--only a,b`) replaces the captions of the regenerated figures and keeps the others.
 * Pure (no I/O); the figures CLI (src/cli/figures.cli.ts) drives it.
 */
import type { Figure } from './figure';

/** What a figure spec produces: the figure, its output file stem and caption body (markdown). */
export interface FigureOutput {
  fig: Figure;
  caption: string;
}

/** Canonical inputs of a figure: hashed (SHA-256 of canonical JSON) into the provenance manifest. */
export interface FigureInputs {
  config: unknown;
  /** random seeds of the simulations the figure depends on, by preset id */
  seeds: Record<string, number>;
}

export interface FigureSpec<Ctx, Need extends string = string, Params = unknown> {
  /** id used on the command line (`--only`) */
  id: string;
  title: string;
  /** figure number in the paper (captions are ordered by it) */
  number: number;
  /** output file stem, e.g. "fig01_equilibrium" (→ .svg / .pdf) */
  file: string;
  /** data the figure needs (drives which simulations and pool tasks run) */
  needs: readonly Need[];
  inputs(params: Params): FigureInputs;
  build(ctx: Ctx): FigureOutput;
}

export class UnknownFigureError extends Error {
  constructor(readonly ids: string[], readonly valid: string[]) {
    super(`unknown figure id${ids.length > 1 ? 's' : ''} ${ids.map((s) => `'${s}'`).join(', ')}. Valid ids: ${valid.join(', ')}`);
    this.name = 'UnknownFigureError';
  }
}

/** The selected specs in registry order (all when `ids` is undefined); unknown ids throw {@link UnknownFigureError}. */
export function selectFigures<S extends { id: string }>(specs: readonly S[], ids?: readonly string[]): S[] {
  if (!ids) return [...specs];
  const valid = specs.map((s) => s.id);
  const unknown = ids.filter((id) => !valid.includes(id));
  if (unknown.length) throw new UnknownFigureError(unknown, valid);
  return specs.filter((s) => ids.includes(s.id));
}

export interface CaptionBlock {
  number: number;
  file: string;
  /** the whole block, starting with "**Fig. N (file).**" (may span several paragraphs, e.g. a table) */
  text: string;
}

export function captionBlock(number: number, file: string, body: string): CaptionBlock {
  return { number, file, text: `**Fig. ${number} (${file}).** ${body.trim()}` };
}

const BLOCK_START = /^\*\*Fig\. (\d+) \(([^)]+)\)\.\*\*/;

/** Splits captions.md into its header (text before the first figure) and figure blocks. */
export function parseCaptions(md: string): { header: string; blocks: CaptionBlock[] } {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const head: string[] = [];
  const blocks: CaptionBlock[] = [];
  let cur: { number: number; file: string; lines: string[] } | null = null;
  const close = () => { if (cur) blocks.push({ number: cur.number, file: cur.file, text: cur.lines.join('\n').trim() }); };
  for (const line of lines) {
    const m = BLOCK_START.exec(line);
    if (m) { close(); cur = { number: parseInt(m[1], 10), file: m[2], lines: [line] }; }
    else if (cur) cur.lines.push(line);
    else head.push(line);
  }
  close();
  return { header: head.join('\n').trim(), blocks };
}

/**
 * Merges regenerated caption blocks into an existing captions.md: blocks of the same file are
 * replaced, other blocks kept, new ones added; blocks are ordered by figure number, and the header
 * is replaced by `header`.
 */
export function mergeCaptions(existing: string | null, header: string, updates: readonly CaptionBlock[]): string {
  const old = existing ? parseCaptions(existing).blocks : [];
  const byFile = new Map<string, CaptionBlock>();
  for (const b of old) byFile.set(b.file, b);
  for (const b of updates) byFile.set(b.file, b);
  const blocks = [...byFile.values()].sort((a, b) => a.number - b.number || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return `${header.trim()}\n\n${blocks.map((b) => b.text).join('\n\n')}\n`;
}

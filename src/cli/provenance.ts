/// <reference types="node" />
/**
 * Provenance of generated figures: `figures.manifest.json`, written next to the figures.
 *
 * Records the software version (package.json), the concept DOI, the git commit and dirty flag (via
 * the git CLI; null when git is unavailable), Node/V8 versions, the command line, and per figure the
 * SHA-256 of its canonical configuration, the simulation seeds and the SHA-256 of every output file
 * and of its caption. The figures themselves carry only the version and the configuration hash (PDF
 * Info dict, SVG <metadata>) — never the git SHA, so that regenerating from a new commit does not
 * change files whose content did not change. `npm run figures -- --check` verifies the files in the
 * output folder against the manifest (integrity) and regenerates into a temporary folder to compare
 * the new hashes with it (reproducibility).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCaptions } from '../plot/registry';
import { canonicalJSON } from '../plot/sha256';

export const CONCEPT_DOI = '10.5281/zenodo.22259861';
export const MANIFEST_FILE = 'figures.manifest.json';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export interface FileRecord { sha256: string; bytes: number }
export interface FigureRecord {
  /** output file stem, e.g. fig01_equilibrium */
  file: string;
  /** SHA-256 of the canonical JSON of the figure's inputs (configurations, grid sizes) */
  configSha256: string;
  params: Record<string, unknown>;
  seeds: Record<string, number>;
  /** output files by name (fig01_equilibrium.svg, …) */
  files: Record<string, FileRecord>;
  /** SHA-256 of the figure's caption block in captions.md */
  captionSha256: string;
}
export interface FiguresManifest {
  schema: 1;
  generator: string;
  version: string;
  conceptDoi: string;
  git: { sha: string; dirty: boolean } | null;
  runtime: { node: string; v8: string; platform: string; arch: string };
  argv: string[];
  formats: string[];
  /** SHA-256 over all figures' configuration hashes */
  configSha256: string;
  seeds: Record<string, number>;
  figures: Record<string, FigureRecord>;
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}
export function fileRecord(data: Uint8Array | string): FileRecord {
  return { sha256: sha256Hex(data), bytes: typeof data === 'string' ? Buffer.byteLength(data) : data.length };
}

export function packageVersion(root: string = ROOT): string {
  try { return String(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? '0.0.0'); } catch { return '0.0.0'; }
}

/** HEAD commit and whether the working tree has changes (tracked or untracked); null without git. */
export function gitInfo(cwd: string = ROOT): { sha: string; dirty: boolean } | null {
  try {
    const opt = { cwd, encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'], timeout: 10_000 };
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], opt).trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) return null;
    const dirty = execFileSync('git', ['status', '--porcelain'], opt).trim() !== '';
    return { sha, dirty };
  } catch {
    return null;
  }
}

export function runtimeInfo(): FiguresManifest['runtime'] {
  return { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch };
}

/** SHA-256 of a figure's canonical inputs */
export function configHash(id: string, config: unknown): string {
  return sha256Hex(canonicalJSON({ id, config }));
}

/** SHA-256 over the figures' configuration hashes (sorted by id) */
export function combinedConfigHash(figures: Record<string, FigureRecord>): string {
  return sha256Hex(canonicalJSON(Object.fromEntries(Object.entries(figures).map(([id, f]) => [id, f.configSha256]))));
}

export function readManifest(dir: string): FiguresManifest | null {
  const p = join(dir, MANIFEST_FILE);
  if (!existsSync(p)) return null;
  const m = JSON.parse(readFileSync(p, 'utf8')) as FiguresManifest;
  if (m.schema !== 1 || typeof m.figures !== 'object' || m.figures === null) throw new Error(`${p}: unsupported manifest (schema ${String(m.schema)})`);
  return m;
}

export function writeManifest(dir: string, m: FiguresManifest): void {
  writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(m, null, 2) + '\n');
}

/**
 * Merges a partial run into an existing manifest: figures of the fresh run replace their entries,
 * the others are kept; run-level fields (version, git, runtime, argv) describe the latest run.
 */
export function mergeManifest(old: FiguresManifest | null, fresh: FiguresManifest): FiguresManifest {
  const figures: Record<string, FigureRecord> = { ...(old?.figures ?? {}), ...fresh.figures };
  const sorted = Object.fromEntries(Object.entries(figures).sort((a, b) => (a[1].file < b[1].file ? -1 : a[1].file > b[1].file ? 1 : 0)));
  const seeds: Record<string, number> = {};
  for (const f of Object.values(sorted)) Object.assign(seeds, f.seeds);
  const formats = [...new Set([...(old?.formats ?? []), ...fresh.formats])].sort();
  return { ...fresh, formats, configSha256: combinedConfigHash(sorted), seeds: Object.fromEntries(Object.entries(seeds).sort()), figures: sorted };
}

/** Output files a git checkout may convert to CRLF line endings (core.autocrlf); PDFs are binary. */
const TEXT_OUTPUT = /\.(svg|md|json)$/i;

/**
 * Checks the files that the manifest records against what is in `dir` (only the given ids): every
 * output file must exist with the recorded SHA-256, and each figure's caption block in captions.md
 * must hash to the recorded caption SHA-256 (caption blocks are compared as text, so line endings do
 * not matter there). An SVG that differs only by CRLF line endings — a Windows checkout with git
 * core.autocrlf — counts as identical and is listed in `notes` (the golden harness treats its files
 * the same way). Returns human-readable difference lines.
 */
export function verifyFilesOnDisk(m: FiguresManifest, dir: string, ids: readonly string[]): { diffs: string[]; notes: string[] } {
  const diffs: string[] = [], notes: string[] = [];
  const capPath = join(dir, 'captions.md');
  const captions = existsSync(capPath) ? new Map(parseCaptions(readFileSync(capPath, 'utf8')).blocks.map((b) => [b.file, b])) : null;
  if (!captions) diffs.push('captions.md: missing');
  for (const id of ids) {
    const e = m.figures[id];
    if (!e) continue; // reported by the caller
    for (const [name, rec] of Object.entries(e.files)) {
      const p = join(dir, name);
      if (!existsSync(p)) { diffs.push(`${name}: missing`); continue; }
      const data = readFileSync(p);
      const sha = sha256Hex(data);
      if (sha === rec.sha256) continue;
      if (TEXT_OUTPUT.test(name) && data.includes(13)) {
        const lf = Buffer.from(data.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
        if (sha256Hex(lf) === rec.sha256) { notes.push(`${name}: CRLF line endings (git core.autocrlf checkout); identical with LF`); continue; }
      }
      diffs.push(`${name}: sha256 ${sha.slice(0, 12)}… (${data.length} B) ≠ manifest ${rec.sha256.slice(0, 12)}… (${rec.bytes} B)`);
    }
    if (captions) {
      const b = captions.get(e.file);
      if (!b) diffs.push(`captions.md: no caption for ${e.file}`);
      else if (sha256Hex(b.text) !== e.captionSha256) diffs.push(`captions.md: caption of ${e.file} differs`);
    }
  }
  return { diffs, notes };
}

/**
 * Differences between the manifest and a regenerated set of figures (only the given ids):
 * configuration hash, caption hash and every recorded output file. Returns human-readable lines.
 */
export function compareWithManifest(expected: FiguresManifest, actual: Record<string, FigureRecord>, ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const e = expected.figures[id], a = actual[id];
    if (!e) { out.push(`${id}: not in the manifest`); continue; }
    if (!a) { out.push(`${id}: not regenerated`); continue; }
    if (e.configSha256 !== a.configSha256) out.push(`${id}: configuration hash ${a.configSha256.slice(0, 12)}… ≠ manifest ${e.configSha256.slice(0, 12)}…`);
    if (e.captionSha256 !== a.captionSha256) out.push(`${id}: caption differs`);
    for (const [name, rec] of Object.entries(e.files)) {
      const got = a.files[name];
      if (!got) out.push(`${name}: not regenerated`);
      else if (got.sha256 !== rec.sha256) out.push(`${name}: sha256 ${got.sha256.slice(0, 12)}… (${got.bytes} B) ≠ manifest ${rec.sha256.slice(0, 12)}… (${rec.bytes} B)`);
    }
  }
  return out;
}

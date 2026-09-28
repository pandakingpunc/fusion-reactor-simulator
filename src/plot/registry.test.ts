/// <reference types="node" />
/**
 * Figure registry, captions.md merging, provenance manifest merging, and the figures CLI contract
 * (unknown ids and bad --check usage exit 2; --check detects a changed output file, exit 1).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UnknownFigureError, captionBlock, mergeCaptions, parseCaptions, selectFigures } from './registry';
import { PAPER_FIGURES, PAPER_FIGURE_IDS, PaperNeed, poolTasks } from './figures/paper';
import { FigureRecord, FiguresManifest, MANIFEST_FILE, compareWithManifest, configHash, mergeManifest } from '../cli/provenance';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('figure registry', () => {
  it('lists the nine paper figures with unique ids, numbers and files', () => {
    expect(PAPER_FIGURE_IDS).toEqual(['equilibrium', 'profiles', 'timetraces', 'popcon', 'validation', 'lawson', 'verification', 'mhd', 'scan']);
    expect(PAPER_FIGURES.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(PAPER_FIGURES.map((s) => s.file)).size).toBe(9);
    for (const s of PAPER_FIGURES) expect(s.file).toMatch(new RegExp(`^fig0${s.number}_`));
  });

  it('selects in registry order and rejects unknown ids', () => {
    expect(selectFigures(PAPER_FIGURES, ['scan', 'equilibrium']).map((s) => s.id)).toEqual(['equilibrium', 'scan']);
    expect(selectFigures(PAPER_FIGURES).length).toBe(9);
    expect(() => selectFigures(PAPER_FIGURES, ['scan', 'nope'])).toThrow(UnknownFigureError);
    expect(() => selectFigures(PAPER_FIGURES, ['nope'])).toThrow(/unknown figure id 'nope'\. Valid ids: equilibrium, profiles/);
  });

  it('needs drive the pool: verification and POPCON are pool tasks, long 1.5D runs first', () => {
    const needs = new Set<PaperNeed>(selectFigures(PAPER_FIGURES, ['verification', 'popcon', 'validation']).flatMap((s) => s.needs));
    expect([...needs].sort()).toEqual(['iter15', 'popcon', 'presets', 'verification']);
    const ids = poolTasks(needs, { scan: 3 }).map((t) => t.id);
    expect([...ids].sort()).toEqual(['DEMO', 'DEMO15', 'ITER', 'JET', 'JET15', 'NIF', 'SPARC', 'SPARC15', 'popcon', 'verification']);
    expect(ids[0]).toBe('DEMO15'); // the longest discharge starts first
    for (const id of ['verification', 'popcon']) expect(ids.indexOf(id)).toBeLessThan(ids.indexOf('ITER'));
    expect(poolTasks(needs, { scan: 3 }).map((t) => t.id)).toEqual(ids); // deterministic order
    expect(poolTasks(new Set(['scan']), { scan: 3 }).length).toBe(9);
  });

  it('configuration hashes are stable and follow the inputs', () => {
    const scan = PAPER_FIGURES.find((s) => s.id === 'scan')!;
    const h11 = configHash('scan', scan.inputs({ scan: 11 }).config);
    expect(configHash('scan', scan.inputs({ scan: 11 }).config)).toBe(h11);
    expect(configHash('scan', scan.inputs({ scan: 5 }).config)).not.toBe(h11);
    expect(scan.inputs({ scan: 11 }).seeds).toEqual({ ITER: 42 });
  });
});

describe('captions.md merge', () => {
  const existing = readFileSync(join(ROOT, 'docs/figures/captions.md'), 'utf8');

  it('parses the committed captions (multi-paragraph blocks such as the validation table stay whole)', () => {
    const { header, blocks } = parseCaptions(existing);
    expect(header.startsWith('# Figure captions')).toBe(true);
    expect(blocks.map((b) => b.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const v = blocks.find((b) => b.file === 'fig05_validation')!;
    expect(v.text).toContain('| quantity | reference | 0D ratio | 1.5D ratio |');
    expect(v.text).toContain('| NIF  gain G |');
  });

  it('--only replaces the regenerated captions and keeps all others', () => {
    const merged = mergeCaptions(existing, '# Figure captions\n\nnew header', [captionBlock(9, 'fig09_scan', 'NEW scan caption.'), captionBlock(1, 'fig01_equilibrium', 'NEW eq caption.')]);
    const before = parseCaptions(existing).blocks, after = parseCaptions(merged).blocks;
    expect(after.length).toBe(9);
    expect(after.map((b) => b.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(after[0].text).toBe('**Fig. 1 (fig01_equilibrium).** NEW eq caption.');
    expect(after[8].text).toBe('**Fig. 9 (fig09_scan).** NEW scan caption.');
    for (let k = 1; k < 8; k++) expect(after[k].text).toBe(before[k].text);
    expect(parseCaptions(merged).header).toBe('# Figure captions\n\nnew header');
    // idempotent
    expect(mergeCaptions(merged, '# Figure captions\n\nnew header', [])).toBe(merged);
  });

  it('starts a new file when there is none', () => {
    const md = mergeCaptions(null, '# H', [captionBlock(7, 'fig07_verification', 'x')]);
    expect(md).toBe('# H\n\n**Fig. 7 (fig07_verification).** x\n');
  });
});

describe('provenance manifest', () => {
  const rec = (file: string, sha: string): FigureRecord => ({ file, configSha256: 'c', params: {}, seeds: { ITER: 42 }, files: { [`${file}.svg`]: { sha256: sha, bytes: 1 } }, captionSha256: 'k' });
  const base = (figures: Record<string, FigureRecord>): FiguresManifest => ({
    schema: 1, generator: 'test', version: '1', conceptDoi: '10.5281/zenodo.22259861', git: null,
    runtime: { node: 'v24.0.0', v8: 'x', platform: 'p', arch: 'a' }, argv: [], formats: ['svg'], configSha256: '', seeds: {}, figures,
  });

  it('a partial run keeps the other figures', () => {
    const old = base({ equilibrium: rec('fig01_equilibrium', 'a'), scan: rec('fig09_scan', 'b') });
    const m = mergeManifest(old, base({ scan: rec('fig09_scan', 'c') }));
    expect(Object.keys(m.figures)).toEqual(['equilibrium', 'scan']);
    expect(m.figures.scan.files['fig09_scan.svg'].sha256).toBe('c');
    expect(m.figures.equilibrium.files['fig01_equilibrium.svg'].sha256).toBe('a');
    expect(m.seeds).toEqual({ ITER: 42 });
    expect(m.configSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('compare lists changed and missing outputs', () => {
    const exp = base({ scan: rec('fig09_scan', 'b') });
    expect(compareWithManifest(exp, { scan: rec('fig09_scan', 'b') }, ['scan'])).toEqual([]);
    expect(compareWithManifest(exp, { scan: rec('fig09_scan', 'x') }, ['scan'])[0]).toMatch(/^fig09_scan\.svg: sha256/);
    expect(compareWithManifest(exp, {}, ['scan'])).toEqual(['scan: not regenerated']);
    expect(compareWithManifest(exp, {}, ['mhd'])).toEqual(['mhd: not in the manifest']);
  });
});

function figures(...args: string[]) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/figures.cli.ts', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('figures CLI', { timeout: 180_000 }, () => {
  it('unknown --only id → exit 2 listing the valid ids', () => {
    const r = figures('--only', 'bogus', '--out', join(tmpdir(), 'frs-never-written'));
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--only: unknown value 'bogus'\. Valid values: equilibrium, profiles, .*scan/);
  });

  it('--check without a manifest, or with --scan/--formats → exit 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frs-figtest-'));
    try {
      const r = figures('--check', '--out', dir);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain(`no ${MANIFEST_FILE}`);
      expect(figures('--check', '--scan', '5', '--out', dir).code).toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('--only writes the figure, captions.md and manifest; --check finds a changed file (exit 1) and names only it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frs-figtest-'));
    try {
      const g = figures('--only', 'verification', '--threads', '1', '--out', dir);
      expect(g.code, g.stderr).toBe(0);
      const man = JSON.parse(readFileSync(join(dir, MANIFEST_FILE), 'utf8')) as FiguresManifest;
      expect(Object.keys(man.figures)).toEqual(['verification']);
      expect(man.conceptDoi).toBe('10.5281/zenodo.22259861');
      expect(Object.keys(man.figures.verification.files).sort()).toEqual(['fig07_verification.pdf', 'fig07_verification.svg']);
      const svg = readFileSync(join(dir, 'fig07_verification.svg'), 'utf8');
      expect(svg).toContain(`config-sha256="${man.figures.verification.configSha256}"`);
      expect(svg).not.toContain(man.git?.sha ?? '@@no-git@@');
      expect(readFileSync(join(dir, 'captions.md'), 'utf8')).toContain('**Fig. 7 (fig07_verification).**');
      // tamper with one recorded hash: the regenerated SVG must still match, the PDF must not
      man.figures.verification.files['fig07_verification.pdf'].sha256 = '0'.repeat(64);
      writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(man));
      const c = figures('--check', '--threads', '1', '--out', dir);
      expect(c.code, c.stderr).toBe(1);
      expect(c.stdout).toMatch(/fig07_verification\.pdf: sha256/);
      expect(c.stdout).not.toMatch(/fig07_verification\.svg: sha256|caption differs|configuration hash/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

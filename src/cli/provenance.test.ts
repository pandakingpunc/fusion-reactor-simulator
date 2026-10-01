/// <reference types="node" />
/**
 * Run-level provenance of the figures manifest, in process: package version, git commit and dirty
 * flag, runtime, the manifest file round trip and the edge cases of merging and comparison. (The
 * main merging, comparison and on-disk verification cases are in src/plot/registry.test.ts; the
 * figures CLI calls these helpers from a child process, which V8 coverage of the test process does
 * not see.)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONCEPT_DOI, FigureRecord, FiguresManifest, MANIFEST_FILE, combinedConfigHash, compareWithManifest, gitInfo, mergeManifest, packageVersion, readManifest, runtimeInfo,
  verifyFilesOnDisk, writeManifest,
} from './provenance';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const withTempDir = (f: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'provenance-'));
  try { f(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

const manifest = (): FiguresManifest => ({
  schema: 1, generator: 'test', version: '1.2.3', conceptDoi: CONCEPT_DOI, git: { sha: 'a'.repeat(40), dirty: false },
  runtime: runtimeInfo(), argv: ['--only', 'mhd'], formats: ['pdf', 'svg'], configSha256: 'c'.repeat(64), seeds: { ITER_15D: 42 },
  figures: { mhd: { file: 'fig08_mhd', configSha256: 'd'.repeat(64), params: {}, seeds: { ITER_15D: 42 }, files: { 'fig08_mhd.svg': { sha256: 'e'.repeat(64), bytes: 10 } }, captionSha256: 'f'.repeat(64) } },
});

describe('figure provenance: run information', () => {
  it('packageVersion reads package.json and falls back to 0.0.0 without one', () => {
    expect(packageVersion()).toBe(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
    withTempDir((dir) => {
      expect(packageVersion(dir)).toBe('0.0.0');
      writeFileSync(join(dir, 'package.json'), '{"name":"x"}');
      expect(packageVersion(dir)).toBe('0.0.0');
    });
  });

  it('gitInfo gives the HEAD commit and a dirty flag, or null outside a repository', () => {
    const g = gitInfo();
    // null only when git is not installed; in a checkout it is the 40-digit HEAD SHA
    if (g) {
      expect(g.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(typeof g.dirty).toBe('boolean');
    }
    // a fresh temp folder is no repository, unless git hooks point every command at one through GIT_DIR
    if (!process.env.GIT_DIR) withTempDir((dir) => expect(gitInfo(dir)).toBeNull());
  });

  it('runtimeInfo records the Node and V8 versions of this process', () => {
    expect(runtimeInfo()).toEqual({ node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch });
  });
});

describe('figure provenance: manifest file', () => {
  it('writeManifest / readManifest round trip; a missing manifest reads as null', () => {
    withTempDir((dir) => {
      expect(readManifest(dir)).toBeNull();
      const m = manifest();
      writeManifest(dir, m);
      const text = readFileSync(join(dir, MANIFEST_FILE), 'utf8');
      expect(text.endsWith('}\n')).toBe(true);
      expect(text).not.toContain('\r');
      expect(readManifest(dir)).toEqual(m);
    });
  });

  it('readManifest rejects another schema or a manifest without figures', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify({ ...manifest(), schema: 2 }));
      expect(() => readManifest(dir)).toThrow(/unsupported manifest \(schema 2\)/);
      writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify({ ...manifest(), figures: null }));
      expect(() => readManifest(dir)).toThrow(/unsupported manifest/);
    });
  });

  it('mergeManifest without an old manifest takes the fresh run as it is', () => {
    const m = manifest();
    const merged = mergeManifest(null, m);
    expect(merged.figures).toEqual(m.figures);
    expect(merged.formats).toEqual(['pdf', 'svg']);
    expect(merged.seeds).toEqual({ ITER_15D: 42 });
  });

  it('mergeManifest orders the figures by output file stem whatever the order of the two runs, keeps ties in the order given and lets the fresh run describe itself', () => {
    const fig = (file: string, seed: number, files: string[] = [`${file}.svg`]): FigureRecord => ({
      ...manifest().figures.mhd, file, seeds: { [`seed_${file}`]: seed }, files: Object.fromEntries(files.map((f) => [f, { sha256: 'a'.repeat(64), bytes: 1 }])),
    });
    const old: FiguresManifest = { ...manifest(), version: '1.0.0', formats: ['svg'], figures: { late: fig('fig09_b', 1), tie1: fig('fig05_x', 2), mid: fig('fig03_m', 3) } };
    const fresh: FiguresManifest = { ...manifest(), version: '2.0.0', argv: ['--only', 'early'], formats: ['pdf', 'svg'], figures: { early: fig('fig01_a', 4), tie2: fig('fig05_x', 5), mid: fig('fig03_m', 6, ['fig03_m.pdf']) } };
    const merged = mergeManifest(old, fresh);
    // insertion order is late, tie1, mid, early, tie2: sorted by stem, the two with the same stem stay tie1 then tie2
    expect(Object.keys(merged.figures)).toEqual(['early', 'mid', 'tie1', 'tie2', 'late']);
    // a figure of the fresh run replaces its old entry as a whole (the old svg of 'mid' is gone, not merged)
    expect(Object.keys(merged.figures.mid.files)).toEqual(['fig03_m.pdf']);
    expect(merged.figures.tie1.seeds).toEqual({ seed_fig05_x: 2 });
    // seeds are collected from the merged figures and sorted by name; formats are the sorted union
    expect(Object.keys(merged.seeds)).toEqual(['seed_fig01_a', 'seed_fig03_m', 'seed_fig05_x', 'seed_fig09_b']);
    expect(merged.formats).toEqual(['pdf', 'svg']);
    // run-level fields are the latest run's; the combined configuration hash covers all merged figures
    expect(merged.version).toBe('2.0.0');
    expect(merged.argv).toEqual(['--only', 'early']);
    expect(merged.configSha256).toBe(combinedConfigHash(merged.figures));
    expect(merged.configSha256).not.toBe(combinedConfigHash(fresh.figures));
  });

  it('compareWithManifest names a changed configuration, a changed caption and a file not regenerated', () => {
    const m = manifest();
    const e = m.figures.mhd;
    const actual = { mhd: { ...e, configSha256: '0'.repeat(64), captionSha256: '1'.repeat(64), files: {} } };
    expect(compareWithManifest(m, actual, ['mhd'])).toEqual([
      'mhd: configuration hash 000000000000… ≠ manifest dddddddddddd…',
      'mhd: caption differs',
      'fig08_mhd.svg: not regenerated',
    ]);
  });

  it('verifyFilesOnDisk leaves ids without a manifest entry to the caller', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'captions.md'), '# Figure captions\n');
      expect(verifyFilesOnDisk(manifest(), dir, ['scan'])).toEqual({ diffs: [], notes: [] });
    });
  });
});

describe('figure provenance: git information of a repository', () => {
  const git = (cwd: string, ...args: string[]) => spawnSync('git', ['-c', 'user.name=provenance test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  const commit = (dir: string) => {
    expect(git(dir, 'commit', '--allow-empty', '-q', '-m', 'first').status).toBe(0);
    return git(dir, 'rev-parse', 'HEAD').stdout.trim();
  };

  it('follows a repository through its states: no commit yet, clean, an untracked file, a changed tracked file', (ctx) => {
    if (process.env.GIT_DIR) ctx.skip(); // a git hook points every command at one repository
    withTempDir((dir) => {
      if (git(dir, 'init', '-q', '--object-format=sha1').status !== 0) ctx.skip(); // no usable git
      expect(gitInfo(dir)).toBeNull(); // HEAD does not exist yet
      const sha = commit(dir);
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      expect(gitInfo(dir)).toEqual({ sha, dirty: false });
      writeFileSync(join(dir, 'figure.svg'), '<svg/>');
      expect(gitInfo(dir)).toEqual({ sha, dirty: true }); // untracked files count
      expect(git(dir, 'add', 'figure.svg').status).toBe(0);
      expect(git(dir, 'commit', '-q', '-m', 'add the figure').status).toBe(0);
      const sha2 = git(dir, 'rev-parse', 'HEAD').stdout.trim();
      expect(sha2).not.toBe(sha);
      expect(gitInfo(dir)).toEqual({ sha: sha2, dirty: false });
      writeFileSync(join(dir, 'figure.svg'), '<svg width="1"/>');
      expect(gitInfo(dir)).toEqual({ sha: sha2, dirty: true }); // so do changes of tracked files
    });
  });

  it('records 40-digit commit names only: a repository with SHA-256 object names (64 digits) has no git information', (ctx) => {
    if (process.env.GIT_DIR) ctx.skip();
    withTempDir((dir) => {
      if (git(dir, 'init', '-q', '--object-format=sha256').status !== 0) ctx.skip(); // git older than 2.29
      const head = commit(dir);
      expect(head).toMatch(/^[0-9a-f]{64}$/);
      // the manifest says "no git" rather than carrying a commit name that the 40-digit check was not written for
      expect(gitInfo(dir)).toBeNull();
    });
  });
});

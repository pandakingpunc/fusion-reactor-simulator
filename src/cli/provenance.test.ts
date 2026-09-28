/// <reference types="node" />
/**
 * Run-level provenance of the figures manifest, in process: package version, git commit and dirty
 * flag, runtime, the manifest file round trip and the edge cases of merging and comparison. (The
 * main merging, comparison and on-disk verification cases are in src/plot/registry.test.ts; the
 * figures CLI calls these helpers from a child process, which V8 coverage of the test process does
 * not see.)
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONCEPT_DOI, FiguresManifest, MANIFEST_FILE, compareWithManifest, gitInfo, mergeManifest, packageVersion, readManifest, runtimeInfo,
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

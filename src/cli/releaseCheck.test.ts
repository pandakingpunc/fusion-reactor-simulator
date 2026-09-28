/// <reference types="node" />
/**
 * scripts/release-check.mjs on fixture repositories in a temp dir: a consistent fixture passes, and
 * each kind of inconsistency fails its own check with exit code 1.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../scripts/release-check.mjs', import.meta.url));
const CONCEPT = '10.5281/zenodo.22259861';

interface Fixture {
  pkg: Record<string, unknown>;
  cff: string;
  zenodo: string;
  changelog: string;
  readme: string;
  presets: string;
  license: boolean;
}

const good = (): Fixture => ({
  pkg: { name: 'x', private: true, version: '4.0.0', engines: { node: '>=20' } },
  cff: [
    'cff-version: 1.2.0', 'title: "X"', 'doi: 10.5281/zenodo.99999999 # version DOI', 'identifiers:', '  - type: doi',
    `    value: ${CONCEPT}`, '    description: concept DOI', '  - type: doi', '    value: 10.5281/zenodo.99999999',
    'version: "4.0.0"', "date-released: '2026-10-01'", 'keywords:', '  - fusion', '',
  ].join('\n'),
  zenodo: JSON.stringify({ title: 'X', version: '4.0.0' }, null, 2),
  changelog: '# Changelog\n\n## [Unreleased]\n\n## [4.0.0] — 2026-10-01\n\n- things\n\n## [3.0.0] — 2026-09-23\n',
  readme: '# X\n\nThree presets are not enough: here are 3 presets.\n\n    npm run validate   # 3 presets\n',
  presets: "export const PRESETS = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];\n",
  license: true,
});

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function run(f: Fixture, ...args: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'release-check-'));
  dirs.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify(f.pkg, null, 2));
  writeFileSync(join(root, 'CITATION.cff'), f.cff);
  writeFileSync(join(root, '.zenodo.json'), f.zenodo);
  writeFileSync(join(root, 'CHANGELOG.md'), f.changelog);
  writeFileSync(join(root, 'README.md'), f.readme);
  if (f.license) writeFileSync(join(root, 'LICENSE'), 'MIT');
  mkdirSync(join(root, 'src', 'physics'), { recursive: true });
  writeFileSync(join(root, 'src', 'physics', 'presets.ts'), f.presets);
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8', timeout: 30_000 });
  if (r.error) throw r.error;
  const line = (name: string) => r.stdout.split('\n').find((l) => new RegExp(`^\\s+[✓✗] ${name}\\s`).test(l)) ?? '';
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, line };
}

describe('release:check', { timeout: 60_000 }, () => {
  it('a consistent repository passes every check', () => {
    const r = run(good());
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/✓ release check: all 8 checks passed/);
    expect(r.line('version')).toMatch(/✓ version\s+4\.0\.0 in package\.json, CITATION\.cff, \.zenodo\.json and CHANGELOG \[4\.0\.0\]/);
    expect(r.line('citation-doi')).toContain(`concept DOI ${CONCEPT} listed in identifiers`);
    expect(r.line('readme-presets')).toContain('README.md says 3 presets; src/physics/presets.ts has 3');
    expect(r.line('date-released')).toContain('2026-10-01 (ISO 8601, same as CHANGELOG [4.0.0])');
  });

  it('a version mismatch in any of the four places fails the version check', () => {
    const cases: [string, (f: Fixture) => void][] = [
      ['package.json 4.0.1', (f) => { f.pkg.version = '4.0.1'; }],
      ['CITATION.cff 3.9.0', (f) => { f.cff = f.cff.replace('version: "4.0.0"', 'version: "3.9.0"'); }],
      ['.zenodo.json 4.1.0', (f) => { f.zenodo = JSON.stringify({ version: '4.1.0' }); }],
      ['CHANGELOG.md 3.0.0', (f) => { f.changelog = '## [Unreleased]\n\n## [3.0.0] — 2026-10-01\n'; }],
    ];
    for (const [what, mutate] of cases) {
      const f = good();
      mutate(f);
      const r = run(f);
      expect(r.code, what).toBe(1);
      expect(r.line('version'), what).toMatch(new RegExp(`✗ version\\s+versions differ: .*${what.replace(/\./g, '\\.')}`));
    }
  });

  it('[Unreleased] is allowed by default and rejected with --no-allow-unreleased', () => {
    expect(run(good(), '--allow-unreleased').code).toBe(0);
    const r = run(good(), '--no-allow-unreleased');
    expect(r.code).toBe(1);
    expect(r.line('unreleased')).toMatch(/✗ unreleased\s+\[Unreleased\] section above \[4\.0\.0\]/);
    const f = good();
    f.changelog = '## [4.0.0] — 2026-10-01\n';
    expect(run(f, '--no-allow-unreleased').code).toBe(0);
  });

  it('date-released must be an ISO date matching the CHANGELOG', () => {
    for (const [bad, msg] of [["'01.10.2026'", 'is not an ISO 8601 date'], ["'2026-02-30'", 'is not an ISO 8601 date'], ["'2026-10-02'", 'differs from the CHANGELOG date']]) {
      const f = good();
      f.cff = f.cff.replace("date-released: '2026-10-01'", `date-released: ${bad}`);
      const r = run(f);
      expect(r.code, bad).toBe(1);
      expect(r.line('date-released'), bad).toContain(msg);
    }
  });

  it('the concept DOI must be the doi or one of the identifiers', () => {
    const f = good();
    f.cff = f.cff.replace(`    value: ${CONCEPT}`, '    value: 10.5281/zenodo.11111111');
    const r = run(f);
    expect(r.code).toBe(1);
    expect(r.line('citation-doi')).toContain(`concept DOI ${CONCEPT} is neither the doi`);
    const g = good();
    g.cff = g.cff.replace('doi: 10.5281/zenodo.99999999 # version DOI', `doi: ${CONCEPT}`).replace(`    value: ${CONCEPT}`, '    value: 10.5281/zenodo.1');
    expect(run(g).line('citation-doi')).toContain(`doi is the concept DOI ${CONCEPT}`);
  });

  it('TODO markers, a wrong README preset count, missing engines.node and a missing LICENSE fail', () => {
    const f = good();
    f.cff = f.cff.replace('title: "X"', 'title: "X"\n# TODO: check the author list');
    f.zenodo = JSON.stringify({ title: 'TODO', version: '4.0.0' });
    f.readme = f.readme.replace('# 3 presets', '# 4 presets');
    delete f.pkg.engines;
    f.license = false;
    const r = run(f);
    expect(r.code).toBe(1);
    expect(r.line('no-todo')).toMatch(/✗ no-todo\s+CITATION\.cff:3: # TODO: check the author list \| \.zenodo\.json:1: /);
    expect(r.line('readme-presets')).toContain('README.md says 3, 4 presets; src/physics/presets.ts has 3');
    expect(r.line('engines-node')).toContain('package.json has no engines.node');
    expect(r.line('license')).toContain('no LICENSE file');
    expect(r.stdout).toMatch(/✗ release check: 4 of 8 checks failed \(no-todo, readme-presets, engines-node, license\)/);
  });

  it('unreadable inputs fail instead of crashing, and unknown flags are usage errors', () => {
    const f = good();
    f.presets = 'export const NOT_PRESETS = 1;\n';
    f.zenodo = '{ not json';
    const r = run(f);
    expect(r.code).toBe(1);
    expect(r.line('readme-presets')).toContain('does not export a PRESETS array');
    expect(r.line('version')).toMatch(/cannot parse \.zenodo\.json/);
    expect(run(good(), '--frobnicate').code).toBe(2);
  });
});

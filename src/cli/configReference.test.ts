/// <reference types="node" />
/**
 * docs/config-reference.md is generated from the two JSON Schemas by scripts/gen-config-reference.ts. This
 * test is the check that `npm run docs:config:check` runs, in-process: the file on disk is what the generator
 * writes (line endings normalised), every schema property has its row, every opt-in module of the v4 profile
 * model is marked with its default, and the command line exits 0 / 1 / 2 as documented.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NON_MODULE_SWITCHES, OPT_IN_MODULES, PROFILE_GROUPS, rangeText, renderConfigReference, type Node } from '../../scripts/gen-config-reference';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f: string): Node => JSON.parse(readFileSync(join(ROOT, 'schema', f), 'utf8')) as Node;
const config = read('fusion-sim.schema.json');
const scenario = read('scenario.schema.json');
const onDisk = readFileSync(join(ROOT, 'docs', 'config-reference.md'), 'utf8').replace(/\r\n/g, '\n');
const generated = renderConfigReference(config, scenario);

const deref = (root: Node, n: Node): Node => {
  if (typeof n.$ref !== 'string') return n;
  const { $ref, ...local } = n;
  return { ...root.$defs[$ref.replace('#/$defs/', '')], ...local };
};

/** every dotted path of every object property below a node (arrays are leaves) */
function paths(root: Node, node: Node, prefix: string, out: string[] = []): string[] {
  for (const [k, v] of Object.entries((node.properties ?? {}) as Node)) {
    out.push(prefix + k);
    const child = deref(root, v);
    if (child.type === 'object' && child.properties) paths(root, child, `${prefix}${k}.`, out);
  }
  return out;
}

describe('docs/config-reference.md', () => {
  it('is what scripts/gen-config-reference.ts generates (run `npm run docs:config` after a schema change)', () => {
    expect(onDisk === generated, 'docs/config-reference.md is stale: run npm run docs:config').toBe(true);
  });

  it('has a row for every property of every configuration family, with its dotted path', () => {
    const missing: string[] = [];
    for (const def of Object.values(config.$defs as Node)) {
      // geometry and profileSettings are reached through their parents: check the families (they require `method`)
      if (!(def.required as string[] | undefined)?.includes('method')) continue;
      for (const p of paths(config, def, '')) if (!generated.includes(`| \`${p}\` |`)) missing.push(p);
    }
    expect(missing).toEqual([]);
    const profileRows = generated.match(/^\| `profiles\.[A-Za-z0-9_.]+` \|/gm) ?? [];
    expect(profileRows.length).toBe(paths(config, config.$defs.profileSettings, '').length);
  });

  it('has a row for every scenario field and every documented control', () => {
    const top = paths(scenario, scenario, '').filter((p) => !p.startsWith('waveforms.'));
    for (const p of top) expect(generated.includes(`| \`${p}\` |`), p).toBe(true);
    for (const k of Object.keys(scenario.properties.waveforms.properties)) expect(generated.includes(`| \`${k}\` |`), k).toBe(true);
    for (const k of Object.keys(scenario.$defs.trigger.properties)) expect(generated.includes(`| \`triggers[].${k}\` |`), k).toBe(true);
    for (const k of Object.keys(scenario.$defs.waveform.properties)) expect(generated.includes(`| \`waveforms.<control>.${k}\` |`), k).toBe(true);
  });

  it('marks every opt-in module of the v4 profile model with its default-off value, and lists no module twice', () => {
    const keys = OPT_IN_MODULES.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    const profiles = deref(config, config.$defs.magneticConfig.properties.profiles).properties as Node;
    for (const k of [
      'pedestalModel', 'elmLoss', 'transportModel', 'impurityTransport', 'fastIonModel', 'cdModel', 'sawtoothTrigger', 'sawtoothReconnection',
      'neoclassicalModel', 'edgeModel',
    ]) {
      expect(keys, k).toContain(`profiles.${k}`);
      const dflt = JSON.stringify(profiles[k].default);
      expect(profiles[k].default, `${k} default`).toBeDefined();
      // in the module table ...
      expect(generated, k).toContain(`| \`profiles.${k}\` | ${'`'}${dflt}${'`'} |`);
      // ... and on the field's own row
      const row = generated.split('\n').find((l) => l.startsWith(`| \`profiles.${k}\` | string`));
      expect(row, k).toContain(`**Opt-in module: `);
      expect(row, k).toContain(`Default ${'`'}${dflt}${'`'} (off).`);
    }
    expect(keys).toContain('fidelity');
    expect(generated).toContain('| 1.5D profile model | `fidelity` | `"0D"` | `"1.5D"` |');
  });

  it('classifies every enum switch with a default in profileSettings: an opt-in module or an explicit non-module (so a new switch cannot go unmarked)', () => {
    const modules = new Set(OPT_IN_MODULES.map((m) => m.key));
    const switches = Object.entries(config.$defs.profileSettings.properties as Node)
      .filter(([, v]) => Array.isArray(v.enum) && v.default !== undefined)
      .map(([k]) => k);
    expect(switches.length).toBeGreaterThan(10);
    const unclassified = switches.filter((k) => !modules.has(`profiles.${k}`) && !NON_MODULE_SWITCHES.includes(k));
    expect(unclassified, 'add these to OPT_IN_MODULES (v4 module, default off) or to NON_MODULE_SWITCHES').toEqual([]);
    // the allowlist itself names real switches and no module
    for (const k of NON_MODULE_SWITCHES) {
      expect(switches, k).toContain(k);
      expect(modules.has(`profiles.${k}`), k).toBe(false);
    }
  });

  it('refuses to render a schema that gains an unclassified enum switch', () => {
    const copy = JSON.parse(JSON.stringify(config)) as Node;
    copy.$defs.profileSettings.properties.newModel = { enum: ['off', 'on'], default: 'off', description: 'a module added later' };
    expect(() => renderConfigReference(copy, scenario)).toThrow(/profiles\.newModel.*OPT_IN_MODULES/);
    // ... while a plain setting without a default or without an enum is not a switch
    const plain = JSON.parse(JSON.stringify(config)) as Node;
    plain.$defs.profileSettings.properties.newNumber = { type: 'number', default: 1, description: 'a number' };
    expect(() => renderConfigReference(plain, scenario)).not.toThrow();
  });

  it('states the schema constraints that a table row cannot: property-count bounds and the trigger if/then', () => {
    const rowOf = (name: string) => generated.split('\n').find((l) => l.startsWith(`| \`${name}\` |`)) ?? '';
    expect(rowOf('triggers[].set')).toContain('1 to 32 entries');
    expect(rowOf('triggers[].release')).toContain('1 to 32 entries');
    expect(generated).toMatch(/must not have a `release` and needs `hysteresis` 0/);
    // the note is tied to the schema: it fails loudly when the if/then goes away
    const copy = JSON.parse(JSON.stringify(scenario)) as Node;
    delete copy.$defs.trigger.then;
    expect(() => renderConfigReference(config, copy)).toThrow(/if\/then/);
  });

  it('keeps the curated profile groups free of unknown or repeated keys', () => {
    const real = new Set(Object.keys(config.$defs.profileSettings.properties));
    const grouped = PROFILE_GROUPS.flatMap((g) => g.keys);
    expect(grouped.filter((k) => !real.has(k))).toEqual([]);
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it('writes ranges in interval notation', () => {
    expect(rangeText({ exclusiveMinimum: 0, maximum: 100 })).toBe('(0, 100]');
    expect(rangeText({ minimum: 0, maximum: 1 })).toBe('[0, 1]');
    expect(rangeText({ minimum: 0 })).toBe('≥ 0');
    expect(rangeText({ exclusiveMinimum: 0 })).toBe('> 0');
    expect(rangeText({ maximum: 10000000 })).toBe('≤ 1e7');
    expect(rangeText({ type: 'string' })).toBe('');
  });

  it('keeps every table row at the column count of its header and free of raw angle brackets from a description', () => {
    const cols = (line: string): number => line.replace(/\\\|/g, '').split('|').length - 2;
    let width = 0;
    let rows = 0;
    for (const line of generated.split('\n')) {
      if (!line.startsWith('|')) { width = 0; continue; }
      if (/^\|[-|]+\|$/.test(line)) continue;
      if (width === 0) { width = cols(line); continue; } // the header row
      rows++;
      expect(cols(line), line.slice(0, 80)).toBe(width);
      expect(line.replace(/`[^`]*`/g, ''), line.slice(0, 80)).not.toMatch(/[<>]/);
    }
    expect(rows).toBeGreaterThan(250);
  });
});

describe('gen-config-reference command line', () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'scripts/gen-config-reference.ts', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });

  it('--check exits 0 for the committed file, 1 for a stale or missing one, 2 for a usage error', () => {
    expect(existsSync(join(ROOT, 'docs', 'config-reference.md'))).toBe(true);
    const ok = run('--check');
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain('up to date');

    const dir = mkdtempSync(join(tmpdir(), 'cfgref-'));
    try {
      const stale = join(dir, 'stale.md');
      writeFileSync(stale, `${generated}\nextra line\n`);
      const r = run('--check', '--out', stale);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('out of date');
      const missing = run('--check', '--out', join(dir, 'missing.md'));
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain('missing');
      // a CRLF checkout of the same text is still current
      const crlf = join(dir, 'crlf.md');
      writeFileSync(crlf, generated.replace(/\n/g, '\r\n'));
      expect(run('--check', '--out', crlf).status).toBe(0);
      // writing with --out produces the checked text
      const fresh = join(dir, 'fresh.md');
      expect(run('--out', fresh).status).toBe(0);
      expect(readFileSync(fresh, 'utf8')).toBe(generated);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(run('--bogus').status).toBe(2);
    expect(run('--out').status).toBe(2);
  });

  it('is reachable as npm run docs:config and docs:config:check', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['docs:config']).toBe('tsx scripts/gen-config-reference.ts');
    expect(pkg.scripts['docs:config:check']).toBe('tsx scripts/gen-config-reference.ts --check');
  });
});

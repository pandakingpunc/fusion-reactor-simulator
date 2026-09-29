/// <reference types="node" />
/**
 * The fusion-sim command line, in-process: `main(argv, env)` with virtual files and captured streams, and
 * scans run by the in-process executor. The spawned-process contracts (real exit codes, the worker pool)
 * are in spawn.test.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { PRESETS } from '../../physics/presets';
import { applyAssignments } from '../../physics/config/paths';
import { getPreset } from '../../physics/config/registry';
import { configJsonSchema } from '../../physics/config/schema';
import { runFingerprint } from '../../physics/kernel/fingerprint';
import { canonicalString } from '../../physics/kernel/canonical';
import { sha256Hex } from '../../physics/kernel/sha256';
import { Simulation } from '../../physics/simulation';
import { parseCsv } from '../../io/csv';
import { parseNdjson } from '../../io/ndjson';
import { readNetcdf3 } from '../../io/netcdf3';
import type { CliDeps, CliIo } from './common';
import { parseJsonFile, takeRepeated } from './common';
import { main } from './main';
import { DEFAULT_METRICS, checkMetric, gridPoints, inProcessExecutor, parseParam, workerUrl, type Executor } from './scanCmd';
import { EQDSK_UNAVAILABLE } from './otherCmds';
import { textSummary } from './runCmd';
import { runShot } from '../../physics/config/run';
import { NonFiniteStateError } from '../../physics/kernel/errors';
import { PoolAbortError, PoolConfigError } from '../pool';
import { CliUsageError } from '../args';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const VERSION = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version as string;

interface Result { code: number; out: string; err: string; bin: Uint8Array | undefined; files: Map<string, string | Uint8Array> }

async function cli(argv: string[], opts: { files?: Record<string, string>; tty?: boolean; stderrTty?: boolean; deps?: CliDeps; root?: string | undefined } = {}): Promise<Result> {
  let out = '', err = '';
  let bin: Uint8Array | undefined;
  const files = new Map<string, string | Uint8Array>();
  const io: CliIo = {
    stdout: { write: (d) => { if (typeof d === 'string') out += d; else bin = d; }, isTTY: opts.tty ?? false },
    stderr: { write: (t) => { err += t; }, isTTY: opts.stderrTty ?? false },
    readText: (p) => {
      if (opts.files && p in opts.files) return opts.files[p];
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    },
    writeFile: (p, d) => { files.set(p, d); },
  };
  const code = await main(argv, { io, deps: { execute: inProcessExecutor, ...opts.deps }, root: 'root' in opts ? opts.root : ROOT });
  return { code, out, err, bin, files };
}
const file = (r: Result, name: string): string | Uint8Array => {
  const v = r.files.get(resolve(name));
  if (v === undefined) throw new Error(`nothing was written to ${name}; wrote: ${[...r.files.keys()].join(', ')}`);
  return v;
};
const json = (s: string): any => JSON.parse(s);

const SHORT = ['--preset', 'JET', '--t-end', '1'];

describe('top level', () => {
  it('no arguments: usage on stderr, exit 2', async () => {
    const r = await cli([]);
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
    expect(r.err).toMatch(/^Usage: fusion-sim <command>/);
  });
  it('--help, -h and help: usage on stdout, exit 0, all five commands listed', async () => {
    for (const a of ['--help', '-h', 'help']) {
      const r = await cli([a]);
      expect(r.code).toBe(0);
      for (const c of ['run', 'scan', 'export-eqdsk', 'presets', 'schema']) expect(r.out).toContain(`  ${c}`);
      expect(r.out).toMatch(/Exit codes: 0 success; 1 .*; 2 usage or input error/);
    }
  });
  it('--version prints the package version (0.0.0 without a package root)', async () => {
    expect((await cli(['--version'])).out).toBe(`${VERSION}\n`);
    expect((await cli(['-V'])).out).toBe(`${VERSION}\n`);
    expect((await cli(['version'], { root: undefined })).out).toBe('0.0.0\n');
  });
  it('an unknown command: exit 2 and the list of commands', async () => {
    const r = await cli(['frobnicate']);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/unknown command 'frobnicate'\. Commands: run, scan, export-eqdsk, presets, schema/);
  });
  it('every command answers --help with its own usage, exit 0', async () => {
    for (const c of ['run', 'scan', 'export-eqdsk', 'presets', 'schema']) {
      const r = await cli([c, '--help']);
      expect(r.code, c).toBe(0);
      expect(r.out, c).toMatch(new RegExp(`^Usage: fusion-sim ${c} \\[options\\]`));
    }
    expect((await cli(['run', '--help'])).out).toMatch(/--preset ID.*built-in preset/);
    expect((await cli(['run', '--help'])).out).toMatch(/--set PATH=VALUE \(repeatable\)/);
  });
  it('a usage error names the command and points at --help, exit 2', async () => {
    const r = await cli(['run', '--bogus']);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/^fusion-sim run: error: unknown flag --bogus/);
    expect(r.err).toMatch(/Run `fusion-sim run --help` for usage\./);
  });
});

describe('presets', () => {
  it('lists every preset with its method and fidelity', async () => {
    const r = await cli(['presets']);
    expect(r.code).toBe(0);
    const lines = r.out.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^ID +METHOD +FIDELITY +DURATION +NAME$/);
    expect(lines).toHaveLength(PRESETS.length + 1);
    expect(lines.find((l) => l.startsWith('ITER15 '))).toMatch(/tokamak +1\.5D +400 s/);
    expect(lines.find((l) => l.startsWith('NIF '))).toMatch(/icf_indirect +- +pulsed/);
  });
  it('--json is an array of records', async () => {
    const rows = json((await cli(['presets', '--json'])).out);
    expect(rows.map((x: any) => x.id)).toEqual(PRESETS.map((p) => p.id));
    expect(rows[0]).toMatchObject({ id: 'ITER', method: 'tokamak', fidelity: '0D', t_end: 400 });
    expect(rows.find((x: any) => x.id === 'NIF')).toMatchObject({ fidelity: '-', t_end: null });
  });
  it('--show prints the configuration of one preset', async () => {
    const r = await cli(['presets', '--show', 'SPARC15']);
    expect(json(r.out)).toEqual(json(JSON.stringify(PRESETS.find((p) => p.id === 'SPARC15')!.cfg)));
  });
  it('--show of an unknown preset: exit 2, the valid ids and a suggestion', async () => {
    const r = await cli(['presets', '--show', 'ITER51']);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/unknown preset 'ITER51' \(did you mean 'ITER(15)?'\?\)\. Valid presets: ITER, JET/);
    expect((await cli(['presets', '--show', 'ITER', '--json'])).code).toBe(2);
  });
});

describe('schema', () => {
  it('prints the JSON Schema', async () => {
    const r = await cli(['schema']);
    expect(r.code).toBe(0);
    expect(json(r.out)).toEqual(json(JSON.stringify(configJsonSchema())));
    expect((await cli(['schema', '--id'])).out).toBe('urn:fusion-reactor-simulator:schema:reactor-config\n');
  });
  it('--out writes it to a file', async () => {
    const r = await cli(['schema', '--out', 'cfg.schema.json']);
    expect(r.out).toBe('');
    expect(json(file(r, 'cfg.schema.json') as string).$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });
  it('--check: valid, invalid (every problem, exit 1), unreadable and not JSON (exit 2)', async () => {
    const good = JSON.stringify(PRESETS[0].cfg);
    const r = await cli(['schema', '--check', 'a.json'], { files: { 'a.json': good } });
    expect(r.code).toBe(0);
    expect(r.out).toBe('a.json: valid (tokamak)\n');
    const bad = JSON.stringify({ ...PRESETS[0].cfg, B0: -1, fuel: 'XX', geometry: { R: 6.2, a: 9, kappa: 1.7, delta: 0.3 } });
    const b = await cli(['schema', '--check', 'b.json'], { files: { 'b.json': bad } });
    expect(b.code).toBe(1);
    expect(b.err).toMatch(/^b\.json: invalid configuration \(3 problems\):/);
    expect(b.err).toMatch(/ {2}B0: must be > 0/);
    expect(b.err).toMatch(/ {2}geometry\.a: must be smaller than geometry\.R/);
    expect((await cli(['schema', '--check', 'missing.json'])).code).toBe(2);
    const n = await cli(['schema', '--check', 'n.json'], { files: { 'n.json': '{oops' } });
    expect(n.code).toBe(2);
    expect(n.err).toMatch(/n\.json: not valid JSON/);
    const one = await cli(['schema', '--check', 'c.json'], { files: { 'c.json': JSON.stringify({ method: 'muon' }) } });
    expect(one.err).toMatch(/\(6 problems\)/);
  });
  it('a byte order mark (Windows PowerShell writes one) does not matter', async () => {
    const r = await cli(['schema', '--check', 'a.json'], { files: { 'a.json': '﻿' + JSON.stringify(PRESETS[1].cfg) } });
    expect(r.code).toBe(0);
  });
});

describe('run: configuration', () => {
  it('needs a preset or a file', async () => {
    const r = await cli(['run']);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/give --preset ID or --config FILE/);
  });
  it('an unknown preset, an unreadable file, a file that is not JSON', async () => {
    expect((await cli(['run', '--preset', 'NOPE'])).err).toMatch(/unknown preset 'NOPE'/);
    const u = await cli(['run', '--config', 'nofile.json']);
    expect(u.code).toBe(2);
    expect(u.err).toMatch(/cannot read nofile\.json: ENOENT/);
    const n = await cli(['run', '--config', 'x.json'], { files: { 'x.json': '[1,' } });
    expect(n.code).toBe(2);
    expect(n.err).toMatch(/x\.json: not valid JSON/);
  });
  it('an invalid configuration: exit 2, every problem with its path, before anything runs', async () => {
    const r = await cli(['run', '--preset', 'ITER', '--set', 'geometry.kappa=0.5', '--set', 'heating.P_NBI_mw=3', '--set', 'B0=-1']);
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
    expect(r.err).toMatch(/^fusion-sim run: error: invalid configuration \(3 problems\):/);
    expect(r.err).toMatch(/ {2}B0: must be > 0 and <= 100, got -1/);
    expect(r.err).toMatch(/ {2}geometry\.kappa: must be >= 1 and <= 5, got 0\.5/);
    expect(r.err).toMatch(/ {2}heating\.P_NBI_mw: is not a known property \(did you mean 'P_NBI_MW'\?\)/);
  });
  it('a malformed setting or a forbidden path is an input error', async () => {
    expect((await cli(['run', '--preset', 'ITER', '--set', 'nothing'])).err).toMatch(/not of the form path=value/);
    expect((await cli(['run', '--preset', 'ITER', '--set', '__proto__.x=1'])).code).toBe(2);
    expect((await cli(['run', '--preset', 'ITER', '--set'])).err).toMatch(/missing value for --set/);
  });
  it('--config alone is a full configuration; with --preset it is a patch; --set comes last; shorthands before --set', async () => {
    const full = JSON.stringify({ ...PRESETS.find((p) => p.id === 'JET')!.cfg, t_end: 0.5 });
    const a = json((await cli(['run', '--config', 'f.json'], { files: { 'f.json': full } })).out);
    expect(a.config.t_end).toBe(0.5);
    expect(a.provenance.preset).toBeNull();
    const patch = JSON.stringify({ t_end: 0.5, heating: { P_NBI_MW: 5 } });
    const b = json((await cli(['run', '--preset', 'JET', '--config', 'p.json', '--set', 'heating.P_ICRH_MW=1'], { files: { 'p.json': patch } })).out);
    expect(b.config.heating).toMatchObject({ P_NBI_MW: 5, P_ICRH_MW: 1, P_ECRH_MW: 0 });
    expect(b.config.t_end).toBe(0.5);
    expect(b.provenance.preset).toBe('JET');
    const c = json((await cli(['run', '--preset', 'JET', '--t-end', '2', '--seed', '9', '--fuel', 'DD', '--set', 't_end=0.4'])).out);
    expect(c.config).toMatchObject({ t_end: 0.4, seed: 9, fuel: 'DD' });
    const d = json((await cli(['run', '--preset', 'JET', '--t-end', '0.3', '--fidelity', '1.5D'])).out);
    expect(d.summary.fidelity).toBe('1.5D');
  });
  it('--no-validate runs what the kernel can build, and reports what it cannot', async () => {
    const ok = await cli(['run', ...SHORT, '--set', 'seed=-1', '--no-validate', '--format', 'text']);
    expect(ok.code).toBe(0);
    const bad = await cli(['run', '--preset', 'JET', '--set', 'method=nope', '--no-validate']);
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/^fusion-sim run: the run failed: unknown confinement method 'nope'/);
  });
});

describe('run: outputs', () => {
  it('json: report, flat-top and burn averages, events, config and provenance; deterministic', async () => {
    const a = await cli(['run', ...SHORT]);
    expect(a.code).toBe(0);
    const doc = json(a.out);
    expect(doc).toMatchObject({ schema: 1, tool: 'fusion-sim run', summary: { method: 'tokamak', fidelity: '0D', natural: true, timeUnit: 's' } });
    const ref = new Simulation({ ...PRESETS.find((p) => p.id === 'JET')!.cfg, t_end: 1 } as never);
    const rep = ref.runAll();
    expect(doc.report.Q_sci_max).toBe(rep.Q_sci_max);
    expect(doc.report.termination.reason).toBe(rep.termination.reason);
    expect(doc.flatTop.Q).toBeGreaterThan(0);
    expect(doc.events.ELM).toBeGreaterThan(0);
    expect(doc.series).toBeUndefined();
    expect((await cli(['run', ...SHORT])).out).toBe(a.out);
  });
  it('json provenance: version, concept DOI, git, runtime, config hash and run fingerprint; nothing personal', async () => {
    const r = await cli(['run', ...SHORT]);
    const p = json(r.out).provenance;
    const cfg = json(r.out).config;
    expect(p).toMatchObject({ generator: 'fusion-sim', version: VERSION, conceptDoi: '10.5281/zenodo.22259861', preset: 'JET', seed: 7 });
    expect(p.configSha256).toBe(sha256Hex(canonicalString(cfg)));
    expect(p.fingerprint).toBe(runFingerprint(cfg, 7, [], VERSION));
    expect(p.runtime.node).toBe(process.version);
    expect(p.git === null || /^[0-9a-f]{40}$/.test(p.git.sha)).toBe(true);
    expect(Object.keys(p).sort()).toEqual(['conceptDoi', 'configSha256', 'fingerprint', 'generator', 'git', 'preset', 'runtime', 'seed', 'version']);
    expect(r.out).not.toMatch(/@|Users|\\\\|home\//);
    expect(json((await cli(['run', ...SHORT], { root: undefined })).out).provenance).toMatchObject({ version: '0.0.0', git: null });
  });
  it('json: --series adds time series (`all` for every diagnostic); --every thins them, keeping the last frame', async () => {
    const some = json((await cli(['run', ...SHORT, '--series', 'Q,P_fus'])).out);
    expect(Object.keys(some.series)).toEqual(['t', 'Q', 'P_fus']);
    expect(some.series.t).toHaveLength(501);
    const all = json((await cli(['run', ...SHORT, '--series', 'all'])).out);
    expect(Object.keys(all.series).length).toBeGreaterThan(30);
    const thin = json((await cli(['run', ...SHORT, '--series', 'Q', '--every', '100'])).out);
    expect(thin.series.t).toHaveLength(6);
    expect(thin.series.t[5]).toBe(some.series.t[500]);
    const unknown = json((await cli(['run', ...SHORT, '--series', 'nonexistent'])).out);
    expect(unknown.series.nonexistent.every((v: unknown) => v === null)).toBe(true);
  });
  it('csv: the time traces, equal to the history', async () => {
    const r = await cli(['run', ...SHORT, '--format', 'csv', '--series', 'Q,Ti']);
    const p = parseCsv(r.out);
    expect(p.header).toEqual(['t', 'Q', 'Ti']);
    expect(p.columns.t).toHaveLength(501);
    const ref = new Simulation({ ...PRESETS.find((x) => x.id === 'JET')!.cfg, t_end: 1 } as never);
    ref.runAll();
    expect(p.columns.Q).toEqual(ref.history.map((f) => f.d.Q));
    const thin = parseCsv((await cli(['run', ...SHORT, '--format', 'csv', '--every', '50', '--series', 'Q'])).out);
    expect(thin.columns.t).toEqual(ref.history.filter((_, i) => i % 50 === 0).map((f) => f.t));
  });
  it('ndjson: meta, frames, events, report; profiles on request', async () => {
    const r = await cli(['run', ...SHORT, '--format', 'ndjson']);
    const recs = parseNdjson(r.out) as any[];
    expect(recs[0]).toMatchObject({ type: 'meta', method: 'tokamak' });
    expect(recs[0].provenance.version).toBe(VERSION);
    expect(recs[recs.length - 1].type).toBe('report');
    expect(recs.filter((x) => x.type === 'frame')).toHaveLength(501);
    const p15 = ['run', '--preset', 'SPARC15', '--t-end', '0.4', '--set', 'profiles.nRho=20', '--set', 'profiles.eqNR=25', '--format', 'ndjson'];
    const without = (parseNdjson((await cli(p15)).out) as any[]).filter((x) => x.type === 'frame');
    expect(without[0].prof).toBeUndefined();
    const withP = (parseNdjson((await cli([...p15, '--profiles'])).out) as any[]).filter((x) => x.type === 'frame');
    expect(withP[5].prof.Te).toHaveLength(20);
  });
  it('netcdf: a CF file with the run attributes; the format follows the .nc extension; a terminal is refused', async () => {
    const r = await cli(['run', ...SHORT, '--out', 'run.nc']);
    expect(r.out).toBe('');
    const f = readNetcdf3(file(r, 'run.nc') as Uint8Array);
    expect(f.attrs.Conventions.value).toBe('CF-1.8');
    expect(f.attrs.simulation_preset.value).toBe('JET');
    expect(f.attrs.simulation_version.value).toBe(VERSION);
    expect(f.dims[0]).toEqual({ name: 'time', size: 501, unlimited: false });
    expect(f.vars.Q).toBeDefined();
    const sel = readNetcdf3(file(await cli(['run', ...SHORT, '--out', 'sel.nc', '--series', 'Q']), 'sel.nc') as Uint8Array);
    expect(Object.keys(sel.vars)).toEqual(['time', 'Q']);
    const tty = await cli(['run', ...SHORT, '--format', 'netcdf'], { tty: true });
    expect(tty.code).toBe(2);
    expect(tty.err).toMatch(/binary format: give --out FILE/);
    const pipe = await cli(['run', ...SHORT, '--format', 'netcdf', '--out', '-']);
    expect(pipe.code).toBe(0);
    expect(readNetcdf3(pipe.bin!).attrs.Conventions.value).toBe('CF-1.8');
  });
  it('netcdf of a 1.5D run has the profiles, unless --no-profiles', async () => {
    const a = ['run', '--preset', 'SPARC15', '--t-end', '0.4', '--set', 'profiles.nRho=20', '--set', 'profiles.eqNR=25', '--format', 'netcdf', '--out', 'p.nc'];
    const withP = readNetcdf3(file(await cli(a), 'p.nc') as Uint8Array);
    expect(withP.dims.find((d) => d.name === 'rho')!.size).toBe(20);
    expect(withP.vars.profile_Te).toBeDefined();
    const no = readNetcdf3(file(await cli([...a, '--no-profiles']), 'p.nc') as Uint8Array);
    expect(no.vars.profile_Te).toBeUndefined();
  });
  it('imas: IMAS-like JSON for a magnetic run; a pulsed run is an input error', async () => {
    const r = await cli(['run', ...SHORT, '--format', 'imas', '--indent', '0']);
    const doc = json(r.out);
    expect(doc.format).toMatchObject({ name: 'imas-like-json', cocos: 11 });
    expect(doc.summary.code.version).toBe(VERSION);
    expect(doc.summary.global_quantities.ip.value).toHaveLength(501);
    const nif = await cli(['run', '--preset', 'NIF', '--format', 'imas']);
    expect(nif.code).toBe(2);
    expect(nif.err).toMatch(/magnetic-confinement runs/);
  });
  it('text: a summary; the format follows a .txt extension; --out - writes to stdout', async () => {
    const r = await cli(['run', ...SHORT, '--format', 'text']);
    expect(r.out).toMatch(/^JET \(tokamak, 0D\)\n {2}ended {8}Scheduled end\n/);
    expect(r.out).toMatch(/Q \(max\/avg\)/);
    expect((await cli(['run', ...SHORT, '--out', 's.txt'])).files.size).toBe(1);
    expect((await cli(['run', ...SHORT, '--format', 'text', '--out', '-'])).out).toMatch(/^JET/);
  });
  it('an early end is described in the text summary and is not an error', async () => {
    const r = await cli(['run', '--preset', 'ITER', '--t-end', '4', '--set', 'geometry.kappa=1', '--format', 'text']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/not a planned end/);
  });
  it('textSummary formats large and small numbers in exponent form and non-finite ones as n/a', async () => {
    const r = await cli(['run', ...SHORT, '--format', 'text']);
    expect(r.out).toMatch(/neutrons {5}\d\.\d{3}e\+\d+/);
  });
});

describe('scan: parameters and metrics', () => {
  it('a range is inclusive and free of rounding noise; a list keeps JSON types; a single value is one point', () => {
    expect(parseParam('a.b=10:50:10').values).toEqual([10, 20, 30, 40, 50]);
    expect(parseParam('x=0:1:0.1').values).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(parseParam('x=5:1:-2').values).toEqual([5, 3, 1]);
    expect(parseParam('x=1e20:3e20:1e20').values).toEqual([1e20, 2e20, 3e20]);
    expect(parseParam('fuel=DT,DD').values).toEqual(['DT', 'DD']);
    expect(parseParam('a=1,2.5,true,"x"').values).toEqual([1, 2.5, true, 'x']);
    expect(parseParam('a=7').values).toEqual([7]);
    expect(parseParam('fidelity=1.5D').values).toEqual(['1.5D']);
  });
  it('rejects malformed parameters', () => {
    for (const bad of ['nothing', 'a=', 'a=1,,2', '=1:2:1', 'a..b=1', 'a=1:5:0', 'a=1:5:-1', 'a=5:1:1', '__proto__.x=1', 'a=0:1:1e-9']) {
      expect(() => parseParam(bad), bad).toThrow(CliUsageError);
    }
  });
  it('the grid is row-major, the first parameter varies slowest', () => {
    expect(gridPoints([{ path: 'a', values: [1, 2] }, { path: 'b', values: ['x', 'y', 'z'] }])).toEqual([[1, 'x'], [1, 'y'], [1, 'z'], [2, 'x'], [2, 'y'], [2, 'z']]);
    expect(gridPoints([])).toEqual([[]]);
  });
  it('metric paths: scope and key, derived names checked', () => {
    for (const ok of [...DEFAULT_METRICS, 'engineering.LCOE', 'burn.Ti', 'derived.H98y2', 'derived.alphaShare']) expect(checkMetric(ok)).toBe(ok);
    for (const bad of ['Q', 'flatTop', 'flatTop.', 'nope.Q', 'derived.H99']) expect(() => checkMetric(bad), bad).toThrow(CliUsageError);
  });
  it('takeRepeated takes --name value and --name=value out of argv', () => {
    expect(takeRepeated(['a', '--set', 'x=1', '--flag', '--set=y=2,3', 'b'], ['set'])).toEqual({ rest: ['a', '--flag', 'b'], values: { set: ['x=1', 'y=2,3'] } });
    expect(() => takeRepeated(['--set'], ['set'])).toThrow(/missing value for --set/);
    expect(() => takeRepeated(['--set', '--other'], ['set'])).toThrow(/missing value/);
  });
});

describe('scan: the table', () => {
  const base = ['scan', '--preset', 'JET', '--t-end', '0.5'];
  it('csv: one row per grid point, the parameters first, then status, end reason and the metrics', async () => {
    const r = await cli([...base, '--param', 'heating.P_NBI_MW=10:30:10', '--param', 'fuel=DT,DD', '--metric', 'flatTop.Q,report.Q_sci_max']);
    expect(r.code).toBe(0);
    const p = parseCsv(r.out);
    expect(p.header).toEqual(['heating.P_NBI_MW', 'fuel', 'status', 'end_reason', 'flatTop.Q', 'report.Q_sci_max']);
    expect(p.columns['heating.P_NBI_MW']).toEqual([10, 10, 20, 20, 30, 30]);
    expect(p.text.fuel).toEqual(['DT', 'DD', 'DT', 'DD', 'DT', 'DD']);
    expect(p.text.status.every((s) => s === 'ok')).toBe(true);
    expect(p.text.end_reason[0]).toBe('Scheduled end');
    // a point equals a run of that configuration
    const ref = new Simulation(applyAssignments(getPreset('JET')!.cfg, ['t_end=0.5', 'heating.P_NBI_MW=20']));
    expect(p.columns['report.Q_sci_max'][2]).toBe(ref.runAll().Q_sci_max);
  });
  it('the default metrics', async () => {
    const r = await cli([...base, '--param', 'H98=0.8,1.0']);
    expect(parseCsv(r.out).header).toEqual(['H98', 'status', 'end_reason', ...DEFAULT_METRICS]);
  });
  it('json: base, parameters, metrics and points with fingerprints; ndjson: one point per line', async () => {
    const j = json((await cli([...base, '--param', 'seed=1,2', '--format', 'json', '--metric', 'report.Q_sci_max'])).out);
    expect(j).toMatchObject({ schema: 1, tool: 'fusion-sim scan', base: { preset: 'JET' }, params: [{ path: 'seed', values: [1, 2] }], metrics: ['report.Q_sci_max'] });
    expect(j.points).toHaveLength(2);
    expect(j.points[1]).toMatchObject({ index: 1, params: { seed: 2 }, status: 'ok' });
    expect(j.points[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(j.points[0].fingerprint).not.toBe(j.points[1].fingerprint);
    const lines = parseNdjson((await cli([...base, '--param', 'seed=1,2', '--format', 'ndjson'])).out) as any[];
    expect(lines.map((x) => x.index)).toEqual([0, 1]);
  });
  it('--series keeps the time series of a diagnostic per point (the keepSeries hook of the worker)', async () => {
    const j = json((await cli([...base, '--param', 'seed=1', '--format', 'json', '--series', 'Q'])).out);
    expect(j.points[0].series.t).toHaveLength(253);
    expect(j.points[0].series.Q).toHaveLength(253);
  });
  it('the format follows the --out extension; the file gets the output', async () => {
    const r = await cli([...base, '--param', 'seed=1', '--out', 'scan.json']);
    expect(r.out).toBe('');
    expect(json(file(r, 'scan.json') as string).tool).toBe('fusion-sim scan');
  });
  it('a point that ended early is `ended`, a point that crashed is `error` (exit 1, message on stderr)', async () => {
    const early = await cli(['scan', '--preset', 'ITER', '--t-end', '4', '--param', 'geometry.kappa=1,1.7', '--metric', 'report.Tmax_keV']);
    expect(early.code).toBe(0);
    expect(parseCsv(early.out).text.status).toEqual(['ended', 'ok']);
    const flaky: Executor = async (tasks, o) => [(await inProcessExecutor([tasks[0]], o))[0], { id: tasks[1].id, ok: false, error: 'worker exploded\nstack' }];
    const crash = await cli([...base, '--param', 'seed=1,2'], { deps: { execute: flaky } });
    expect(crash.code).toBe(1);
    expect(crash.err).toMatch(/1 of 2 points failed: #1 worker exploded/);
    const rows = parseCsv(crash.out);
    expect(rows.text.status).toEqual(['ok', 'error']);
    expect(rows.text.end_reason[1]).toBe('worker exploded');
    expect(rows.columns['report.Q_sci_max'][1]).toBeNaN();
  });
  it('a metric the run does not have is NaN (an empty CSV field)', async () => {
    const r = await cli([...base, '--param', 'seed=1', '--metric', 'flatTop.doesNotExist,engineering.nothing,derived.Ttot']);
    expect(parseCsv(r.out).columns['flatTop.doesNotExist'][0]).toBeNaN();
  });
});

describe('scan: input errors are found before anything runs', () => {
  const base = ['scan', '--preset', 'JET', '--t-end', '0.5'];
  it('needs a parameter, and refuses a repeated one, a bad metric and a grid that is too large', async () => {
    expect((await cli(base)).err).toMatch(/give at least one --param/);
    expect((await cli([...base, '--param', 'seed=1', '--param', 'seed=2'])).err).toMatch(/--param seed is given twice/);
    expect((await cli([...base, '--param', 'seed=1', '--metric', 'Q'])).err).toMatch(/--metric 'Q': a metric is SCOPE\.KEY/);
    const big = await cli([...base, '--param', 'seed=1:100:1', '--max-points', '50']);
    expect(big.code).toBe(2);
    expect(big.err).toMatch(/the grid has 100 points, more than --max-points 50/);
  });
  it('invalid points are listed with the point, the value and the path of the problem', async () => {
    const r = await cli([...base, '--param', 'heating.P_NBI_MW=10,-5', '--param', 'fuel=DT,XX']);
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
    expect(r.err).toMatch(/the scan has invalid points:/);
    expect(r.err).toMatch(/point 1 \(heating\.P_NBI_MW=10, fuel=XX\):\n {4}fuel: must be one of/);
    expect(r.err).toMatch(/point 3 \(heating\.P_NBI_MW=-5, fuel=XX\):\n {4}fuel: .*\n {4}heating\.P_NBI_MW: must be >= 0/);
  });
  it('an unknown parameter path is an unknown property', async () => {
    const r = await cli([...base, '--param', 'heating.P_NBI_mw=1,2']);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/heating\.P_NBI_mw: is not a known property \(did you mean 'P_NBI_MW'\?\)/);
  });
  it('very many invalid points are listed in part', async () => {
    const r = await cli([...base, '--param', 'B0=-1:-40:-1']);
    expect(r.err.split('\n').filter((l) => l.startsWith('point ')).length).toBe(20);
    expect(r.err).toMatch(/\n\.\.\.$/m);
  });
});

describe('export-eqdsk', () => {
  it('says plainly that it is not available while the GEQDSK writer is not merged (exit 1)', async () => {
    const r = await cli(['export-eqdsk', '--preset', 'ITER15', '--out', 'x.eqdsk']);
    expect(r.code).toBe(1);
    expect(r.err).toBe(`fusion-sim export-eqdsk: ${EQDSK_UNAVAILABLE}\n`);
    expect(r.err).toMatch(/src\/io\/geqdsk\.ts, workstream WS4/);
  });
  it('with a writer: runs the 1.5D shot and writes what the writer returns', async () => {
    let seen: { t: number; time: number | undefined } | undefined;
    const deps: CliDeps = { writeEqdsk: (sim, o) => { seen = { t: sim.t, time: o.time }; return 'EQDSK\n'; } };
    const r = await cli(['export-eqdsk', '--preset', 'SPARC15', '--t-end', '0.3', '--set', 'profiles.nRho=20', '--set', 'profiles.eqNR=25', '--time', '0.2', '--out', 'x.eqdsk'], { deps });
    expect(r.code).toBe(0);
    expect(file(r, 'x.eqdsk')).toBe('EQDSK\n');
    expect(seen).toEqual({ t: 0.3, time: 0.2 });
    const std = await cli(['export-eqdsk', '--preset', 'SPARC15', '--t-end', '0.3', '--set', 'profiles.nRho=20', '--out', '-'], { deps });
    expect(std.out).toBe('EQDSK\n');
  });
  it('needs a 1.5D tokamak: a 0D run and a stellarator are input errors', async () => {
    const deps: CliDeps = { writeEqdsk: () => 'x' };
    const a = await cli(['export-eqdsk', '--preset', 'JET', '--out', 'x'], { deps });
    expect(a.code).toBe(2);
    expect(a.err).toMatch(/needs a 1\.5D tokamak or spherical tokamak run \(fidelity "1\.5D"; got method 'tokamak', fidelity '0D'\)/);
    expect((await cli(['export-eqdsk', '--preset', 'W7X', '--fidelity', '1.5D', '--out', 'x'], { deps })).code).toBe(2);
  });
  it('--out is required', async () => {
    const r = await cli(['export-eqdsk', '--preset', 'ITER15']);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--out is required/);
  });
});

describe('failures that are not the input of the user', () => {
  it('a run that dies with a kernel error is a failure (exit 1), not a crash of the CLI', async () => {
    const r = await cli(['run', '--preset', 'JET', '--set', 'method=nope', '--no-validate']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/the run failed: unknown confinement method/);
  });
  it('an unexpected error is reported as an internal error with its stack, exit 1', async () => {
    const r = await cli(['run', '--preset', 'JET', '--set', 'geometry=null', '--no-validate']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^fusion-sim run: internal error: TypeError/);
    const s = await cli(['scan', '--preset', 'JET', '--param', 'seed=1'], { deps: { execute: async () => { throw new Error('boom'); } } });
    expect(s.code).toBe(1);
    expect(s.err).toMatch(/fusion-sim scan: internal error: Error: boom/);
  });
  it('export-eqdsk: a kernel error in the run or the writer is a failure, anything else an internal error', async () => {
    const args = ['export-eqdsk', '--preset', 'SPARC15', '--t-end', '0.2', '--set', 'profiles.nRho=20', '--out', 'x'];
    const sim = await cli(args, { deps: { writeEqdsk: () => { throw new NonFiniteStateError(1, 2, 3, NaN); } } });
    expect(sim.code).toBe(1);
    expect(sim.err).toMatch(/the run failed: integrator produced a non-finite state/);
    const other = await cli(args, { deps: { writeEqdsk: () => { throw new RangeError('bad frame'); } } });
    expect(other.code).toBe(1);
    expect(other.err).toMatch(/internal error: RangeError: bad frame/);
  });
  it('scan: an interrupted pool exits 130, an invalid pool configuration is a usage error', async () => {
    const abort = await cli(['scan', '--preset', 'JET', '--param', 'seed=1'], { deps: { execute: async () => { throw new PoolAbortError('worker pool: interrupted by SIGINT after 0 of 1 tasks; workers terminated', 'SIGINT', 0); } } });
    expect(abort.code).toBe(130);
    expect(abort.err).toMatch(/interrupted by SIGINT/);
    const cfg = await cli(['scan', '--preset', 'JET', '--param', 'seed=1'], { deps: { execute: async () => { throw new PoolConfigError('threads must be a finite integer >= 1, got 0'); } } });
    expect(cfg.code).toBe(2);
    expect(cfg.err).toMatch(/threads must be a finite integer/);
  });
  it('scan: progress goes to stderr on a terminal only; --threads and --timeout reach the executor', async () => {
    let seen: { threads: number; timeoutMs: number | undefined } | undefined;
    const exec: Executor = async (tasks, o) => {
      seen = { threads: o.threads, timeoutMs: o.timeoutMs };
      o.onProgress?.({ done: 1, total: 2, failed: 0, index: 0, id: 'p0', ok: true, ms: 1, respawns: 0 });
      o.onProgress?.({ done: 2, total: 2, failed: 0, index: 1, id: 'p1', ok: true, ms: 1, respawns: 0 });
      return inProcessExecutor(tasks, o);
    };
    const tty = await cli(['scan', '--preset', 'JET', '--t-end', '0.2', '--param', 'seed=1,2', '--threads', '3', '--timeout', '9'], { stderrTty: true, deps: { execute: exec } });
    expect(tty.code).toBe(0);
    expect(tty.err).toMatch(/scan: 1\/2 points/);
    expect(tty.err).toMatch(/scan: 2\/2 points/);
    expect(seen).toEqual({ threads: 3, timeoutMs: 9000 });
    const quiet = await cli(['scan', '--preset', 'JET', '--t-end', '0.2', '--param', 'seed=1'], { deps: { execute: exec } });
    expect(quiet.err).toBe('');
  });
  it('scan: a point whose run throws is an error row, the others are unaffected', async () => {
    const r = await cli(['scan', '--preset', 'JET', '--t-end', '0.2', '--no-validate', '--param', 'method=tokamak,nope', '--metric', 'report.Q_sci_max']);
    expect(r.code).toBe(1);
    const t = parseCsv(r.out);
    expect(t.text.status).toEqual(['ok', 'error']);
    expect(t.text.end_reason[1]).toMatch(/unknown confinement method 'nope'/);
    expect(r.err).toMatch(/1 of 2 points failed/);
  });
  it('the in-process executor keeps the series a task asks for', async () => {
    const cfg = applyAssignments(getPreset('JET')!.cfg, ['t_end=0.2']);
    const res = await inProcessExecutor([{ id: 'a', cfg, keepSeries: ['Q'] }], { threads: 1 });
    expect(res[0].series!.Q.length).toBe(res[0].series!.t.length);
    expect(res[0].series!.t.length).toBeGreaterThan(50);
  });
});

describe('remaining paths', () => {
  it('main() without an environment uses the process streams and finds its own package', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(await main(['--version'])).toBe(0);
      expect(out).toHaveBeenCalledWith(`${VERSION}\n`);
    } finally {
      out.mockRestore();
    }
  });
  it('a thrown value that is not an Error is still reported', async () => {
    const r = await cli(['scan', '--preset', 'JET', '--param', 'seed=1'], { deps: { execute: async () => { throw 'plain string'; } } });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/internal error: plain string/);
  });
  it('the text summary writes n/a, plain zero, exponent form for tiny and huge values, and abbreviates a long list of warnings', () => {
    const r = runShot(applyAssignments(getPreset('JET')!.cfg, ['t_end=0.3']));
    const doc = textSummary('X', { ...r, report: { ...r.report, Tmax_keV: NaN, E_input_MJ: 0, Q_eng: 1e-5, neutronYield: 1e9, warnings: ['a', 'b', 'c', 'd', 'e'] }, flatTop: { ...r.flatTop, Q: NaN } });
    expect(doc).toMatch(/T_max {8}n\/a keV/);
    expect(doc).toMatch(/\(in: 0 MJ\)/);
    expect(doc).toMatch(/Q_eng {8}1\.000e-5/);
    expect(doc).toMatch(/neutrons {5}1\.000e\+9/);
    expect(doc).toMatch(/warnings {5}5: a; b; c; \.\.\./);
    expect(doc).not.toMatch(/flat-top/);
    const none = textSummary('X', { ...r, report: { ...r.report, warnings: [] } });
    expect(none).not.toMatch(/warnings/);
    expect(textSummary('X', { ...r, report: { ...r.report, warnings: ['a', 'b', 'c'] } })).toMatch(/warnings {5}3: a; b; c\n/);
  });
  it('a configuration file alone names the text summary after the method, and the json has no preset', async () => {
    const file = JSON.stringify({ ...getPreset('MIRROR')!.cfg, t_end: 0.05 });
    const t = await cli(['run', '--config', 'm.json', '--format', 'text'], { files: { 'm.json': file } });
    expect(t.out).toMatch(/^mirror \(mirror, 0D\)/);
    const s = json((await cli(['scan', '--config', 'm.json', '--param', 'seed=1', '--format', 'json'], { files: { 'm.json': file } })).out);
    expect(s.base.preset).toBeNull();
  });
  it('json --profiles adds the radial profiles of a 1.5D run; ndjson and imas take --every', async () => {
    const a = ['run', '--preset', 'SPARC15', '--t-end', '0.4', '--set', 'profiles.nRho=20', '--set', 'profiles.eqNR=25'];
    const j = json((await cli([...a, '--series', 'Q', '--every', '40', '--profiles'])).out);
    expect(j.profiles.length).toBe(j.series.t.length);
    expect(j.profiles[0].Te).toHaveLength(20);
    const nd = (parseNdjson((await cli([...a, '--format', 'ndjson', '--every', '40'])).out) as any[]).filter((x) => x.type === 'frame');
    expect(nd.length).toBeLessThan(30);
    const im = json((await cli([...a, '--format', 'imas', '--every', '40', '--indent', '0'])).out);
    expect(im.core_profiles.profiles_1d.length).toBeLessThan(30);
  });
  it('schema --check counts one problem in the singular', async () => {
    const r = await cli(['schema', '--check', 'a.json'], { files: { 'a.json': JSON.stringify({ ...getPreset('ITER')!.cfg, B0: -1 }) } });
    expect(r.err).toMatch(/invalid configuration \(1 problem\):/);
  });
  it('a configuration without a seed still gets a provenance block (the seed reads as 0)', async () => {
    const r = await cli(['run', ...SHORT, '--set', 'seed=null', '--no-validate']);
    expect(r.code).toBe(0);
    expect(json(r.out).provenance.seed).toBe(0);
  });
  it('a read error without an error code is reported with its message', async () => {
    const io: CliIo = { stdout: { write() {}, isTTY: false }, stderr: { write() {}, isTTY: false }, readText: () => { throw new Error('disk on fire'); }, writeFile() {} };
    expect(() => parseJsonFile(io, 'x.json')).toThrow(/cannot read x\.json: disk on fire/);
  });
  it('the worker module is the .ts file beside the CLI from source, the compiled .js next to a bundle', () => {
    expect(workerUrl('file:///repo/src/cli/fusionSim/scanCmd.ts').href).toBe('file:///repo/src/cli/presetRunner.worker.ts');
    expect(workerUrl('file:///pkg/build/lib/fusion-sim.js').href).toBe('file:///pkg/build/lib/presetRunner.worker.js');
  });
  it('scan tolerates an executor that returns fewer or thinner results than tasks', async () => {
    const thin: Executor = async (tasks) => [{ id: tasks[0].id, ok: true, report: (await inProcessExecutor([tasks[0]], { threads: 1 }))[0].report }, { id: tasks[1].id, ok: false }];
    const r = await cli(['scan', '--preset', 'JET', '--t-end', '0.2', '--param', 'seed=1,2,3', '--metric', 'flatTop.Q,report.Q_sci_max'], { deps: { execute: thin } });
    expect(r.code).toBe(1);
    const t = parseCsv(r.out);
    expect(t.text.status).toEqual(['ok', 'error', 'error']);
    expect(t.text.end_reason.slice(1)).toEqual(['no result', 'no result']);
    expect(t.columns['flatTop.Q'][0]).toBeNaN();
    expect(t.columns['report.Q_sci_max'][0]).toBeGreaterThan(0);
  });
  it('the in-process executor fills a series key the run does not have with NaN', async () => {
    const cfg = applyAssignments(getPreset('JET')!.cfg, ['t_end=0.2']);
    const res = await inProcessExecutor([{ id: 'a', cfg, keepSeries: ['nonexistent'] }], { threads: 1 });
    expect(res[0].series!.nonexistent.every(Number.isNaN)).toBe(true);
  });
});

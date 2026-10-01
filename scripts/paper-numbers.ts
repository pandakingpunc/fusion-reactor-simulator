/// <reference types="node" />
/**
 * The numbers of paper/paper.md. Every measured number in the paper is wrapped in a marker,
 *
 *     <!--num:ITER15.Q-->10.45<!--/num-->
 *
 * and this script computes it from the source that the key names (NUMBERS below: one entry per key, with a `from` that says where
 * the number comes from) and compares it with the text between the markers:
 *
 *   npx tsx scripts/paper-numbers.ts                 same as --check
 *   npx tsx scripts/paper-numbers.ts --check         exit 1 if a marker is stale, unknown or a number of the body is not marked
 *   npx tsx scripts/paper-numbers.ts --write         rewrite the text between the markers from the sources
 *   npx tsx scripts/paper-numbers.ts --list          print every key with its value, its text and its source
 *   npx tsx scripts/paper-numbers.ts --live          also re-run `validate` (about 4 minutes with 2 threads) and compare it with the record
 *   npx tsx scripts/paper-numbers.ts --record-validate FILE --head SHA --utc ISO
 *                                                    write paper/sources/validate.json from the output of `validate --json`
 *   npx tsx scripts/paper-numbers.ts --record-convergence FILE
 *                                                    write paper/sources/convergence.json from the output of `bench:convergence --out`
 *   options: --file FILE (default paper/paper.md), --root DIR (default: the repository), --threads N (--live, default 2)
 *
 * The sources, in the order of trust:
 *   golden       test/golden/<case>.json, the recorded run of a case (flat-top averages and the shot report)
 *   validate     paper/sources/validate.json, the extract of `npm run -s validate -- --json` (schema 3) recorded at a named commit;
 *                `--live` re-runs validate and fails if it disagrees; a record that disagrees with the reference table
 *                (src/physics/validation/references.ts) or with the golden file of a case that validate runs unshortened is
 *                reported as stale by every check (checkValidateRecord)
 *   convergence  paper/sources/convergence.json, the radial-resolution series of `npm run bench:convergence` (ITER15); its 50-cell run
 *                must equal the golden ITER15 (checkConvergenceRecord)
 *   text         a number that a document of the repository states (docs/figures/captions.md, which `npm run figures:check` holds to
 *                the code, docs/v4-wave2b-report.md section 8, the header of references.ts), read with a regular expression
 *   repo         a count of the repository (presets, golden cases)
 *
 * The check also fails on a number of the body that is not marked (unmarkedNumbers): a figure that no source stands behind cannot be
 * added by accident. Nothing here fits or rounds a number to make a statement true; a number that moves is a change of the model or of
 * its record, and the paper is rewritten by --write after a person has read the change.
 *
 * Exit codes: 0 consistent / done, 1 stale (--check, --live), 2 usage error.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS } from '../src/physics/presets';
import { REFERENCE_CHECKS } from '../src/physics/validation/references';

// ---------------------------------------------------------------------------------------------------------
// records

export interface ValidateRecordCheck {
  id: string;
  preset: string;
  kind: string;
  role?: string;
  status: string;
  wording: string;
  value: number;
  published: number;
  ratio: number;
  deviationPct: number;
  accept: [number, number];
}

export interface ValidateRecord {
  schema: 1;
  what: string;
  command: string;
  recorded: { gitHead: string; utc: string; node: string; threads: number };
  summary: {
    checksExecuted: number;
    failures: number;
    knownFailures: number;
    unexpectedPasses: number;
    passed: boolean;
    wordings: Record<string, number>;
  };
  checks: ValidateRecordCheck[];
}

export interface ConvergenceRun {
  cells: number;
  Q: number;
  f_bs: number;
  li: number;
  Tped: number;
}

export interface ConvergenceRecord {
  schema: 1;
  what: string;
  command: string;
  source: { file: string; sha256: string; date: string; node: string };
  preset: string;
  t_end_s: number;
  nRho: ConvergenceRun[];
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const finite = (x: unknown, what: string): number => {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`${what} is not a finite number`);
  return x;
};

/** The record of a `validate --json` output (schema 3): the fields the paper's numbers and their cross-checks need. */
export function buildValidateRecord(v: Json, prov: { gitHead: string; utc: string; node: string }): ValidateRecord {
  if (v.schema !== 3) throw new Error(`validate --json schema ${String(v.schema)}, expected 3`);
  if (!Array.isArray(v.checks) || v.checks.length === 0) throw new Error('validate --json has no checks');
  const checks = (v.checks as Json[]).map((c): ValidateRecordCheck => {
    const r: ValidateRecordCheck = {
      id: String(c.id), preset: String(c.preset), kind: String(c.kind), status: String(c.status), wording: String(c.wording),
      value: finite(c.value, `${c.id}.value`), published: finite(c.published, `${c.id}.published`), ratio: finite(c.ratio, `${c.id}.ratio`),
      deviationPct: finite(c.deviationPct, `${c.id}.deviationPct`),
      accept: [finite(c.expected?.lo, `${c.id}.expected.lo`), finite(c.expected?.hi, `${c.id}.expected.hi`)],
    };
    if (typeof c.role === 'string') r.role = c.role;
    return r;
  });
  return {
    schema: 1,
    what: 'Extract of the output of `npm run -s validate -- --json` (validate schema 3): one entry per check of src/physics/validation/references.ts. ' +
      'Written by scripts/paper-numbers.ts --record-validate; paper/paper.md takes its validation counts and ratios from it.',
    command: `npm run -s validate -- --json --threads ${finite(v.threads, 'threads')}`,
    recorded: { gitHead: prov.gitHead, utc: prov.utc, node: prov.node, threads: v.threads },
    summary: {
      checksExecuted: finite(v.checksExecuted, 'checksExecuted'), failures: finite(v.failures, 'failures'),
      knownFailures: finite(v.knownFailures, 'knownFailures'), unexpectedPasses: finite(v.unexpectedPasses, 'unexpectedPasses'),
      passed: v.passed === true, wordings: { ...(v.wordings as Record<string, number>) },
    },
    checks,
  };
}

/** The radial-resolution series of a `bench:convergence --out` file. */
export function buildConvergenceRecord(b: Json, source: { file: string; sha256: string }): ConvergenceRecord {
  const series = (b.series as Json[] | undefined)?.find((s) => s.parameter === 'nRho');
  if (!series) throw new Error('the convergence file has no nRho series');
  const nRho = (series.runs as Json[]).map((r): ConvergenceRun => ({
    cells: finite(r.value, 'cells'), Q: finite(r.metrics?.Q, 'Q'), f_bs: finite(r.metrics?.f_bs, 'f_bs'),
    li: finite(r.metrics?.li, 'li'), Tped: finite(r.metrics?.Tped, 'Tped'),
  }));
  return {
    schema: 1,
    what: 'The radial-resolution series (25, 50 and 100 cells) of `npm run bench:convergence` for ITER15: flat-top Q, f_bs, l_i(3) and T_ped (keV). ' +
      'Written by scripts/paper-numbers.ts --record-convergence; its 50-cell run equals the golden ITER15.',
    command: 'npm run bench:convergence -- --out FILE',
    source: { file: source.file, sha256: source.sha256, date: String(b.date), node: String(b.node) },
    preset: String(b.preset), t_end_s: finite(b.t_end_s, 't_end_s'), nRho,
  };
}

// ---------------------------------------------------------------------------------------------------------
// sources

/** What the numbers are read from. `fileSources` reads the repository; a test can pass its own. */
export interface Sources {
  golden(id: string): Json;
  goldenIds(): string[];
  presetCount(): number;
  validate(): ValidateRecord;
  convergence(): ConvergenceRecord;
  /** a document of the repository, line endings as LF */
  text(rel: string): string;
}

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const VALIDATE_RECORD = 'paper/sources/validate.json';
export const CONVERGENCE_RECORD = 'paper/sources/convergence.json';

export function fileSources(root: string = ROOT): Sources {
  const cache = new Map<string, unknown>();
  const memo = <T>(k: string, f: () => T): T => {
    if (!cache.has(k)) cache.set(k, f());
    return cache.get(k) as T;
  };
  const json = (rel: string): Json => memo(rel, () => JSON.parse(readFileSync(join(root, rel), 'utf8')) as Json);
  return {
    golden: (id) => json(`test/golden/${id}.json`),
    goldenIds: () => readdirSync(join(root, 'test', 'golden')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort(),
    presetCount: () => PRESETS.length,
    validate: () => json(VALIDATE_RECORD) as unknown as ValidateRecord,
    convergence: () => json(CONVERGENCE_RECORD) as unknown as ConvergenceRecord,
    text: (rel) => memo(`text:${rel}`, () => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n')),
  };
}

// ---------------------------------------------------------------------------------------------------------
// the numbers

export interface Spec {
  /** where the number comes from, in words (printed by --list, kept short) */
  from: string;
  get(s: Sources): number;
  fmt(v: number): string;
}

const fixed = (n: number) => (v: number) => v.toFixed(n);

function path(o: Json, p: string): number {
  let cur: unknown = o;
  for (const k of p.split('.')) cur = (cur as Json | undefined)?.[k];
  return finite(cur, p);
}

const golden = (id: string, p: string, fmt: Spec['fmt']): Spec => ({ from: `golden ${id} ${p}`, get: (s) => path(s.golden(id), p), fmt });

function check(rec: ValidateRecord, id: string): ValidateRecordCheck {
  const c = rec.checks.find((x) => x.id === id);
  if (!c) throw new Error(`validate record has no check ${id}`);
  return c;
}
const val = (id: string, field: 'ratio' | 'deviationPct' | 'published', fmt: Spec['fmt']): Spec => ({
  from: `validate ${id} ${field}`, get: (s) => check(s.validate(), id)[field], fmt,
});
const refc = (id: string, field: 'value' | 'uncertainty', fmt: Spec['fmt']): Spec => ({
  from: `references.ts ${id} ${field}`,
  get: () => {
    const c = REFERENCE_CHECKS.find((x) => x.id === id);
    if (!c) throw new Error(`references.ts has no check ${id}`);
    return finite(c[field], `${id}.${field}`);
  },
  fmt,
});
const summary = (f: (r: ValidateRecord) => number, from: string): Spec => ({ from: `validate ${from}`, get: (s) => f(s.validate()), fmt: fixed(0) });
const text = (file: string, re: RegExp, fmt: Spec['fmt']): Spec => ({
  from: `${file} /${re.source}/`,
  get: (s) => {
    const m = re.exec(s.text(file));
    if (!m) throw new Error(`${file}: no match for /${re.source}/`);
    return finite(Number(m[1].replace(/\.$/, '')), `${file} /${re.source}/`); // a sentence's full stop after the number is not part of it
  },
  fmt,
});

const CAPTIONS = 'docs/figures/captions.md';
const WAVE2B = 'docs/v4-wave2b-report.md';
const REFS = 'src/physics/validation/references.ts';

/** the radial resolutions of the convergence record, coarse to fine: the second is the model's grid, the third the refinement */
const cellCounts = (s: Sources): number[] => s.convergence().nRho.map((r) => r.cells).sort((a, b) => a - b);

/** abs(100 (x(fine) / x(base) - 1)) of a convergence metric, base = the second and fine = the third resolution of the record */
const convChange = (m: 'Q' | 'Tped'): Spec => ({
  from: `convergence ITER15 ${m}, base to fine grid`,
  get: (s) => {
    const [, base, fine] = cellCounts(s);
    const run = (n: number) => {
      const r = s.convergence().nRho.find((x) => x.cells === n);
      if (!r) throw new Error(`convergence record has no ${n}-cell run`);
      return r[m];
    };
    return Math.abs(100 * (run(fine) / run(base) - 1));
  },
  fmt: fixed(2),
});

export const NUMBERS: Readonly<Record<string, Spec>> = {
  'PRESETS.count': { from: 'repo: the presets of src/physics/presets.ts', get: (s) => s.presetCount(), fmt: fixed(0) },
  'GOLDEN.count': { from: 'repo: the files of test/golden', get: (s) => s.goldenIds().length, fmt: fixed(0) },
  'ITER15.Q': golden('ITER15', 'flatTop.Q', fixed(2)),
  'ITER15.Pfus': golden('ITER15', 'flatTop.P_fus', fixed(0)),
  'ITER15.Q.ref': val('ITER15.Q', 'published', fixed(0)),
  'ITER15.Pfus.ref': val('ITER15.Pfus', 'published', fixed(0)),
  'JET15.Efus': golden('JET15', 'scalars.E_fusion_MJ', fixed(1)),
  'JET15.Efus.ref': refc('JET15.Efus', 'value', fixed(0)),
  'JET15.Efus.unc': refc('JET15.Efus', 'uncertainty', fixed(0)),
  'JET15.Efus.dev': val('JET15.Efus', 'deviationPct', fixed(0)),
  'VAL.checks': summary((r) => r.summary.checksExecuted, 'checksExecuted'),
  'VAL.inrange': summary((r) => r.checks.filter((c) => c.status === 'pass').length, 'checks with status pass'),
  'VAL.known': summary((r) => r.summary.knownFailures, 'knownFailures'),
  'VAL.validated': summary((r) => r.summary.wordings.validated, 'wordings.validated'),
  'VAL.benchmarked': summary((r) => r.summary.wordings.benchmarked, 'wordings.benchmarked'),
  'VAL.calibrated': summary((r) => r.summary.wordings.calibrated, 'wordings.calibrated'),
  'VAL.sanity': summary((r) => r.summary.wordings['sanity bound'], 'wordings.sanity bound'),
  'VAL.threshold': text(REFS, /more than ([0-9]+) % from the published/, fixed(0)),
  'NIF.N221204.ratio': val('NIF.G', 'ratio', fixed(2)),
  'NIF.N230729.ratio': val('NIF.G_N230729', 'ratio', fixed(2)),
  'VER.GS': text(CAPTIONS, /observed order ([0-9.]+) \(expected 2\)/, fixed(2)),
  'VER.FV': text(CAPTIONS, /steady diffusion with uniform source in a cylinder: order ([0-9.]+)/, fixed(2)),
  'VER.BE': text(CAPTIONS, /self-convergence\): order ([0-9.]+) \(expected 1\)/, fixed(2)),
  'CONV.cells.base': { from: 'convergence: the second radial resolution (the model grid)', get: (s) => cellCounts(s)[1], fmt: fixed(0) },
  'CONV.cells.fine': { from: 'convergence: the third radial resolution', get: (s) => cellCounts(s)[2], fmt: fixed(0) },
  'CONV.Q': convChange('Q'),
  'CONV.Tped': convChange('Tped'),
  'CONV.target': text(WAVE2B, /change < ([0-9]+) % between 50 and 100 cells/, fixed(0)),
  'EPED.p': text(WAVE2B, /density of the shot \(\*\*\+([0-9.]+) %\*\*\), T_p/, fixed(1)),
  'EPED.T': text(WAVE2B, /T_p [0-9.]+ against [0-9.]+ keV \(\*\*\+([0-9.]+) %\*\*\)/, fixed(1)),
  'EPED.target': text(WAVE2B, /pedestal within ([0-9]+) % of the published EPED prediction/, fixed(0)),
  'H98.lo': text(WAVE2B, /predictive closures\*\* in ([0-9.]+) to [0-9.]+/, fixed(1)),
  'H98.hi': text(WAVE2B, /predictive closures\*\* in [0-9.]+ to ([0-9.]+)/, fixed(1)),
  'H98.jet15': text(WAVE2B, /JET15 \(5\.5 s\) \*\*([0-9.]+)\*\*/, fixed(2)),
  'H98.min': text(WAVE2B, /ifspppl: ITER15 \*\*([0-9.]+)\*\*/, fixed(2)),
  'H98.max': text(WAVE2B, /bgb: ITER15 \(60 s\) H98\(y,2\) \*\*([0-9.]+)\*\*/, fixed(2)),
  'JET.thermal': text(WAVE2B, /thermal fraction \*\*([0-9.]+) %\*\*/, fixed(1)),
  'JET.trend': text(WAVE2B, /trend of about ([0-9]+) % thermal/, fixed(0)),
  'NG.band': text(WAVE2B, /stochastic band within about ([0-9]+) % of n_G/, fixed(0)),
};

// ---------------------------------------------------------------------------------------------------------
// markers

export interface Marker { key: string; shown: string; start: number; end: number }

const MARKER = /<!--num:([A-Za-z0-9_.-]+)-->([^<]*)<!--\/num-->/g;

export function findMarkers(md: string): Marker[] {
  return [...md.matchAll(MARKER)].map((m) => ({ key: m[1], shown: m[2], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
}

/** The text of the paper after its YAML front matter (the whole text when there is none). */
export function splitFrontMatter(md: string): { front: string; body: string } {
  const m = /^---\n[\s\S]*?\n---\n/.exec(md);
  return m ? { front: m[0], body: md.slice(m[0].length) } : { front: '', body: md };
}

export interface Computed { value: number; text: string }

export function compute(key: string, src: Sources): Computed {
  const spec = NUMBERS[key];
  if (!spec) throw new Error(`unknown key ${key}`);
  const value = spec.get(src);
  return { value, text: spec.fmt(value) };
}

/** Numbers of the body that carry no marker: digits outside markers, comments, code, citations and links, and outside two structural patterns. */
export function unmarkedNumbers(md: string): { token: string; line: number; context: string }[] {
  const { front, body } = splitFrontMatter(md);
  const firstLine = front.split('\n').length - 1;
  // blank out everything that is not prose, keeping the offsets (and so the line numbers)
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  let t = body;
  for (const re of [/<!--[\s\S]*?-->/g, /```[\s\S]*?```/g, /`[^`\n]*`/g, /\[@[^\]]*\]/g, /\]\([^)]*\)/g, /<https?:[^>]*>/g, /https?:\/\/\S+/g,
    // structural: the name of a formula, the version names of the AI tools (named by the commit trailers)
    /\(y,2\)/g, /\b(?:Opus|Sonnet) 5\.5\b/g, /\bGPT-6(?:\.1)?\b/g]) {
    t = t.replace(re, blank);
  }
  const out: { token: string; line: number; context: string }[] = [];
  const lines = t.split('\n');
  const orig = body.split('\n');
  lines.forEach((ln, i) => {
    for (const m of ln.matchAll(/(?<![A-Za-z0-9_.#/])\d+(?:[.,]\d+)*[A-Za-z]*/g)) {
      if (/[A-Za-z]$/.test(m[0])) continue; // 0D, 1.5D, 2D: dimensions, and names such as N210808 are caught by the look-behind
      const at = m.index ?? 0;
      out.push({ token: m[0], line: firstLine + i + 1, context: orig[i].slice(Math.max(0, at - 25), at + m[0].length + 25).trim() });
    }
  });
  return out;
}

export function checkText(md: string, src: Sources, specs: Readonly<Record<string, Spec>> = NUMBERS): string[] {
  const errors: string[] = [];
  const lineOf = (pos: number) => md.slice(0, pos).split('\n').length;
  for (const m of findMarkers(md)) {
    if (!(m.key in specs)) { errors.push(`line ${lineOf(m.start)}: unknown number key '${m.key}'`); continue; }
    let c: Computed;
    try { c = compute(m.key, src); } catch (e) { errors.push(`line ${lineOf(m.start)}: ${m.key}: ${(e as Error).message}`); continue; }
    if (c.text !== m.shown) errors.push(`line ${lineOf(m.start)}: ${m.key} is '${m.shown}' in the paper, the source gives '${c.text}' (${specs[m.key].from})`);
  }
  for (const u of unmarkedNumbers(md)) errors.push(`line ${u.line}: unmarked number '${u.token}' (…${u.context}…): mark it with a key of scripts/paper-numbers.ts or remove it`);
  return errors;
}

export function writeText(md: string, src: Sources): string {
  let out = '';
  let at = 0;
  for (const m of findMarkers(md)) {
    out += md.slice(at, m.start) + `<!--num:${m.key}-->${compute(m.key, src).text}<!--/num-->`;
    at = m.end;
  }
  return out + md.slice(at);
}

// ---------------------------------------------------------------------------------------------------------
// the records against what they must agree with

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);

/** golden key of a validate metric path, for the paths that read a golden value directly */
function goldenKey(p: string): ['flatTop' | 'scalars', string] | null {
  if (p.startsWith('flatTop.')) return ['flatTop', p.slice(8)];
  if (p.startsWith('report.')) return ['scalars', p.slice(7)];
  return null;
}

/**
 * The validate record against the reference table (same ids, published values, ranges, kinds and roles), against its own
 * arithmetic and counts, and against the golden files: a check on a flat-top or shot-report value of a preset whose golden case
 * runs the whole preset (not shortened) must carry the golden value.
 */
export function checkValidateRecord(rec: ValidateRecord, src: Sources): string[] {
  const errs: string[] = [];
  const ids = rec.checks.map((c) => c.id);
  const tableIds = REFERENCE_CHECKS.map((c) => c.id);
  for (const id of tableIds) if (!ids.includes(id)) errs.push(`validate record lacks the check ${id} of references.ts: record it again`);
  for (const id of ids) if (!tableIds.includes(id)) errs.push(`validate record has the check ${id} that references.ts no longer has: record it again`);
  if (rec.summary.checksExecuted !== rec.checks.length) errs.push('validate record: summary.checksExecuted is not the number of checks');
  const goldenIds = new Set(src.goldenIds());
  for (const c of rec.checks) {
    const ref = REFERENCE_CHECKS.find((x) => x.id === c.id);
    if (!ref) continue;
    if (rel(c.published, ref.value) > 1e-12) errs.push(`${c.id}: published ${c.published} in the record, ${ref.value} in references.ts`);
    if (rel(c.accept[0], ref.accept[0]) > 1e-12 || rel(c.accept[1], ref.accept[1]) > 1e-12) errs.push(`${c.id}: accepted range differs from references.ts`);
    if (c.kind !== ref.kind) errs.push(`${c.id}: kind ${c.kind} in the record, ${ref.kind} in references.ts`);
    if ((c.role ?? '') !== (ref.role ?? '')) errs.push(`${c.id}: role differs from references.ts`);
    if (rel(c.ratio, c.value / c.published) > 1e-9) errs.push(`${c.id}: ratio is not value / published`);
    if (Math.abs(c.deviationPct - 100 * (c.ratio - 1)) > 1e-7 * Math.max(1, Math.abs(c.deviationPct))) errs.push(`${c.id}: deviationPct is not 100 (ratio - 1)`);
    const gk = goldenKey(ref.path);
    if (gk && goldenIds.has(c.preset)) {
      const g = src.golden(c.preset);
      const gv = g.meta?.tEndShortened === false ? g[gk[0]]?.[gk[1]] : undefined;
      if (typeof gv === 'number' && rel(gv, c.value) > 1e-6) {
        errs.push(`${c.id}: the record has ${c.value}, the golden ${c.preset} has ${gv} (${gk[0]}.${gk[1]}): the record is stale, run npm run validate and record it again`);
      }
    }
  }
  const count = (f: (c: ValidateRecordCheck) => boolean) => rec.checks.filter(f).length;
  if (count((c) => c.status === 'known-fail') !== rec.summary.knownFailures) errs.push('validate record: knownFailures is not the number of known-fail checks');
  const w = (name: string) => count((c) => c.wording === name || c.wording.startsWith(`${name} (`));
  for (const [name, n] of Object.entries(rec.summary.wordings)) if (n !== w(name)) errs.push(`validate record: wordings.${name} is ${n}, the checks say ${w(name)}`);
  if (rec.summary.failures !== 0 || rec.summary.unexpectedPasses !== 0 || !rec.summary.passed) errs.push('validate record: the recorded run did not pass (failures, unexpected passes)');
  return errs;
}

/** The 50-cell run of the convergence record is the golden ITER15 (same code state). */
export function checkConvergenceRecord(rec: ConvergenceRecord, src: Sources): string[] {
  const errs: string[] = [];
  const g = src.golden(rec.preset);
  const r = rec.nRho.find((x) => x.cells === 50);
  if (!r) return ['convergence record has no 50-cell run'];
  const pairs: [string, number, string][] = [['Q', r.Q, 'flatTop.Q'], ['f_bs', r.f_bs, 'flatTop.f_bs'], ['li', r.li, 'flatTop.li'], ['Tped', r.Tped, 'flatTop.Tped']];
  for (const [name, v, p] of pairs) {
    const gv = path(g, p);
    if (rel(v, gv) > 1e-6) errs.push(`convergence record: the 50-cell ${name} is ${v}, the golden ${rec.preset} has ${gv}: the record is stale, run npm run bench:convergence and record it again`);
  }
  return errs;
}

// ---------------------------------------------------------------------------------------------------------
// command line

const USAGE = `usage: paper-numbers.ts [--check | --write | --list] [--live] [--file FILE] [--root DIR] [--threads N]
       paper-numbers.ts --record-validate FILE --head SHA --utc ISO [--root DIR]
       paper-numbers.ts --record-convergence FILE [--root DIR]`;

function usageError(msg: string): never {
  process.stderr.write(`paper-numbers: ${msg}\n${USAGE}\n`);
  process.exit(2);
}

interface Options {
  mode: 'check' | 'write' | 'list';
  live: boolean;
  file: string;
  root: string;
  threads: number;
  recordValidate?: string;
  head?: string;
  utc?: string;
  recordConvergence?: string;
}

export function parseOptions(argv: readonly string[]): Options {
  const o: Options = { mode: 'check', live: false, file: 'paper/paper.md', root: ROOT, threads: 2 };
  let modes = 0;
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) usageError(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--check': o.mode = 'check'; modes++; break;
      case '--write': o.mode = 'write'; modes++; break;
      case '--list': o.mode = 'list'; modes++; break;
      case '--live': o.live = true; break;
      case '--file': o.file = value(i++, a); break;
      case '--root': o.root = resolve(value(i++, a)); break;
      case '--threads': {
        const n = Number(value(i++, a));
        if (!Number.isInteger(n) || n < 1) usageError('--threads needs a positive integer');
        o.threads = n;
        break;
      }
      case '--record-validate': o.recordValidate = value(i++, a); break;
      case '--head': o.head = value(i++, a); break;
      case '--utc': o.utc = value(i++, a); break;
      case '--record-convergence': o.recordConvergence = value(i++, a); break;
      case '--help': case '-h': process.stdout.write(`${USAGE}\n`); process.exit(0); break;
      default: usageError(`unknown argument '${a}'`);
    }
  }
  if (modes > 1) usageError('--check, --write and --list are mutually exclusive');
  if (o.recordValidate && (!o.head || !o.utc)) usageError('--record-validate needs --head and --utc');
  if (o.recordValidate && o.recordConvergence) usageError('--record-validate and --record-convergence are separate runs');
  return o;
}

function writeRecord(root: string, rel_: string, rec: unknown): void {
  const file = join(root, rel_);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
  process.stdout.write(`wrote ${file}\n`);
}

/** Re-run validate and compare its checks with the record (values to 1e-9, status and wording exactly). */
export function liveDifferences(rec: ValidateRecord, live: ValidateRecord): string[] {
  const errs: string[] = [];
  if (JSON.stringify(rec.summary) !== JSON.stringify(live.summary)) errs.push(`the summary of validate differs: record ${JSON.stringify(rec.summary)}, live ${JSON.stringify(live.summary)}`);
  for (const c of rec.checks) {
    const l = live.checks.find((x) => x.id === c.id);
    if (!l) { errs.push(`${c.id}: not in the live run`); continue; }
    if (rel(c.value, l.value) > 1e-9 || c.status !== l.status || c.wording !== l.wording) {
      errs.push(`${c.id}: record ${c.value} ${c.status} '${c.wording}', live ${l.value} ${l.status} '${l.wording}'`);
    }
  }
  return errs;
}

function main(): void {
  const o = parseOptions(process.argv.slice(2));
  const src = fileSources(o.root);

  if (o.recordValidate) {
    const raw = JSON.parse(readFileSync(resolve(o.recordValidate), 'utf8')) as Json;
    const rec = buildValidateRecord(raw, { gitHead: o.head as string, utc: o.utc as string, node: process.version });
    writeRecord(o.root, VALIDATE_RECORD, rec);
    return;
  }
  if (o.recordConvergence) {
    const file = resolve(o.recordConvergence);
    const bytes = readFileSync(file);
    const rec = buildConvergenceRecord(JSON.parse(bytes.toString('utf8')) as Json, { file: o.recordConvergence.replace(/\\/g, '/'), sha256: createHash('sha256').update(bytes).digest('hex') });
    writeRecord(o.root, CONVERGENCE_RECORD, rec);
    return;
  }

  const paper = join(o.root, o.file);
  if (!existsSync(paper)) usageError(`${paper} does not exist`);
  const md = readFileSync(paper, 'utf8');
  const lf = md.replace(/\r\n/g, '\n');

  if (o.mode === 'list') {
    for (const key of Object.keys(NUMBERS)) {
      let line: string;
      try { const c = compute(key, src); line = `${key.padEnd(20)} ${c.text.padStart(8)}  (${c.value})  ${NUMBERS[key].from}`; } catch (e) { line = `${key.padEnd(20)} ERROR ${(e as Error).message}`; }
      process.stdout.write(line + '\n');
    }
    return;
  }

  const recordErrors: string[] = [];
  try { recordErrors.push(...checkValidateRecord(src.validate(), src), ...checkConvergenceRecord(src.convergence(), src)); } catch (e) { recordErrors.push((e as Error).message); }

  if (o.mode === 'write') {
    if (recordErrors.length) { process.stderr.write(recordErrors.map((e) => `paper-numbers: ${e}\n`).join('')); process.exit(1); }
    const next = writeText(lf, src);
    const eol = md.includes('\r\n') ? '\r\n' : '\n';
    writeFileSync(paper, eol === '\r\n' ? next.replace(/\n/g, '\r\n') : next);
    const left = unmarkedNumbers(next);
    process.stdout.write(`${findMarkers(next).length} markers written${next === lf ? ' (no change)' : ''}\n`);
    if (left.length) { process.stderr.write(left.map((u) => `paper-numbers: line ${u.line}: unmarked number '${u.token}'\n`).join('')); process.exit(1); }
    return;
  }

  const errors = [...recordErrors, ...checkText(lf, src)];
  if (o.live) {
    const run = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/validate.cli.ts', '--json', '--threads', String(o.threads)], {
      cwd: o.root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    });
    if (run.status !== 0 && run.status !== 1) errors.push(`validate exited with ${String(run.status)}: ${(run.stderr ?? '').slice(0, 300)}`);
    else {
      const rec = src.validate();
      errors.push(...liveDifferences(rec, buildValidateRecord(JSON.parse(run.stdout) as Json, rec.recorded)));
    }
  }
  if (errors.length) {
    process.stderr.write(errors.map((e) => `paper-numbers: ${e}\n`).join(''));
    process.stderr.write('paper-numbers: stale; after reading the change, run: npm run paper:numbers -- --write\n');
    process.exit(1);
  }
  process.stdout.write(`paper-numbers: ${findMarkers(lf).length} markers agree with their sources${o.live ? ' (validate re-run included)' : ''}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();

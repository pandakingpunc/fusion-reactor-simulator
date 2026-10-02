/// <reference types="node" />
/**
 * README.md (English) and README.tr.md (its Turkish mirror) quote numbers: counts, the validation summary, the headline
 * quantities against the published values, the convergence of the 1.5D solver and the unmet targets. This test keeps them from
 * going stale silently. It reads both files and holds every quoted number to its source, within the rounding the text prints
 * (half a unit of the last printed digit):
 *
 *   counts                      PRESETS, METHODS, the golden files, REFERENCE_CHECKS, MISSIONS, docs/figures/figures.manifest.json
 *   validation summary          src/docs/testdata/validate-record.json, a trimmed `npm run validate -- --json` (schema 3). The record is
 *                               checked against references.ts (published value, accepted range, status and wording are recomputed
 *                               from the model value with evaluate.ts) and against test/golden/*.json: every value the golden suite
 *                               also holds is recomputed from it with the validation metrics and must equal the record. The five
 *                               values it cannot recompute (the shortened DEMO and DEMO15 golden cases, a burn-weighted average) are
 *                               listed in UNANCHORED; the two DEMO powers are also held to the full-run rows `X.*` of
 *                               docs/v4-numbers-diff.md
 *   headline numbers            the record, the golden files (flat-top values), references.ts (published values and uncertainties) and
 *                               the reference column of the figure-5 table in docs/figures/captions.md
 *   known failures              the record and references.ts; the table must list exactly the checks the record has as known failures
 *   code verification orders    the caption of figure 7 in docs/figures/captions.md
 *   convergence                 src/docs/testdata/convergence-record.json, a trimmed `npm run bench:convergence` of ITER15; the
 *                               record's default-grid run is held to test/golden/ITER15.json
 *   run times                   bench/perf-baseline.json
 *   opt-in module switches      the module table of docs/config-reference.md (generated from the JSON Schemas)
 *   unmet targets               the numbers of the "Measured" column must occur in docs/v4-wave2b-report.md (section 8.1 and 11): the
 *                               runs behind them (EPED onset, emergent H98, the JET split) are not part of the test suite
 *
 * Numbers in running text carry an invisible marker, `<!--n:KEY-->12 confinement methods`, and are checked as claims (CLAIMS
 * below). A table must carry `<!-- table: ID -->` before it and the ID has to be known here, so a new table is classified on
 * purpose. The Turkish file writes decimals with a comma; both files must quote the same numbers in the same places, the same
 * commands, the same links and the same headings, and neither may carry a label or number of an earlier release.
 *
 * Not checked (no cheap source): the timing words "a few minutes" and "tens of seconds", and the citations of the model table.
 * The records are made again with src/docs/testdata/make-records.mjs after a change that moves the physics: the anchors to the golden
 * files fail first.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../edu/missions';
import { METHODS } from '../physics/config/schema';
import { DEFAULT_PROFILE_SETTINGS } from '../physics/profiles/defaults';
import { PRESETS } from '../physics/presets';
import { BENCHMARK_DEVIATION, evaluateCheck, tally } from '../physics/validation/evaluate';
import { readMetric, type RunOutputs } from '../physics/validation/metrics';
import { REFERENCE_CHECKS, type ReferenceCheck } from '../physics/validation/references';
import { GOLDEN_CASES, caseConfig, goldenCase } from '../regression/golden';

const ROOT = new URL('../../', import.meta.url);
const read = (rel: string): string => readFileSync(new URL(rel, ROOT), 'utf8').replace(/\r\n/g, '\n');
const readJson = <T>(rel: string): T => JSON.parse(read(rel)) as T;

type Lang = 'en' | 'tr';
const FILES: Record<Lang, string> = { en: 'README.md', tr: 'README.tr.md' };
const TEXT: Record<Lang, string> = { en: read('README.md'), tr: read('README.tr.md') };
const LANGS: readonly Lang[] = ['en', 'tr'];

// ── the sources ─────────────────────────────────────────────────────────────────────────────────────────────

interface RecordCheck { id: string; value: number | null; status: string; wording: string; ratio: number | null; deviationPct: number | null }
interface ValidateRecord {
  tree: string; checksExecuted: number; failures: number; knownFailures: number; unexpectedPasses: number;
  wordings: Record<string, number>; passed: boolean; checks: RecordCheck[];
}
interface ConvergenceRun { value: number; steps: number; nElm: number; cellsAcrossPedestal?: number; metrics: Record<string, number> }
interface ConvergenceRecord { baseGrid: number; baseRtol: number; series: { parameter: string; values: number[]; runs: ConvergenceRun[] }[] }
interface Golden { meta: { tEnd: number; tEndShortened: boolean }; flatTop: Record<string, number>; scalars: Record<string, number>; steps: number }

const RECORD = readJson<ValidateRecord>('src/docs/testdata/validate-record.json');
const CONVERGENCE = readJson<ConvergenceRecord>('src/docs/testdata/convergence-record.json');
const readGolden = (id: string): Golden => readJson<Golden>(`test/golden/${id}.json`);
const check = (id: string): ReferenceCheck => {
  const c = REFERENCE_CHECKS.find((x) => x.id === id);
  if (!c) throw new Error(`no reference check '${id}'`);
  return c;
};
const recorded = (id: string): RecordCheck => {
  const r = RECORD.checks.find((x) => x.id === id);
  if (!r) throw new Error(`the validate record has no check '${id}'`);
  return r;
};
/** the value the validation metric of a check reads from the golden file of its preset */
function fromGolden(c: ReferenceCheck): number {
  const g = readGolden(c.preset);
  const run = { report: g.scalars, flatTop: g.flatTop, cfg: caseConfig(goldenCase(c.preset)) } as unknown as RunOutputs;
  return readMetric(c.path, run);
}
/** checks whose model value the golden suite cannot recompute: a shortened golden case (the preset runs 2000 s) or a burn-weighted average */
const UNANCHORED: readonly string[] = ['DEMO.Pfus', 'DEMO.alphaShare', 'DEMO15.Pfus', 'DEMO15.fbs', 'Z.Ti'];

// ── numbers and tables ──────────────────────────────────────────────────────────────────────────────────────

/** A printed number: its value and the unit of its last printed digit ('10.08' -> 0.01, '1e-2' -> 0.01, '3,66e12' -> 1e10). */
interface Num { value: number; unit: number; text: string }
const NUMBER = /[+-]?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?/gi;
function parseNum(token: string): Num {
  const t = token.replace(',', '.');
  const m = /^[+-]?(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(t);
  if (!m) throw new Error(`not a number: '${token}'`);
  return { value: Number(t), unit: 10 ** (Number(m[3] ?? 0) - (m[2] ?? '').length), text: token };
}
/** the text of a cell without markdown emphasis, code ticks and comments */
const plain = (s: string): string => s.replace(/<!--.*?-->/g, '').replace(/[`*]/g, '').replace(/\u2212/g, '-');
const numbersIn = (s: string): Num[] => [...plain(s).matchAll(NUMBER)].map((m) => parseNum(m[0]));

/** printed within half a unit of its last digit of the source value */
function near(printed: Num, actual: number, what: string): void {
  const tol = printed.unit / 2 + Math.abs(actual) * 1e-12;
  expect(Math.abs(printed.value - actual), `${what}: printed ${printed.text}, source ${actual}`).toBeLessThanOrEqual(tol);
}
/** every printed number of a cell, against the expected values in order */
function nearAll(cell: string, expected: number[], what: string): void {
  const nums = numbersIn(cell);
  expect(nums.length, `${what}: numbers in '${cell}'`).toBe(expected.length);
  nums.forEach((n, i) => near(n, expected[i], `${what} #${i + 1}`));
}

interface Table { id: string | undefined; header: string[]; rows: string[][] }
const splitCells = (line: string): string[] => line.replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

/** The pipe tables outside code fences, each with the id of the `<!-- table: ID -->` marker before it (blank lines allowed in between). */
function parseTables(md: string): Table[] {
  const lines = md.split('\n'), out: Table[] = [];
  let fence = false, marker: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) { fence = !fence; marker = undefined; continue; }
    if (fence) continue;
    const mk = /^<!-- table: ([\w-]+) -->\s*$/.exec(l);
    if (mk) { marker = mk[1]; continue; }
    if (l.startsWith('|')) {
      const block: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) block.push(lines[i++]);
      i--;
      out.push({ id: marker, header: splitCells(block[0]), rows: block.slice(2).map(splitCells) });
      marker = undefined;
    } else if (l.trim() !== '') marker = undefined;
  }
  return out;
}
const TABLES: Record<Lang, Table[]> = { en: parseTables(TEXT.en), tr: parseTables(TEXT.tr) };
function table(lang: Lang, id: string): Table {
  const t = TABLES[lang].find((x) => x.id === id);
  if (!t) throw new Error(`${FILES[lang]} has no table '${id}'`);
  return t;
}

// ── claims in running text ──────────────────────────────────────────────────────────────────────────────────

const flat = (parameter: string): ConvergenceRun[] => CONVERGENCE.series.find((s) => s.parameter === parameter)!.runs;
const pct = (fine: number, mid: number): number => 100 * (fine / mid - 1);
const nrho = flat('nRho');
const SLOWER_ROW = /\| ITER15, 400 s \|[^|]*\|[^|]*\(x([\d.]+)\)/.exec(read('docs/v4-numbers-diff.md'));

/** `<!--n:KEY-->NUMBER` markers in the text: the number printed right after the marker, against its source */
const CLAIMS: Record<string, () => number> = {
  methods: () => METHODS.length,
  presets: () => PRESETS.length,
  missions: () => MISSIONS.length,
  cases: () => GOLDEN_CASES.length,
  checks: () => REFERENCE_CHECKS.length,
  validated: () => RECORD.wordings.validated,
  known: () => RECORD.knownFailures,
  figures: () => Object.keys(readJson<{ figures: object }>('docs/figures/figures.manifest.json').figures).length,
  nrho: () => (DEFAULT_PROFILE_SETTINGS as unknown as Record<string, number>).nRho,
  rtol: () => (DEFAULT_PROFILE_SETTINGS as unknown as Record<string, number>).rtol,
  dtmax: () => (DEFAULT_PROFILE_SETTINGS as unknown as Record<string, number>).dtMax,
  tped_change: () => pct(nrho[2].metrics.Tped, nrho[1].metrics.Tped),
  cells25: () => nrho[0].cellsAcrossPedestal!,
  cells50: () => nrho[1].cellsAcrossPedestal!,
  q25_lower: () => -pct(nrho[0].metrics.Q, nrho[1].metrics.Q),
  // 'about 5 times slower': the ITER15 row of section 6 of docs/v4-numbers-diff.md reads (x5.2)
  slower: () => Number(SLOWER_ROW![1]),
};
function claimsOf(lang: Lang): { key: string; num: Num }[] {
  return [...TEXT[lang].matchAll(/<!--n:([\w-]+)-->\s*([+-]?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?)/gi)].map((m) => ({ key: m[1], num: parseNum(m[2]) }));
}

// ── structure of the text ───────────────────────────────────────────────────────────────────────────────────

/** fenced code blocks that are commands or code (not the `text` layout block), without their comments */
function codeBlocks(md: string): string[] {
  return [...md.matchAll(/^```(\w*)\n([\s\S]*?)^```/gm)]
    .filter((m) => m[1] !== 'text')
    .map((m) => m[2].split('\n').map((l) => l.replace(/\s+#\s.*$/, '').replace(/\s+\/\/\s.*$/, '').trimEnd()).join('\n'));
}
const headings = (md: string): string[] => [...md.matchAll(/^(#{1,6}) (.*)$/gm)].map((m) => m[1]);
/** GitHub's anchor of a heading */
const slug = (h: string): string => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
function links(md: string): string[] {
  const noCode = md.replace(/^```[\s\S]*?^```/gm, '');
  return [
    ...[...noCode.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]),
    ...[...noCode.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]),
  ];
}
const LANGUAGE_SWITCH = ['README.md', 'README.tr.md'];

// ── tests ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('the validate record is the validation, not a second opinion', () => {
  it('lists the checks of references.ts in order, with the totals of the run', () => {
    expect(RECORD.checks.map((c) => c.id)).toEqual(REFERENCE_CHECKS.map((c) => c.id));
    expect(RECORD.checksExecuted).toBe(REFERENCE_CHECKS.length);
    expect(RECORD.passed).toBe(true);
    const status = (s: string) => RECORD.checks.filter((c) => c.status === s).length;
    expect(RECORD.failures).toBe(status('fail') + status('error'));
    expect(RECORD.knownFailures).toBe(status('known-fail'));
    expect(RECORD.unexpectedPasses).toBe(status('xpass'));
    expect(RECORD.failures).toBe(0);
  });

  it('has the status, ratio and wording that evaluate.ts gives its own model values', () => {
    const outcomes = REFERENCE_CHECKS.map((c) => evaluateCheck(c, recorded(c.id).value ?? NaN));
    outcomes.forEach((o, i) => {
      const r = RECORD.checks[i];
      expect(r.status, r.id).toBe(o.status);
      expect(r.wording, r.id).toBe(o.wording);
      expect(r.ratio, r.id).toBeCloseTo(o.ratio!, 12);
      expect(r.deviationPct, r.id).toBeCloseTo(100 * o.deviation!, 9);
    });
    const t = tally(outcomes);
    expect(RECORD.knownFailures).toBe(t.knownFail);
    const words = { validated: 0, benchmarked: 0, calibrated: 0, 'sanity bound': 0, unavailable: 0 };
    for (const o of outcomes) {
      if (o.wording === 'validated') words.validated++;
      else if (o.wording.startsWith('benchmarked')) words.benchmarked++;
      else if (o.wording.startsWith('calibrated')) words.calibrated++;
      else if (o.wording === 'sanity bound') words['sanity bound']++;
      else words.unavailable++;
    }
    expect(RECORD.wordings).toEqual(words);
  });

  it('equals the golden files wherever they hold the same run, and names the checks where they do not', () => {
    const unanchored: string[] = [];
    for (const c of REFERENCE_CHECKS) {
      const g = readGolden(c.preset);
      if (g.meta.tEndShortened || c.path.startsWith('burn.')) { unanchored.push(c.id); continue; }
      const v = fromGolden(c);
      const r = recorded(c.id).value!;
      expect(Math.abs(v - r) / Math.max(Math.abs(v), Math.abs(r), 1e-300), `${c.id}: golden ${v}, record ${r}`).toBeLessThanOrEqual(1e-6);
    }
    expect(unanchored).toEqual(UNANCHORED);
  });

  it('holds the two full-length DEMO powers to the full-run rows of docs/v4-numbers-diff.md', () => {
    const doc = read('docs/v4-numbers-diff.md');
    for (const [row, id] of [['X.DEMO.Pfus', 'DEMO.Pfus'], ['X.DEMO15.Pfus', 'DEMO15.Pfus']] as const) {
      const m = new RegExp(`\\| \`${row.replace('.', '\\.')}\` \\|[^|]*\\|[^|]*\\| ([\\d.]+) \\|`).exec(doc);
      expect(m, row).not.toBeNull();
      near(parseNum(m![1]), recorded(id).value!, row);
    }
  });
});

describe('the convergence record is tied to the golden run', () => {
  it('has the default-grid run of the golden ITER15 case in every series', () => {
    const g = readGolden('ITER15');
    expect(CONVERGENCE.baseGrid).toBe(DEFAULT_PROFILE_SETTINGS.nRho);
    expect(CONVERGENCE.baseRtol).toBe(DEFAULT_PROFILE_SETTINGS.rtol);
    const base = [nrho[1], flat('rtol')[0], flat('dtMax')[0]];
    for (const run of base) {
      expect(run.metrics.Q).toBeCloseTo(g.flatTop.Q, 8);
      expect(run.metrics.f_bs).toBeCloseTo(g.flatTop.f_bs, 10);
      expect(run.metrics.li).toBeCloseTo(g.flatTop.li, 10);
      expect(run.metrics.Tped).toBeCloseTo(g.flatTop.Tped, 10);
      expect(run.steps).toBe(g.steps);
    }
  });
});

describe.each(LANGS)('%s: every number of the text is held to its source', (lang) => {
  const T = (id: string) => table(lang, id);

  it('tables are classified, and the known ones are all there', () => {
    const ids = TABLES[lang].map((t) => t.id);
    expect(ids.every((id) => id !== undefined), `a table without a '<!-- table: ID -->' marker in ${FILES[lang]}`).toBe(true);
    expect(ids).toEqual(['glance', 'modules', 'validation-counts', 'headline', 'known-failures', 'orders', 'convergence', 'runtime', 'limits', 'models']);
  });

  it('counts of the repository (glance)', () => {
    const goldenFiles = readdirSync(new URL('test/golden/', ROOT)).filter((f) => f.endsWith('.json'));
    const expected = [METHODS.length, PRESETS.length, GOLDEN_CASES.length, REFERENCE_CHECKS.length, CLAIMS.figures(), MISSIONS.length];
    expect(goldenFiles.length).toBe(GOLDEN_CASES.length);
    const rows = T('glance').rows;
    expect(rows.length).toBe(expected.length);
    rows.forEach((r, i) => nearAll(r[1], [expected[i]], `glance row ${i + 1}`));
  });

  it('opt-in module switches, defaults and values (modules) are those of docs/config-reference.md', () => {
    const ref = parseTables(read('docs/config-reference.md')).find((t) => t.header[0] === 'Module' && t.header[1] === 'Switch')!;
    const quoted = (s: string) => [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    const refBySwitch = new Map(ref.rows.map((r) => [r[1].replace(/`/g, ''), r]));
    const rows = T('modules').rows;
    for (const r of rows) {
      const sw = r[1].replace(/`/g, '');
      const row = refBySwitch.get(sw);
      expect(row, `switch ${sw} is not in docs/config-reference.md`).toBeDefined();
      expect(quoted(r[2]), `${sw}: default`).toEqual(quoted(row![2]));
      expect(quoted(r[3]), `${sw}: opt-in values`).toEqual(quoted(row![3]));
    }
    // the README lists every module of the reference except the older switch of the 1.5D model itself
    expect(rows.map((r) => r[1].replace(/`/g, '')).sort()).toEqual([...refBySwitch.keys()].filter((k) => k !== 'fidelity').sort());
    expect(quoted(rows[0][2])).toEqual([String((DEFAULT_PROFILE_SETTINGS as unknown as Record<string, string>).transportModel)]);
  });

  it('counts of npm run validate (validation-counts)', () => {
    const count = (kind: string) => REFERENCE_CHECKS.filter((c) => c.kind === kind).length;
    const expected = [
      RECORD.checksExecuted, RECORD.checks.filter((c) => c.status === 'pass' || c.status === 'xpass').length, RECORD.knownFailures, RECORD.failures,
      RECORD.wordings.validated, RECORD.wordings.benchmarked, RECORD.wordings.calibrated, RECORD.wordings['sanity bound'],
      count('validation'), count('benchmark'), count('sanity'),
    ];
    expect(expected.slice(0, 8).filter((_, i) => i >= 4).reduce((a, b) => a + b, 0)).toBe(RECORD.checksExecuted);
    const rows = T('validation-counts').rows;
    expect(rows.length).toBe(expected.length);
    rows.forEach((r, i) => nearAll(r[1], [expected[i]], `validation-counts row ${i + 1} (${r[0]})`));
  });

  it('the headline quantities against the published values (headline)', () => {
    type Pub = { check: string } | { caption: string };
    type Side = { check: string } | { golden: [string, string] };
    const captions = read('docs/figures/captions.md');
    const published = (p: Pub): { value: number; unc?: number; kind?: string } => {
      if ('check' in p) { const c = check(p.check); return { value: c.value, unc: c.uncertainty }; }
      const m = new RegExp(`\\| ${p.caption} \\| ([\\d.]+)`).exec(captions);
      if (!m) throw new Error(`figure-5 table of captions.md has no row '${p.caption}'`);
      return { value: Number(m[1]) };
    };
    const model = (s: Side): number => ('check' in s ? recorded(s.check).value! : readGolden(s.golden[0]).flatTop[s.golden[1].replace('flatTop.', '')]);
    const spec: { label: RegExp; pub: Pub; d0?: Side; d15?: Side }[] = [
      { label: /^ITER Q$/, pub: { check: 'ITER.Q' }, d0: { check: 'ITER.Q' }, d15: { check: 'ITER15.Q' } },
      { label: /^ITER P_fus/, pub: { check: 'ITER.Pfus' }, d0: { check: 'ITER.Pfus' }, d15: { check: 'ITER15.Pfus' } },
      { label: /^ITER n_e,line/, pub: { check: 'ITER.nG' }, d0: { check: 'ITER.nG' }, d15: { check: 'ITER15.nG' } },
      { label: /^ITER q95$/, pub: { check: 'ITER15.q95' }, d0: { golden: ['ITER', 'flatTop.q95'] }, d15: { check: 'ITER15.q95' } },
      { label: /^ITER f_bs$/, pub: { check: 'ITER15.fbs' }, d15: { check: 'ITER15.fbs' } },
      { label: /^ITER ℓ_i/, pub: { check: 'ITER15.li' }, d15: { check: 'ITER15.li' } },
      { label: /^ITER T_e,ped/, pub: { check: 'ITER15.Tped' }, d15: { check: 'ITER15.Tped' } },
      { label: /^JET E_fus/, pub: { check: 'JET.Efus' }, d0: { check: 'JET.Efus' }, d15: { check: 'JET15.Efus' } },
      { label: /^SPARC Q$/, pub: { check: 'SPARC.Q' }, d0: { check: 'SPARC.Q' }, d15: { check: 'SPARC15.Q' } },
      { label: /^SPARC P_fus/, pub: { caption: 'SPARC {2}P_fus' }, d0: { golden: ['SPARC', 'flatTop.P_fus'] }, d15: { golden: ['SPARC15', 'flatTop.P_fus'] } },
      { label: /^DEMO P_fus/, pub: { check: 'DEMO.Pfus' }, d0: { check: 'DEMO.Pfus' }, d15: { check: 'DEMO15.Pfus' } },
      { label: /^NIF N221204/, pub: { check: 'NIF.G' }, d0: { check: 'NIF.G' } },
      { label: /^NIF N230729/, pub: { check: 'NIF.G_N230729' }, d0: { check: 'NIF.G_N230729' } },
      { label: /^NIF N210808/, pub: { check: 'NIF210808.G' }, d0: { check: 'NIF210808.G' } },
    ];
    const WORDS: Record<Lang, Record<string, string>> = {
      en: { validated: 'validated', benchmarked: 'benchmarked', calibrated: 'calibrated' },
      tr: { doğrulandı: 'validated', kıyaslandı: 'benchmarked', kalibre: 'calibrated' },
    };
    const rows = T('headline').rows;
    expect(rows.length).toBe(spec.length);
    rows.forEach((r, i) => {
      const s = spec[i];
      if (lang === 'en') expect(r[0], `row ${i + 1}`).toMatch(s.label);
      const pub = published(s.pub);
      nearAll(r[1], pub.unc === undefined ? [pub.value] : [pub.value, pub.unc], `${r[0]}: published`);
      const sides: [Side | undefined, string, string][] = [[s.d0, r[2], r[3]], [s.d15, r[4], r[5]]];
      const expectedWords: string[] = [];
      for (const [side, valueCell, ratioCell] of sides) {
        if (!side) {
          expect(valueCell, `${r[0]}: no model value`).toBe('—');
          expect(ratioCell, `${r[0]}: no ratio`).toBe('—');
          continue;
        }
        const v = model(side);
        nearAll(valueCell, [v], `${r[0]}: model value`);
        nearAll(ratioCell, [v / pub.value], `${r[0]}: model / published`);
        let word = Math.abs(v / pub.value - 1) > BENCHMARK_DEVIATION ? 'benchmarked' : 'validated';
        if ('check' in side) {
          const c = check(side.check);
          expect(c.kind, `${c.id} is a bound, not a published value to compare with`).not.toBe('sanity');
          if (c.role === 'calibration') word = 'calibrated';
          // the wording of the table is the wording npm run validate prints for the same value
          expect(recorded(c.id).wording.startsWith(word), `${c.id}: ${recorded(c.id).wording}`).toBe(true);
        }
        expectedWords.push(word);
      }
      const printed = plain(r[6]).split('/').map((w) => WORDS[lang][w.trim().toLowerCase()] ?? `?${w.trim()}`);
      expect(printed, `${r[0]}: wording`).toEqual(expectedWords);
    });
  });

  it('the known failures are exactly the ones npm run validate reports (known-failures)', () => {
    const ids = REFERENCE_CHECKS.filter((c) => recorded(c.id).status === 'known-fail').map((c) => c.id);
    const rows = T('known-failures').rows;
    expect(rows.map((r) => /`([\w.]+)`/.exec(r[0])![1])).toEqual(ids);
    rows.forEach((r, i) => {
      const c = check(ids[i]), rec = recorded(ids[i]);
      nearAll(r[1], [rec.value!], `${c.id}: model`);
      nearAll(r[2], c.uncertainty === undefined ? [c.value] : [c.value, c.uncertainty], `${c.id}: published`);
      nearAll(r[3], [c.accept[0], c.accept[1]], `${c.id}: accepted range`);
      nearAll(r[4], [rec.value! / c.value], `${c.id}: model / published`);
    });
  });

  it('code verification orders (orders) are those of the caption of figure 7', () => {
    const cap = read('docs/figures/captions.md');
    const observed = [
      /observed order (\d+\.\d+) \(expected 2\)/.exec(cap)![1],
      /steady diffusion with uniform source in a cylinder: order (\d+\.\d+)/.exec(cap)![1],
      /self-convergence\): order (\d+\.\d+) \(expected 1\)/.exec(cap)![1],
    ].map(Number);
    const expectedOrder = [2, 2, 1]; // second-order finite volumes and Shortley-Weller stencils, first-order backward Euler
    const rows = T('orders').rows;
    expect(rows.length).toBe(3);
    rows.forEach((r, i) => {
      nearAll(r[1], [observed[i]], `orders row ${i + 1}: observed`);
      nearAll(r[2], [expectedOrder[i]], `orders row ${i + 1}: expected`);
    });
  });

  it('the convergence of ITER15 (convergence) is that of the benchmark record', () => {
    const spec: [string, string][] = [
      ['nRho', 'Q'], ['nRho', 'f_bs'], ['nRho', 'li'], ['nRho', 'Tped'],
      ['rtol', 'Q'], ['rtol', 'f_bs'], ['rtol', 'li'], ['rtol', 'Tped'],
      ['dtMax', 'nElm'],
    ];
    const rows = T('convergence').rows;
    expect(rows.length).toBe(spec.length);
    const NOT_MET: Record<Lang, RegExp> = { en: /not met/, tr: /sağlanmadı/ };
    rows.forEach((r, i) => {
      const [parameter, key] = spec[i];
      const series = CONVERGENCE.series.find((s) => s.parameter === parameter)!;
      nearAll(r[0], series.values, `convergence row ${i + 1}: grid of the series`);
      const v = series.runs.map((run) => (key === 'nElm' ? run.nElm : run.metrics[key]));
      nearAll(r[2], [v[0]], `row ${i + 1}: coarse`);
      nearAll(r[3], [v[1]], `row ${i + 1}: middle`);
      nearAll(r[4], [v[2]], `row ${i + 1}: fine`);
      const change = pct(v[2], v[1]);
      nearAll(r[5], [change], `row ${i + 1}: change`);
      const target = numbersIn(r[6])[0].value;
      expect(NOT_MET[lang].test(r[7]), `row ${i + 1} (${parameter} ${key}): change ${change.toFixed(3)} % against < ${target} %: '${r[7]}'`).toBe(Math.abs(change) >= target);
    });
  });

  it('run times (runtime) are those of bench/perf-baseline.json', () => {
    const base = readJson<{ medianMs: Record<string, number> }>('bench/perf-baseline.json').medianMs;
    const rows = T('runtime').rows;
    expect(rows.length).toBe(3);
    ['ITER', 'ITER15', 'DEMO15'].forEach((id, i) => nearAll(rows[i][1], [base[id] / 1000], `runtime ${id}`));
  });

  it('unmet targets (limits): every measured number occurs in docs/v4-wave2b-report.md', () => {
    const inReport = new Set(read('docs/v4-wave2b-report.md').match(/\d+(?:\.\d+)?/g));
    for (const r of T('limits').rows) {
      const nums = numbersIn(r[1]);
      expect(nums.length, `no number in '${r[1]}'`).toBeGreaterThan(0);
      for (const n of nums) expect(inReport.has(n.text.replace(/^[+-]/, '').replace(',', '.')), `${n.text} of '${r[1]}'`).toBe(true);
    }
  });

  it('claims in the running text (<!--n:KEY-->NUMBER) are held to their sources', () => {
    const claims = claimsOf(lang);
    expect(claims.length).toBeGreaterThan(10);
    for (const c of claims) {
      expect(CLAIMS[c.key], `unknown claim key '${c.key}'`).toBeDefined();
      near(c.num, CLAIMS[c.key](), `claim ${c.key}`);
    }
  });

  it('carries no label, number or identifier of an earlier release and no invented DOI', () => {
    const text = TEXT[lang];
    for (const stale of [/\bv3\b/i, /\b3\.0\.0\b/, /22925078/, /715 ?MW/, /491 ?MW/, /\b1[.,]49\b/, /\b44 (unit )?(tests|birim)/i, /\b25 (presets|preset)\b/, /\b19 (literature )?checks\b/, /new in v3/i]) {
      expect(text, String(stale)).not.toMatch(stale);
    }
    const dois = [...text.matchAll(/10\.\d{4,9}\/[^\s)\]]+/g)].map((m) => m[0].replace(/\.svg$/, '').replace(/[.,;]+$/, ''));
    expect(dois.length).toBeGreaterThan(0);
    for (const d of dois) expect(['10.5281/zenodo.22259861', '10.5281/zenodo.23100241'], 'only the concept DOI and the 4.0.0 version DOI are written down').toContain(d);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  });

  it('links, images and anchors resolve', () => {
    const text = TEXT[lang];
    const anchors = new Set([...text.matchAll(/^#{1,6} (.*)$/gm)].map((m) => slug(m[1])));
    for (const l of links(text)) {
      if (/^(https?:|mailto:)/.test(l)) continue;
      if (l.startsWith('#')) { expect(anchors.has(l.slice(1)), `anchor ${l} of ${FILES[lang]}`).toBe(true); continue; }
      const [path, anchor] = l.split('#');
      expect(existsSync(new URL(decodeURI(path), ROOT)), `${path} linked from ${FILES[lang]}`).toBe(true);
      if (anchor && path === FILES[lang]) expect(anchors.has(anchor)).toBe(true);
    }
  });

  it('links the nine paper figures of the manifest', () => {
    const m = readJson<{ figures: Record<string, { file: string }> }>('docs/figures/figures.manifest.json');
    for (const f of Object.values(m.figures)) {
      expect(TEXT[lang], `${f.file}.svg`).toContain(`docs/figures/${f.file}.svg`);
      expect(TEXT[lang], `${f.file}.pdf`).toContain(`docs/figures/${f.file}.pdf`);
    }
  });
});

describe('README.tr.md mirrors README.md', () => {
  it('has the same headings, tables, numbers, claims, commands and links', () => {
    expect(headings(TEXT.tr)).toEqual(headings(TEXT.en));
    expect(TABLES.tr.map((t) => [t.id, t.header.length, t.rows.length])).toEqual(TABLES.en.map((t) => [t.id, t.header.length, t.rows.length]));
    for (const en of TABLES.en) {
      const tr = table('tr', en.id!);
      en.rows.forEach((row, i) => row.forEach((cell, j) => {
        expect(numbersIn(tr.rows[i][j]).map((n) => n.value), `table ${en.id}, row ${i + 1}, column ${j + 1}`).toEqual(numbersIn(cell).map((n) => n.value));
      }));
    }
    const claimList = (lang: Lang) => claimsOf(lang).map((c) => `${c.key}=${c.num.value}`).sort();
    expect(claimList('tr')).toEqual(claimList('en'));
    expect(codeBlocks(TEXT.tr)).toEqual(codeBlocks(TEXT.en));
    expect([...TEXT.tr.matchAll(/^```text$/gm)].length).toBe([...TEXT.en.matchAll(/^```text$/gm)].length);
    const targets = (md: string) => links(md).filter((l) => !LANGUAGE_SWITCH.includes(l.split('#')[0])).filter((l) => !l.startsWith('#')).sort();
    expect(targets(TEXT.tr)).toEqual(targets(TEXT.en));
  });

  it('writes decimals with a comma in its tables (a model name such as 1.5D keeps its point)', () => {
    for (const t of TABLES.tr) {
      for (const cell of [...t.header, ...t.rows.flat()]) {
        const text = plain(cell).replace(/1\.5D/g, '');
        expect(text, `table ${t.id}: '${cell}'`).not.toMatch(/\d\.\d/);
      }
    }
    expect(TEXT.tr).toContain('[English](README.md)');
    expect(TEXT.en).toContain('[Türkçe](README.tr.md)');
  });
});

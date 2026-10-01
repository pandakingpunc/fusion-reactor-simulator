/// <reference types="node" />
/**
 * docs/v4-numbers-diff.md is the before/after record of the headline numbers (v3.0.0 against v4). These tests keep it from
 * going stale silently:
 *
 *  - every row of its tables has a specification here (golden case and key) and the other way round;
 *  - the v4 column equals the value stored in test/golden/<case>.json, to the last printed digit (half a unit of it): a change
 *    of the physics that re-records the golden suite fails this test until the document is updated;
 *  - the change column follows from the v3 and v4 columns (so a hand edit of one number cannot pass);
 *  - the v3 column equals the v3.0.0 baseline of the golden harness (test/golden at 1dc6d8a, recorded with the v3.0.0
 *    physics; bit-identical to a run of the v3.0.0 tree, which the document's method section states), read from git history
 *    when that history is available;
 *  - the rows 'X.*' are the only ones no golden file covers (full 2000 s DEMO presets, a 177 s run): the allow-list below
 *    names them, so that a new unchecked row has to be added here on purpose.
 *
 * The derived rows (H98, tau_E/tau_ISS04) are evaluated with validation/metrics.ts on the golden flat-top values and the
 * golden case's configuration, as `npm run validate` does.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { caseConfig, goldenCase } from './golden';
import { readMetric, type MetricPath, type RunOutputs } from '../physics/validation/metrics';

const DOC = new URL('../../docs/v4-numbers-diff.md', import.meta.url);
const goldenUrl = (id: string) => new URL(`../../test/golden/${id}.json`, import.meta.url);
/** the commit of the schema-2 v3.0.0 baseline files (the numbers of 862f11d, with the whole-history statistics added) */
const V3_BASELINE_COMMIT = '1dc6d8a';

/**
 * Row id -> [golden case, specification]. A specification is 'flatTop.<key>', 'scalars.<key>', 'a/b' of two of them (a ratio) or
 * 'derived.<metric>' (validation/metrics.ts).
 */
const SPEC: Record<string, readonly [string, string]> = {
  'ITER.Q': ['ITER', 'flatTop.Q'],
  'ITER.Pfus': ['ITER', 'flatTop.P_fus'],
  'ITER.Qmax': ['ITER', 'scalars.Q_sci_max'],
  'ITER.nG': ['ITER', 'flatTop.nG_frac'],
  'JET.Efus': ['JET', 'scalars.E_fusion_MJ'],
  'JET.btShare': ['JET', 'flatTop.P_bt/flatTop.P_fus'],
  'JET15.Efus': ['JET15', 'scalars.E_fusion_MJ'],
  'JET15.btShare': ['JET15', 'flatTop.P_bt/flatTop.P_fus'],
  'JET15.Ti0': ['JET15', 'flatTop.Ti0'],
  'SPARC.Q': ['SPARC', 'flatTop.Q'],
  'SPARC.Pfus': ['SPARC', 'flatTop.P_fus'],
  'SPARC15.Q': ['SPARC15', 'flatTop.Q'],
  'SPARC15.Pfus': ['SPARC15', 'flatTop.P_fus'],
  'DEMO.Pfus': ['DEMO', 'flatTop.P_fus'],
  'DEMO.Q': ['DEMO', 'flatTop.Q'],
  'DEMO15.Pfus': ['DEMO15', 'flatTop.P_fus'],
  'DEMO15.Q': ['DEMO15', 'flatTop.Q'],
  'NIF.G': ['NIF', 'scalars.Q_sci_max'],
  'NIF.Yield': ['NIF', 'scalars.E_fusion_MJ'],
  'NIF210808.G': ['NIF210808', 'scalars.Q_sci_max'],
  'NIF210808.Yield': ['NIF210808', 'scalars.E_fusion_MJ'],
  'DIRECT.G': ['DIRECT', 'scalars.Q_sci_max'],
  'ITER15.Q': ['ITER15', 'flatTop.Q'],
  'ITER15.Pfus': ['ITER15', 'flatTop.P_fus'],
  'ITER15.fbs': ['ITER15', 'flatTop.f_bs'],
  'ITER15.li': ['ITER15', 'flatTop.li'],
  'ITER15.Tped': ['ITER15', 'flatTop.Tped'],
  'ITER15.nG': ['ITER15', 'flatTop.nG_frac'],
  'ITER15.q95': ['ITER15', 'flatTop.q95'],
  'MASTU.H98': ['MASTU', 'derived.H98y2'],
  'MASTU.q95': ['MASTU', 'flatTop.q95'],
  'MASTU.Pfus': ['MASTU', 'flatTop.P_fus'],
  'DIIID.H98': ['DIIID', 'derived.H98y2'],
  'DIIID.Palpha': ['DIIID', 'flatTop.P_alpha'],
  'DIIID.Pfus': ['DIIID', 'flatTop.P_fus'],
  'W7X.Ti0': ['W7X', 'flatTop.Ti0'],
  'W7X.HISS04': ['W7X', 'derived.HISS04'],
  'W7X.Pfus': ['W7X', 'flatTop.P_fus'],
};
/** rows no golden file covers: the full-length (2000 s) DEMO presets, measured at HEAD by scratch/claude-nd-measure.ts */
const UNCHECKED: readonly string[] = ['X.DEMO.Pfus', 'X.DEMO.Q', 'X.DEMO15.Pfus', 'X.DEMO15.Q'];
/** rows of the main table whose v3 value is not a number (no such preset in v3.0.0) */
const NO_V3: readonly string[] = ['NIF210808.G', 'NIF210808.Yield'];

type Golden = { flatTop: Record<string, number>; scalars: Record<string, number> };

function pick(g: Golden, spec: string): number {
  if (spec.includes('/')) {
    const [a, b] = spec.split('/');
    return pick(g, a) / pick(g, b);
  }
  const dot = spec.indexOf('.');
  const scope = spec.slice(0, dot), key = spec.slice(dot + 1);
  if (scope === 'flatTop') return g.flatTop[key];
  if (scope === 'scalars') return g.scalars[key];
  throw new Error(`unknown specification '${spec}'`);
}

function evaluate(g: Golden, caseId: string, spec: string): number {
  if (spec.startsWith('derived.')) {
    const run = { report: g.scalars, flatTop: g.flatTop, cfg: caseConfig(goldenCase(caseId)) } as unknown as RunOutputs;
    return readMetric(spec as MetricPath, run);
  }
  return pick(g, spec);
}

const readGolden = (id: string): Golden => JSON.parse(readFileSync(goldenUrl(id), 'utf8')) as Golden;

/** A printed number: its value and the unit of its last printed digit ('10.08' -> 0.01, '1.42e-4' -> 1e-6, '+3.3' -> 0.1). */
function parseNumber(text: string): { value: number; unit: number } | undefined {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text.trim());
  if (!m) return undefined;
  const decimals = (m[3] ?? '').length, exponent = Number(m[4] ?? 0);
  return { value: Number(text.trim()), unit: 10 ** (exponent - decimals) };
}

interface Table { header: string[]; rows: string[][] }

/** The pipe tables of a markdown text, as header cells and row cells (the separator row dropped). */
function tables(md: string): Table[] {
  const out: Table[] = [];
  let cur: string[][] = [];
  const flush = () => {
    if (cur.length >= 2) out.push({ header: cur[0], rows: cur.slice(2) });
    cur = [];
  };
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('|')) cur.push(line.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim()));
    else flush();
  }
  flush();
  return out;
}

const md = readFileSync(DOC, 'utf8');
const all = tables(md);
const idOf = (cell: string): string | undefined => /^`([A-Za-z0-9.]+)`$/.exec(cell)?.[1];

/** the tables that carry v3.0.0 and v4 columns (the main table and the full-length table), rows with an id */
const mainTables = all.filter((t) => t.header[0] === 'ID' && t.header.includes('v3.0.0') && t.header.includes('v4'));
const mainRows = mainTables.flatMap((t) => {
  const iV3 = t.header.indexOf('v3.0.0'), iV4 = t.header.indexOf('v4'), iCh = t.header.indexOf('Change %');
  return t.rows.flatMap((r) => {
    const id = idOf(r[0]);
    return id ? [{ id, v3: r[iV3], v4: r[iV4], change: r[iCh] }] : [];
  });
});
const defnTable = all.find((t) => t.header[0] === 'ID' && t.header.includes('v4 time'));
const defnRows = (defnTable?.rows ?? []).flatMap((r) => {
  const id = idOf(r[0]);
  const h = (name: string) => r[defnTable!.header.indexOf(name)];
  return id ? [{ id, v3frame: h('v3 frame'), v3time: h('v3 time'), v4frame: h('v4 frame'), v4time: h('v4 time'), ff: h('frame to frame %'), tt: h('time to time %') }] : [];
});

/** the largest difference two printed numbers can hide (half a unit of each last digit) as a percentage of the change they define */
function changeTolerance(a: { value: number; unit: number }, b: { value: number; unit: number }): number {
  return 0.05 + 100 * (b.value / a.value) * (a.unit / 2 / Math.abs(a.value) + b.unit / 2 / Math.abs(b.value)) + 1e-9;
}

describe('docs/v4-numbers-diff.md: structure', () => {
  it('has the main table, the full-length table and the definition appendix', () => {
    expect(mainTables.length).toBeGreaterThanOrEqual(2);
    expect(defnTable).toBeDefined();
  });

  it('the rows with a golden case are exactly the rows of the specification here, once each', () => {
    const ids = mainRows.map((r) => r.id).filter((id) => !id.startsWith('X.'));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(SPEC).sort());
  });

  it("the rows no golden file covers are exactly the allow-list ('X.' rows)", () => {
    const ids = mainRows.map((r) => r.id).filter((id) => id.startsWith('X.'));
    expect([...ids].sort()).toEqual([...UNCHECKED].sort());
  });

  it('every number cell of a row is a number (or n/a where v3 has no such preset)', () => {
    for (const r of mainRows) {
      expect(parseNumber(r.v4), `${r.id}: v4 cell '${r.v4}'`).toBeDefined();
      if (NO_V3.includes(r.id)) {
        expect(r.v3, r.id).toBe('n/a');
        expect(r.change, r.id).toBe('n/a');
      } else {
        expect(parseNumber(r.v3), `${r.id}: v3 cell '${r.v3}'`).toBeDefined();
        expect(parseNumber(r.change), `${r.id}: change cell '${r.change}'`).toBeDefined();
      }
    }
  });
});

describe('docs/v4-numbers-diff.md: the v4 column against test/golden', () => {
  for (const [id, [caseId, spec]] of Object.entries(SPEC)) {
    it(`${id} = ${caseId} ${spec}`, () => {
      const row = mainRows.find((r) => r.id === id);
      expect(row, `row ${id} of the document`).toBeDefined();
      const printed = parseNumber(row!.v4)!;
      const golden = evaluate(readGolden(caseId), caseId, spec);
      expect(Number.isFinite(golden), `${caseId} ${spec} is finite`).toBe(true);
      expect(Math.abs(printed.value - golden), `document ${row!.v4}, golden ${golden}`).toBeLessThanOrEqual((printed.unit / 2) * (1 + 1e-9));
    });
  }

  it('the definition appendix: its v4 time column is the same golden value', () => {
    expect(defnRows.length).toBeGreaterThan(20);
    for (const r of defnRows) {
      const [caseId, spec] = SPEC[r.id] ?? [];
      expect(spec, `appendix row ${r.id} has a specification`).toBeDefined();
      const printed = parseNumber(r.v4time)!;
      const golden = evaluate(readGolden(caseId), caseId, spec);
      expect(Math.abs(printed.value - golden), `${r.id}: appendix ${r.v4time}, golden ${golden}`).toBeLessThanOrEqual((printed.unit / 2) * (1 + 1e-9));
    }
  });
});

describe('docs/v4-numbers-diff.md: the change columns follow from the numbers', () => {
  it('main table: change % = 100 (v4 / v3 - 1) within the rounding of the printed numbers', () => {
    for (const r of mainRows) {
      if (NO_V3.includes(r.id)) continue;
      const a = parseNumber(r.v3)!, b = parseNumber(r.v4)!, c = parseNumber(r.change)!;
      const expected = 100 * (b.value / a.value - 1);
      expect(Math.abs(c.value - expected), `${r.id}: ${r.v3} -> ${r.v4} is ${expected.toFixed(2)} %, the document says ${r.change}`).toBeLessThanOrEqual(changeTolerance(a, b));
    }
  });

  it('appendix: both change columns follow from their columns, and v3 frame is the main table\'s v3 value', () => {
    for (const r of defnRows) {
      const a = parseNumber(r.v3frame)!, d = parseNumber(r.v4frame)!, ff = parseNumber(r.ff)!;
      expect(Math.abs(ff.value - 100 * (d.value / a.value - 1)), `${r.id} frame to frame`).toBeLessThanOrEqual(changeTolerance(a, d));
      const b = parseNumber(r.v3time)!, e = parseNumber(r.v4time)!, tt = parseNumber(r.tt)!;
      expect(Math.abs(tt.value - 100 * (e.value / b.value - 1)), `${r.id} time to time`).toBeLessThanOrEqual(changeTolerance(b, e));
      expect(r.v3frame, `${r.id}: the appendix v3 frame value is the main table's v3 value`).toBe(mainRows.find((m) => m.id === r.id)?.v3);
    }
  });
});

/** the v3.0.0 baseline file of a case from git history; undefined where git or the commit is not there (a shallow clone, an archive) */
const baselines = new Map<string, Golden | undefined>();
function baseline(caseId: string): Golden | undefined {
  if (baselines.has(caseId)) return baselines.get(caseId);
  let value: Golden | undefined;
  try {
    const text = execFileSync('git', ['show', `${V3_BASELINE_COMMIT}:test/golden/${caseId}.json`], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'], cwd: new URL('../../', import.meta.url) });
    value = JSON.parse(text) as Golden;
  } catch {
    value = undefined;
  }
  baselines.set(caseId, value);
  return value;
}
const haveBaseline = baseline('NIF') !== undefined;

describe('docs/v4-numbers-diff.md: the v3.0.0 column against the recorded v3.0.0 baseline', () => {
  // The derived rows are evaluated on the v3.0.0 run with the volume-average density (v3 has no line average): the baseline file
  // holds the flat-top values they come from, not the cfg of that time, so they are out of this check (the document says so).
  it.skipIf(!haveBaseline)('every non-derived row of the v3.0.0 column is the baseline golden value', () => {
    let checked = 0;
    for (const [id, [caseId, spec]] of Object.entries(SPEC)) {
      if (spec.startsWith('derived.') || NO_V3.includes(id)) continue;
      const row = mainRows.find((r) => r.id === id)!;
      const printed = parseNumber(row.v3)!;
      const b = baseline(caseId);
      expect(b, `baseline of ${caseId}`).toBeDefined();
      const value = pick(b!, spec);
      expect(Math.abs(printed.value - value), `${id}: document ${row.v3}, baseline ${value}`).toBeLessThanOrEqual((printed.unit / 2) * (1 + 1e-9));
      checked++;
    }
    expect(checked).toBeGreaterThan(25);
  });
});

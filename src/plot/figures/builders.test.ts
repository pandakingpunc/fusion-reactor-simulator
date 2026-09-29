/// <reference types="node" />
/**
 * Every figure builder on deterministic synthetic data (testdata/synthetic.ts: closed-form profiles,
 * histories and grids, no simulation), rendered to SVG and to PDF with the embedded STIX Two fonts.
 * The SHA-256 of each output is recorded in testdata/builders.sha256.json, so that a change of a
 * builder, of the layout engine, of a back end or of a font subset is a visible, reviewed change; the
 * structural checks next to it keep a hash from being the only line of defence.
 *
 * Re-record after an intended change (and look at the figures first: `npm run figures -- --out <dir>`):
 *   UPDATE_FIGURE_GOLDEN=1 npx vitest run src/plot/figures/builders.test.ts
 * Only the equilibrium figure reaches into physics code that is not synthetic (its Solov'ev panel,
 * physics/equilibrium/solovev, and the Pchip of physics/numerics/interp); every other hash depends on
 * the plot engine alone.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Figure } from '../figure';
import { nodeFontSet } from '../fontsNode';
import { sha256, toHex } from '../sha256';
import { figEquilibrium } from './equilibrium';
import { figDiagGroups, figEqSnapshot } from './generic';
import { figMHD } from './mhd';
import { figPareto } from './pareto';
import { figPopcon } from './popcon';
import { figProfiles } from './profiles';
import { figReactivityLawson } from './reactivity';
import { figRhoT, rhoTFromFrames } from './rhot';
import { figScan } from './scan';
import { figTimeTraces } from './timetrace';
import { figTornado, figViolin } from './uq';
import { ValidationRow, figValidation } from './validation';
import { figVerification } from './verification';
import {
  DIAG_SPECS, POPCON_CFG, RHO, SYNTHETIC_RATES, VALIDATION_LABELS, lcg, normals, syntheticCrash, syntheticEqSnapshot, syntheticEquilibrium, syntheticEvents,
  syntheticFrames, syntheticPopcon, syntheticScan, syntheticVerification, syntheticZoom,
} from './testdata/synthetic';

const fonts = nodeFontSet();
const GOLDEN = fileURLToPath(new URL('./testdata/builders.sha256.json', import.meta.url));
const UPDATE = process.env.UPDATE_FIGURE_GOLDEN === '1';

const frames = syntheticFrames(60, 120);
const events = syntheticEvents(120);
const last = frames[frames.length - 1];
const scan = syntheticScan(7);

const validationRows = (): ValidationRow[] => VALIDATION_LABELS.map(([label, ref, refText], k) => ({
  label, ref, refText, v0D: ref * (0.8 + 0.06 * k), v15D: k === 3 ? undefined : ref * (1.3 - 0.07 * k),
}));

interface Case { name: string; build: () => Figure; has: string[] }

const CASES: Case[] = [
  { name: 'equilibrium', build: () => figEquilibrium({ eq: syntheticEquilibrium(), rho: RHO, Te: last.prof!.Te, label: 'synthetic, t = 120 s' }), has: ['X-point', 'SOL'] },
  { name: 'profiles', build: () => figProfiles({ frame: last, pedestalWidth: 0.05, label: 'synthetic flat top' }), has: ['pedestal', 'synthetic flat top'] },
  { name: 'timetraces', build: () => figTimeTraces(frames, events, 'synthetic discharge'), has: ['NTM onset', 'synthetic discharge', 'sawtooth'] },
  {
    name: 'popcon',
    build: () => figPopcon({
      cfg: POPCON_CFG, grid: syntheticPopcon(), label: 'synthetic',
      traj: { n: frames.map((f) => f.d.nbar), T: frames.map((f) => 0.5 * (f.d.Te0 + f.d.Ti0) * 0.6) },
    }),
    has: ['1.5D trajectory', 'synthetic'],
  },
  { name: 'popcon-no-trajectory', build: () => figPopcon({ cfg: POPCON_CFG, grid: syntheticPopcon(18, 20) }), has: [] },
  { name: 'validation', build: () => figValidation(validationRows()), has: ['±30%', '×2', 'reference'] },
  {
    name: 'validation-uncertainty',
    build: () => figValidation(validationRows().map((r, k) => ({
      ...r, refLo: r.ref * 0.92, refHi: r.ref * (k % 2 ? 1.1 : 1.05),
      v0DLo: r.v0D! * 0.85, v0DHi: r.v0D! * 1.2, v15DLo: r.v15D === undefined ? undefined : r.v15D * 0.9, v15DHi: r.v15D === undefined ? undefined : r.v15D * 1.15,
    }))),
    has: ['reference range'],
  },
  {
    name: 'lawson',
    build: () => figReactivityLawson([
      { label: 'A', color: '#0072B2', p0: { T: 8, ntau: 2e20 }, p15: { T: 9, ntau: 3e20 }, pos: 'above' },
      { label: 'B', color: '#009E73', p0: { T: 12, ntau: 6e19 }, p15: { T: 14, ntau: 9e19 }, pos: 'right' },
      { label: 'C', color: '#CC79A7', p0: { T: 30, ntau: 1e20 }, pos: 'left' },
      { label: 'D', color: '#D55E00', p15: { T: 20, ntau: 4e20 }, pos: 'below' },
      { label: 'E', color: '#000000' },
    ], SYNTHETIC_RATES),
    has: ['0D (vol. avg.)', '1.5D (vol. avg.)', 'D–T'],
  },
  { name: 'verification', build: () => figVerification(syntheticVerification()), has: ['Dormand–Prince RK5(4), adaptive', 'RHS evaluations'] },
  {
    name: 'mhd',
    build: () => figMHD({ saw: syntheticCrash('sawtooth'), elm: syntheticCrash('elm'), zoom: syntheticZoom(), hist: frames, events }),
    has: ['ELM cycle (high-cadence window)', 'neoclassical tearing modes'],
  },
  { name: 'mhd-partial', build: () => figMHD({ hist: frames, events: [] }), has: ['neoclassical tearing modes'] },
  { name: 'scan', build: () => figScan({ ...scan, ref: { x: 0.85, y: 1, label: 'baseline' }, label: 'synthetic scan' }), has: ['baseline', 'synthetic scan'] },
  {
    name: 'diaggroups',
    build: () => figDiagGroups(frames, DIAG_SPECS, ['Performance', 'Power', 'Temperature', 'Density'], 's', 'Synthetic 0D shot', events),
    has: ['Synthetic 0D shot'],
  },
  { name: 'eqsnapshot', build: () => figEqSnapshot(syntheticEqSnapshot(), { rho: RHO, Te: last.prof!.Te }, 'synthetic, t = 120 s'), has: ['synthetic, t = 120 s'] },
  { name: 'eqsnapshot-no-profile', build: () => figEqSnapshot(syntheticEqSnapshot(), null, 'no profile'), has: ['no profile'] },
  {
    name: 'violin',
    build: () => {
      const rng = lcg(31);
      const Q = normals(rng, 240).map((v) => 9.6 + 1.1 * v), P = normals(rng, 240).map((v) => 470 + 40 * v), t = normals(rng, 240).map((v) => Math.exp(1.2 + 0.5 * v));
      return figViolin([
        { label: '$Q$', groups: [{ name: 'base', samples: Q }, { name: 'high $n$', samples: Q.map((v) => 0.8 * v + 1) }], ref: 10, refLabel: 'design' },
        { label: '$P_{\\mathrm{fus}}$', unit: 'MW', groups: [{ name: 'base', samples: P }, { name: 'high $n$', samples: P.map((v) => v * 0.9) }], ref: 500 },
        { label: '$\\tau_E$', unit: 's', log: true, groups: [{ name: 'base', samples: t }] },
      ], { title: 'Synthetic UQ ensemble' });
    },
    has: ['design', 'Synthetic UQ ensemble'],
  },
  {
    name: 'tornado',
    build: () => figTornado({
      base: 10, output: '$Q$', title: 'Synthetic sensitivity',
      bars: [
        { label: '$H_{98}$', low: 8.1, high: 12.0, lowInput: '−10 %', highInput: '+10 %' }, { label: '$n_e$', low: 11.2, high: 8.7, lowInput: '−10 %', highInput: '+10 %' },
        { label: '$B_0$', low: 9.3, high: 10.9, lowInput: '−10 %', highInput: '+10 %' }, { label: '$Z_{\\mathrm{eff}}$', low: 10.4, high: 9.6 },
      ],
    }),
    has: ['low setting', 'high setting', 'Synthetic sensitivity'],
  },
  { name: 'rhot', build: () => figRhoT({ field: rhoTFromFrames(frames, 'Te')!, label: '$T_e$ (keV)', cmap: 'inferno', contours: [8, 16], events, title: 'Synthetic T_e(rho, t)' }), has: ['ELM', 'sawtooth', 'NTM onset', 'Synthetic T_e(rho, t)'] },
  {
    name: 'pareto',
    build: () => {
      const rng = lcg(17);
      const pts = Array.from({ length: 160 }, () => { const u = rng(); return { x: 1 + 9 * u, y: 1 / (0.4 + u) + 1.6 * rng(), c: 4 + 3 * rng() }; });
      return figPareto({ points: pts, xLabel: 'cost (arb.)', yLabel: '$1/Q$', colorLabel: '$B_0$ (T)', marks: [{ x: 5, y: 1.4, label: 'baseline' }], nFronts: 2, title: 'Synthetic trade-off' });
    },
    has: ['Pareto front', 'dominated', 'baseline', 'Synthetic trade-off'],
  },
];

const options = { fonts, version: 'test', configHash: 'test' };
const golden: Record<string, string> = (() => { try { return JSON.parse(readFileSync(GOLDEN, 'utf8')); } catch { return {}; } })();
const recorded: Record<string, string> = {};

describe('figure builders on synthetic data', () => {
  for (const c of CASES) {
    it(`${c.name}: renders to SVG and PDF; the SHA-256 of both is the recorded one`, () => {
      const fig = c.build();
      const svg = fig.toSVG(options);
      const pdf = fig.toPDF(options);
      expect(svg.startsWith('<?xml')).toBe(true);
      expect(svg, 'no NaN or Infinity in the SVG').not.toMatch(/NaN|Infinity/);
      for (const s of c.has) expect(svg, `text '${s}'`).toContain(s);
      expect(new TextDecoder('latin1').decode(pdf.subarray(0, 8))).toBe('%PDF-1.4');
      expect(new TextDecoder('latin1').decode(pdf)).not.toMatch(/NaN|Infinity/);
      recorded[`${c.name}.svg`] = toHex(sha256(svg));
      recorded[`${c.name}.pdf`] = toHex(sha256(pdf));
      if (!UPDATE) {
        expect(recorded[`${c.name}.svg`], `${c.name}.svg (UPDATE_FIGURE_GOLDEN=1 re-records)`).toBe(golden[`${c.name}.svg`]);
        expect(recorded[`${c.name}.pdf`], `${c.name}.pdf (UPDATE_FIGURE_GOLDEN=1 re-records)`).toBe(golden[`${c.name}.pdf`]);
      }
    });
  }

  it('the recorded file lists exactly the builders above', () => {
    if (UPDATE) {
      const sorted = Object.fromEntries(Object.entries(recorded).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
      writeFileSync(GOLDEN, JSON.stringify(sorted, null, 2) + '\n');
      return;
    }
    expect(Object.keys(golden).sort()).toEqual(CASES.flatMap((c) => [`${c.name}.pdf`, `${c.name}.svg`]).sort());
  });

  it('rendering is deterministic (the same figure twice gives identical bytes)', () => {
    const a = CASES[1].build(), b = CASES[1].build();
    expect(a.toSVG(options)).toBe(b.toSVG(options));
    expect(a.toPDF(options)).toEqual(b.toPDF(options));
  });
});

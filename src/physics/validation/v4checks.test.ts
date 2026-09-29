/**
 * The literature checks added for the v4.0 physics (references.ts): P_alpha of a D-D plasma, the alpha share of a
 * D-T plasma, the MAST-U q95 and the line-averaged Greenwald fraction of ITER. Each check must catch the v3
 * behaviour it guards, and the model values quoted in the text of a known failure are recomputed here so that
 * the text cannot drift from the code.
 */
import { describe, expect, it } from 'vitest';
import { MASTU } from '../presets';
import { q95Sauter } from '../geometry';
import { REFERENCE_CHECKS } from './references';
import { evaluateCheck } from './evaluate';
import { type RunOutputs, alphaShareFromRun, readMetric } from './metrics';
import type { ShotReport } from '../types';

const check = (id: string) => {
  const c = REFERENCE_CHECKS.find((x) => x.id === id);
  if (!c) throw new Error(`no check ${id}`);
  return c;
};

describe('D-D plasma: P_alpha is the charged D-D products, not the beam heating', () => {
  const c = check('DIIID.Palpha');

  it('accepts the v4.0 value and rejects the v3 one (11.66 MW: the NBI heating booked as alpha heating)', () => {
    expect(evaluateCheck(c, 0.0023).status).toBe('pass');
    expect(evaluateCheck(c, 0).status).toBe('pass');
    expect(evaluateCheck(c, 11.66).status).toBe('fail');
    expect(evaluateCheck(c, -1e-3).status).toBe('fail');
  });

  it('the bound is the record D-D gain of DIII-D times the preset\'s 15 MW of heating', () => {
    // Lazarus et al., Nucl. Fusion 37 (1997) 7: Q_DD = 0.0015
    expect(c.accept).toEqual([0, 0.0015 * 15]);
    expect(c.kind).toBe('sanity');
  });
});

describe('alpha share P_alpha / P_fus of the D-T tokamak presets', () => {
  const run = (P_alpha: number, P_fus: number): RunOutputs => ({ report: {} as ShotReport, flatTop: { P_alpha, P_fus }, cfg: MASTU });

  it('is read from the flat-top averages; NaN without fusion power or without P_alpha', () => {
    expect(readMetric('derived.alphaShare', run(106.1, 538.3))).toBeCloseTo(0.1971, 4);
    expect(alphaShareFromRun(run(1, 0))).toBeNaN();
    expect(alphaShareFromRun({ ...run(1, 5), flatTop: { P_fus: 5 } })).toBeNaN(); // a 1.5D run has no P_alpha
  });

  it('one check per D-T tokamak preset; the v3 share (ITER: 172.9 of 715.5 MW = 0.24) fails, v4.0 (0.197) passes', () => {
    const ids = ['ITER', 'JET', 'SPARC', 'DEMO'];
    for (const p of ids) {
      const c = check(`${p}.alphaShare`);
      expect(c.path).toBe('derived.alphaShare');
      expect(c.kind).toBe('sanity');
      expect(evaluateCheck(c, 106.1 / 538.3).status, p).toBe('pass');
      expect(evaluateCheck(c, 172.9 / 715.5).status, p).toBe('fail');
    }
    // the energy released by D + T → ⁴He + n: 3.561 of 17.589 MeV (exact two-body kinematics), and 5 % of slack
    expect(3.561 / 17.589).toBeCloseTo(0.2025, 4);
    expect(check('ITER.alphaShare').accept).toEqual([0, 0.213]);
    expect(0.2025 * 1.05).toBeLessThan(0.213);
    expect(0.2025 * 1.05).toBeGreaterThan(0.2125);
  });
});

describe('ITER: line-averaged Greenwald fraction', () => {
  it('is the flat-top n̄/n_G against the inductive scenario\'s 0.85; the v3 volume-average value 0.82 and v4.0 0.92 both pass', () => {
    const c = check('ITER.nG');
    expect(c.path).toBe('flatTop.nG_frac');
    expect(c.value).toBe(0.85);
    for (const v of [0.82, 0.92]) expect(evaluateCheck(c, v).status, String(v)).toBe('pass');
    expect(evaluateCheck(c, 1.2).status).toBe('fail'); // above the Greenwald limit
  });
});

describe('MAST-U q95: published band 5–10 (Berkery 2023) and the preset', () => {
  const c = check('MASTU.q95');
  const g = MASTU.geometry;
  const q = (over: Partial<typeof g>, B0: number, Ip: number) => q95Sauter({ ...g, ...over }, B0, Ip);

  it('the band is the accepted range, the value its mid-point; the preset is inside it since v4.0, so there is no known failure', () => {
    expect(c.band).toEqual([5, 10]);
    expect(c.accept).toEqual([5, 10]);
    expect(c.value).toBe(7.5);
    expect(c.knownFailure).toBeUndefined();
    expect(c.path).toBe('flatTop.q95');
  });

  it('the preset is a scenario of the first campaign (R 0.8 m, a 0.5 m, κ 2.1, δ 0.47, 0.75 MA, 0.55 T) with q95 = 6.4 by the fit, inside the band and the EFIT 6.3–6.7', () => {
    // Harrison et al. 2024 (typical R and a, κ 2.0–2.2, the 750 kA scenario) and Imada et al. 2024, table 1: discharges #45261, #45270, #45272 at
    // 722–740 kA and 0.55–0.56 T with κ = 2.10–2.15 and an average δ of 0.45–0.49, EFIT q95 6.3–6.7
    expect(MASTU.geometry).toEqual({ R: 0.8, a: 0.5, kappa: 2.1, delta: 0.47 });
    expect(MASTU.B0).toBe(0.55);
    expect(MASTU.Ip_MA).toBe(0.75);
    const preset = q({}, MASTU.B0, MASTU.Ip_MA);
    expect(preset).toBeCloseTo(6.4, 1);
    expect(evaluateCheck(c, preset).status).toBe('pass');
    // the fit at the discharges of Imada et al. (each with its own κ, δ, B and I_p) lands in their EFIT range within 10 %
    for (const [kappa, delta, B0, Ip, efit] of [[2.15, 0.49, 0.55, 0.726, 6.5], [2.11, 0.46, 0.56, 0.725, 6.7], [2.13, 0.48, 0.56, 0.74, 6.3]] as const) {
      expect(Math.abs(q({ kappa, delta }, B0, Ip) / efit - 1), `κ ${kappa}`).toBeLessThan(0.1);
    }
  });

  it('the design-maximum shape the preset had until v3.0.0 (R 0.85 m, a 0.65 m, κ 2.5, 0.75 T, 1 MA) gave q95 = 18.2, a factor 2.7 above a campaign shape, and fails the check', () => {
    const old = q95Sauter({ R: 0.85, a: 0.65, kappa: 2.5, delta: 0.5 }, 0.75, 1.0);
    expect(old).toBeCloseTo(18.2, 1);
    expect(evaluateCheck(c, old).status).toBe('fail');
    const typical = q({ R: 0.8, a: 0.5, kappa: 2.1, delta: 0.5 }, 0.75, 1.0);
    expect(typical).toBeCloseTo(6.6, 1);
    expect(old / typical).toBeCloseTo(2.7, 1);
    // the campaign's ranges: 450–1000 kA, B0 0.42–0.64 T, κ 2.0–2.2, δ 0.3–0.5 (the triangularity is not given in the Super-X paper: 0.3 and 0.5 bracket 0.45–0.49)
    const all: number[] = [];
    for (const kappa of [2.0, 2.2]) for (const delta of [0.3, 0.5]) for (const B0 of [0.42, 0.64]) for (const Ip of [0.45, 1.0]) {
      all.push(q({ R: 0.8, a: 0.5, kappa, delta }, B0, Ip));
    }
    expect(Math.min(...all)).toBeCloseTo(3.1, 1);
    expect(Math.max(...all)).toBeCloseTo(13.6, 1);
  });

  it('for a mid-range point of the campaign (750 kA, 0.53 T) the fit gives a q95 inside the published band', () => {
    const mid = q({ R: 0.8, a: 0.5, kappa: 2.1, delta: 0.4 }, 0.53, 0.75);
    expect(mid).toBeGreaterThan(5);
    expect(mid).toBeLessThan(10);
  });
});

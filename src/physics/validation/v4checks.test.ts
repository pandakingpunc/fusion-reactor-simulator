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

  it('the band is the accepted range, the value its mid-point; the preset is a documented known failure', () => {
    expect(c.band).toEqual([5, 10]);
    expect(c.accept).toEqual([5, 10]);
    expect(c.value).toBe(7.5);
    expect(c.knownFailure).toBeDefined();
    expect(c.path).toBe('flatTop.q95');
  });

  it('the numbers in the known-failure text are the fit\'s: preset 18.2, typical shape 6.6, campaign 3.1–13.6, factor 2.7', () => {
    const preset = q({}, MASTU.B0, MASTU.Ip_MA);
    expect(preset).toBeCloseTo(18.2, 1);
    // typical R = 0.8 m, a = 0.5 m, κ = 2.0–2.2 of the campaign (Harrison et al. 2024) at the preset's B0 and I_p
    const typical = q({ R: 0.8, a: 0.5, kappa: 2.1 }, MASTU.B0, MASTU.Ip_MA);
    expect(typical).toBeCloseTo(6.6, 1);
    expect(typical).toBeGreaterThanOrEqual(5);
    expect(typical).toBeLessThanOrEqual(10);
    expect(preset / typical).toBeCloseTo(2.7, 1);
    // the campaign's ranges: 450–1000 kA, B0 0.42–0.64 T, κ 2.0–2.2, δ 0.3–0.5 (the triangularity is not given in the paper: the preset's 0.5 and 0.3)
    const all: number[] = [];
    for (const kappa of [2.0, 2.2]) for (const delta of [0.3, 0.5]) for (const B0 of [0.42, 0.64]) for (const Ip of [0.45, 1.0]) {
      all.push(q({ R: 0.8, a: 0.5, kappa, delta }, B0, Ip));
    }
    expect(Math.min(...all)).toBeCloseTo(3.1, 1);
    expect(Math.max(...all)).toBeCloseTo(13.6, 1);
    for (const n of ['18.2', '6.6', '3.1–13.6', '2.7']) expect(c.knownFailure, n).toContain(n);
  });

  it('for a mid-range point of the campaign (750 kA, 0.53 T) the fit gives a q95 inside the published band', () => {
    const mid = q({ R: 0.8, a: 0.5, kappa: 2.1, delta: 0.4 }, 0.53, 0.75);
    expect(mid).toBeGreaterThan(5);
    expect(mid).toBeLessThan(10);
  });
});

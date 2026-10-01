/**
 * Tritium breeding ratio (lane ws7b): the published fit of Shimwell et al. 2016 reproduces the maxima of its Table 4; the depth
 * and enrichment dependence, the optimum, the coverage scaling and the other blanket types.
 */
import { describe, expect, it } from 'vitest';
import {
  SHIMWELL_DEPTH, SHIMWELL_OUT_IN, TBR_COVERAGE_REF, TBR_DEPTH_LAMBDA, depthInFittedRange, optimalBreederFraction, shimwellTBR, tbrHCPB,
  tbrUnpenetrated, tritiumBreedingRatio,
} from './breeding';

/** grid maximum over the breeder fraction */
function gridMax(cls: 'thin' | 'medium' | 'thick', y: number): { tbr: number; x: number } {
  let best = -Infinity, bx = 0;
  for (let x = 0.06; x <= 1.00001; x += 0.002) { const t = shimwellTBR(cls, x, y); if (t > best) { best = t; bx = x; } }
  return { tbr: best, x: bx };
}

describe('Shimwell et al. (2016) fit', () => {
  it('reproduces the maximum TBR of its Table 4 (thin 1.247, medium 1.261, thick 1.264 at 100 % 6Li)', () => {
    expect(gridMax('thin', 1).tbr).toBeCloseTo(1.247, 3);
    expect(gridMax('medium', 1).tbr).toBeCloseTo(1.261, 3);
    expect(gridMax('thick', 1).tbr).toBeCloseTo(1.264, 3);
  });

  it('the tritium-optimal breeder fraction is the maximum of the fit, near 0.2 at full enrichment and larger at low enrichment', () => {
    for (const y of [0.1, 0.2, 0.4, 0.6, 0.8, 1]) {
      const x = optimalBreederFraction(y);
      const g = gridMax('thick', y);
      expect(Math.abs(x - g.x)).toBeLessThan(0.01);
      expect(tbrHCPB(y, 1.1)).toBeGreaterThanOrEqual(g.tbr - 1e-4);
      expect(x).toBeGreaterThanOrEqual(0.06);
      expect(x).toBeLessThanOrEqual(1);
    }
    expect(optimalBreederFraction(1)).toBeCloseTo(0.21, 1);
    expect(optimalBreederFraction(0.1)).toBeGreaterThan(optimalBreederFraction(1));
  });

  it('the TBR at the optimum rises with the enrichment and is below 1 at 10 % 6Li but breeds at 30 % and more', () => {
    let prev = 0;
    for (let y = 0.1; y <= 1.0001; y += 0.05) { const t = tbrHCPB(y, 1.1); expect(t).toBeGreaterThan(prev); prev = t; }
    expect(tbrHCPB(0.1, 1.1)).toBeLessThan(1);
    expect(tbrHCPB(0.3, 1.1)).toBeGreaterThan(1.05);
    // the paper's recommended design target of 1.15 is reached at 60 % 6Li in every thickness class
    for (const s of [0.72, 0.875, 1.025]) expect(tbrHCPB(0.6, s)).toBeGreaterThan(1.15);
  });

  it('at the minimum 6Li enrichment of Table 4 for tritium self-sufficiency (thin 16.4 %, medium 14.9 %, thick 14.2 %) the optimal TBR is 1.00, not the 1.25 of full enrichment', () => {
    // y < 1: the maxima above are all at 100 % 6Li. Self-sufficiency needs a time-averaged TBR just above 1 (the paper's criterion
    // includes burn-up and decay), which the surface reaches at exactly these enrichments: 1.0047, 1.0045, 1.0040.
    for (const [cls, y] of [['thin', 0.164], ['medium', 0.149], ['thick', 0.142]] as const) {
      const t = gridMax(cls, y).tbr;
      expect(t, cls).toBeGreaterThan(1.0);
      expect(t, cls).toBeLessThan(1.01);
      expect(tbrHCPB(y, { thin: SHIMWELL_DEPTH.thin, medium: SHIMWELL_DEPTH.medium, thick: SHIMWELL_DEPTH.thick }[cls])).toBeCloseTo(t, 3);
    }
    // less enrichment than that does not breed, more does
    expect(gridMax('thick', 0.12).tbr).toBeLessThan(1);
    expect(gridMax('thick', 0.2).tbr).toBeGreaterThan(1.03);
  });

  it('the fit is clamped to its range: 6Li below 10 % and breeder fractions outside 0.06-1 give the edge values', () => {
    expect(shimwellTBR('thin', 0.5, 0.05)).toBe(shimwellTBR('thin', 0.5, 0.1));
    expect(shimwellTBR('thin', 0.001, 0.5)).toBe(shimwellTBR('thin', 0.06, 0.5));
    expect(shimwellTBR('thick', 5, 0.5)).toBe(shimwellTBR('thick', 1, 0.5));
  });
});

describe('blanket depth', () => {
  it('is continuous at the class boundaries, monotone, and saturates above the thick class', () => {
    const y = 0.6;
    expect(tbrHCPB(y, SHIMWELL_DEPTH.thin)).toBeCloseTo(shimwellTBR('thin', optimalBreederFraction(y), y), 12);
    expect(tbrHCPB(y, SHIMWELL_DEPTH.medium)).toBeCloseTo(shimwellTBR('medium', optimalBreederFraction(y), y), 12);
    expect(tbrHCPB(y, SHIMWELL_DEPTH.thick)).toBeCloseTo(shimwellTBR('thick', optimalBreederFraction(y), y), 12);
    let prev = 0;
    for (let s = 0.1; s <= 1.3; s += 0.02) { const t = tbrHCPB(y, s); expect(t).toBeGreaterThanOrEqual(prev - 1e-12); prev = t; }
    expect(tbrHCPB(y, 2)).toBe(tbrHCPB(y, 1.025));
    // a blanket of no depth breeds nothing
    expect(tbrHCPB(y, 0.01)).toBeLessThan(0.2 * tbrHCPB(y, 0.72));
  });

  it('the saturation depth reproduces the depth trend of Table 4 of the paper within 0.3 %', () => {
    const g = (s: number) => 1 - Math.exp(-s / TBR_DEPTH_LAMBDA);
    expect(g(SHIMWELL_DEPTH.medium) / g(SHIMWELL_DEPTH.thin)).toBeCloseTo(1.261 / 1.247, 2);
    expect(g(SHIMWELL_DEPTH.thick) / g(SHIMWELL_DEPTH.thin)).toBeCloseTo(1.264 / 1.247, 2);
  });

  it('the mean depths are those of Table 1 (inboard 0.53/0.64/0.75 m, outboard 0.91/1.11/1.30 m)', () => {
    expect(SHIMWELL_DEPTH.thin).toBeCloseTo((0.53 + 0.91) / 2, 12);
    expect(SHIMWELL_DEPTH.medium).toBeCloseTo((0.64 + 1.11) / 2, 12);
    expect(SHIMWELL_DEPTH.thick).toBeCloseTo((0.75 + 1.3) / 2, 12);
    expect(SHIMWELL_OUT_IN).toBeCloseTo(0.91 / 0.53, 1);
    expect(depthInFittedRange(0.8)).toBe(true);
    expect(depthInFittedRange(0.5)).toBe(false);
    expect(depthInFittedRange(1.4)).toBe(false);
  });
});

describe('blanket types and coverage', () => {
  it('no blanket: zero', () => {
    expect(tritiumBreedingRatio('none', 0.6, 0.85)).toBe(0);
    expect(tbrUnpenetrated('none', 0.6)).toBe(0);
  });

  it('the TBR is linear in the coverage relative to the fitted model', () => {
    const full = tritiumBreedingRatio('HCPB', 0.6, TBR_COVERAGE_REF);
    expect(tritiumBreedingRatio('HCPB', 0.6, 0.45)).toBeCloseTo(0.5 * full, 12);
    expect(tritiumBreedingRatio('HCPB', 0.6, 0)).toBe(0);
    expect(full).toBeCloseTo(tbrUnpenetrated('HCPB', 0.6), 12);
  });

  it('the liquid breeders are anchored at their reference TBR at the reference enrichment and the thick blanket', () => {
    expect(tbrUnpenetrated('HCLL', 0.9, { meanDepth_m: SHIMWELL_DEPTH.thick })).toBeCloseTo(1.18, 9);
    expect(tbrUnpenetrated('WCLL', 0.9, { meanDepth_m: SHIMWELL_DEPTH.thick })).toBeCloseTo(1.15, 9);
    expect(tbrUnpenetrated('DCLL', 0.9, { meanDepth_m: SHIMWELL_DEPTH.thick })).toBeCloseTo(1.2, 9);
    expect(tbrUnpenetrated('FLiBe', 0.9, { meanDepth_m: SHIMWELL_DEPTH.thick })).toBeCloseTo(1.2, 9);
    // they follow the HCPB dependence on the enrichment and the depth
    expect(tbrUnpenetrated('HCLL', 0.5)).toBeLessThan(tbrUnpenetrated('HCLL', 0.9));
    expect(tbrUnpenetrated('WCLL', 0.9, { meanDepth_m: 0.5 })).toBeLessThan(tbrUnpenetrated('WCLL', 0.9, { meanDepth_m: 1 }));
  });

  it('a user-given breeder fraction is used, and the default is at least as good as any other', () => {
    const def = tbrUnpenetrated('HCPB', 0.6, { meanDepth_m: 0.9 });
    for (const x of [0.1, 0.5, 0.9]) expect(tbrUnpenetrated('HCPB', 0.6, { meanDepth_m: 0.9, breederFraction: x })).toBeLessThanOrEqual(def + 1e-9);
    expect(tbrUnpenetrated('HCPB', 0.6, { meanDepth_m: 0.9, breederFraction: 0.5 })).not.toBe(def);
  });

  it('the earlier three-argument call still works (thick blanket) and at the ITER/DEMO default is between the paper target and the full-model maximum', () => {
    const t = tritiumBreedingRatio('HCPB', 0.6, 0.85);
    expect(t).toBeGreaterThan(1.05);
    expect(t).toBeLessThan(1.264);
  });
});

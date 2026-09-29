import { describe, expect, it } from 'vitest';
import { ITER, ITER_15D, JET, MASTU, NIF, SPARC, W7X } from '../physics/presets';
import type { ReactorConfig } from '../physics/types';
import { DistSpec, quantile } from './distributions';
import { H98_SIGMA, PriorSet, checkPriors, choleskyLower, defaultPriors, describeParam, getPath, logScalingSigma, paramStatus, setPath, transformUnit } from './priors';
import { unitSample } from './samplers';
import { mean, pearson, sd } from './stats';

describe('configuration paths', () => {
  it('getPath reads nested values and returns undefined for a missing segment', () => {
    expect(getPath(ITER, 'H98')).toBe(1);
    expect(getPath(ITER, 'impurity.concentration')).toBe(0.02);
    expect(getPath(ITER, 'geometry.R')).toBe(6.2);
    expect(getPath(ITER, 'impurity.nope')).toBeUndefined();
    expect(getPath(ITER, 'nope.deeper')).toBeUndefined();
    expect(getPath(ITER, 'H98.x')).toBeUndefined();
    expect(getPath(SPARC, 'impurity.seedConcentration')).toBeUndefined();
    expect(getPath(null, 'a')).toBeUndefined();
  });

  it('setPath returns a modified copy and leaves the original alone, sharing the untouched branches', () => {
    const before = JSON.stringify(ITER);
    const c = setPath(ITER, 'impurity.concentration', 0.05);
    expect(c.impurity.concentration).toBe(0.05);
    expect(c.impurity.species).toBe(ITER.impurity.species);
    expect(ITER.impurity.concentration).toBe(0.02);
    expect(JSON.stringify(ITER)).toBe(before);
    expect(c.geometry).toBe(ITER.geometry); // shared, not copied
    expect(c.impurity).not.toBe(ITER.impurity);
    expect(setPath(ITER, 'H98', 1.2).H98).toBe(1.2);
    // an optional field can be created
    expect(setPath(SPARC, 'impurity.seedConcentration', 1e-3).impurity.seedConcentration).toBe(1e-3);
    expect(() => setPath(ITER, 'H98.x.y', 1)).toThrow(/not an object/);
    expect(() => setPath(ITER, 'nope.x', 1)).toThrow(/not an object/);
  });
});

describe('parameters of the 1.5D profile model', () => {
  it('a numeric profile setting of a 1.5D configuration is a parameter, with the default as its nominal value', () => {
    expect(paramStatus(ITER_15D, 'profiles.pedestalWidth')).toEqual({ ok: true, nominal: 0.06 });
    expect(paramStatus(ITER_15D, 'profiles.elmFraction')).toEqual({ ok: true, nominal: 0.35 });
    expect(paramStatus({ ...ITER_15D, profiles: { pedestalWidth: 0.08 } }, 'profiles.pedestalWidth')).toEqual({ ok: true, nominal: 0.08 });
    expect(paramStatus(ITER_15D, 'profiles.lcfsKappa')).toEqual({ ok: true, nominal: 1.85 }); // set by the preset
    // not a parameter: a 0D configuration, an unknown key, a string setting, a key without a default, a deeper path
    expect(paramStatus(ITER, 'profiles.pedestalWidth').ok).toBe(false);
    expect(paramStatus(ITER_15D, 'profiles.nope').ok).toBe(false);
    expect(paramStatus(ITER_15D, 'profiles.transportModel').ok).toBe(false);
    expect(paramStatus(ITER_15D, 'profiles.Tsep_keV').ok).toBe(false);
    expect(paramStatus(ITER_15D, 'profiles.pedestalWidth.x').ok).toBe(false);
    expect(paramStatus(SPARC, 'impurity.seedConcentration')).toEqual({ ok: true, nominal: null });
    expect(paramStatus(ITER, 'H98')).toEqual({ ok: true, nominal: 1 });
  });

  it('setPath creates the missing profiles object on request only; checkPriors accepts the setting and describeParam shows the default', () => {
    expect(() => setPath(ITER_15D, 'nope.pedestalWidth', 0.1)).toThrow(/not an object/);
    const noProfiles = { ...ITER_15D, profiles: undefined };
    expect(() => setPath(noProfiles, 'profiles.pedestalWidth', 0.1)).toThrow(/not an object/);
    const c = setPath(noProfiles, 'profiles.pedestalWidth', 0.1, { createMissing: true });
    expect(c.profiles).toEqual({ pedestalWidth: 0.1 });
    const d = setPath(ITER_15D, 'profiles.pedestalWidth', 0.1);
    expect(d.profiles).toEqual({ lcfsKappa: 1.85, lcfsDelta: 0.49, pedestalWidth: 0.1 }); // the other settings are kept
    const priors: PriorSet = { params: [{ path: 'profiles.pedestalWidth', dist: { type: 'lognormal', median: 0.06, sigmaLog: 0.3 } }] };
    expect(() => checkPriors(ITER_15D, priors)).not.toThrow();
    expect(() => checkPriors(ITER, priors)).toThrow(/is not a number of the tokamak configuration/);
    expect(describeParam(ITER_15D, priors.params[0]).nominal).toBe(0.06);
  });
});

const LN = (median: number, sigmaLog: number): DistSpec => ({ type: 'lognormal', median, sigmaLog });

describe('checkPriors', () => {
  it('accepts numeric paths and the optional fields of the configuration types', () => {
    expect(() => checkPriors(ITER, { params: [{ path: 'H98', dist: LN(1, 0.1) }, { path: 'impurity.seedConcentration', dist: LN(1e-3, 0.5) }] })).not.toThrow();
    // SPARC has no seed impurity, but the field is a valid optional one
    expect(() => checkPriors(SPARC, { params: [{ path: 'impurity.seedConcentration', dist: LN(1e-3, 0.5) }] })).not.toThrow();
  });

  it('rejects unknown, non-numeric and duplicate paths and invalid distributions', () => {
    expect(() => checkPriors(ITER, { params: [{ path: 'H99', dist: LN(1, 0.1) }] })).toThrow(/'H99' is not a number of the tokamak configuration/);
    expect(() => checkPriors(ITER, { params: [{ path: 'impurity.species', dist: LN(1, 0.1) }] })).toThrow(/'impurity.species' is not a number/);
    expect(() => checkPriors(ITER, { params: [{ path: 'geometry', dist: LN(1, 0.1) }] })).toThrow(/is not a number/);
    expect(() => checkPriors(ITER, { params: [{ path: 'H98', dist: LN(1, 0.1) }, { path: 'H98', dist: LN(1, 0.2) }] })).toThrow(/listed twice/);
    expect(() => checkPriors(ITER, { params: [{ path: 'H98', dist: { type: 'uniform', lo: 2, hi: 1 } }] })).toThrow(/must exceed lo/);
    // a typo in a path that is not one of the optional fields is not created silently
    expect(() => checkPriors(ITER, { params: [{ path: 'impurity.seedConcentraton', dist: LN(1, 0.1) }] })).toThrow(/is not a number/);
  });

  it('validates the correlation groups', () => {
    const params = [{ path: 'H98', dist: LN(1, 0.1) }, { path: 'n_target', dist: LN(1e20, 0.1) }];
    const ok: PriorSet = { params, correlations: [{ paths: ['H98', 'n_target'], matrix: [[1, 0.5], [0.5, 1]] }] };
    expect(() => checkPriors(ITER, ok)).not.toThrow();
    expect(() => checkPriors(ITER, { params, correlations: [{ paths: ['H98', 'zzz'], matrix: [[1, 0.5], [0.5, 1]] }] })).toThrow(/'zzz' has no prior/);
    expect(() => checkPriors(ITER, { params, correlations: [{ paths: ['H98', 'H98'], matrix: [[1, 0.5], [0.5, 1]] }] })).toThrow(/lists a parameter twice/);
    expect(() => checkPriors(ITER, { params, correlations: [{ paths: ['H98', 'n_target'], matrix: [[1]] }] })).toThrow(/must be 2 x 2/);
    expect(() => checkPriors(ITER, { params, correlations: [{ paths: ['H98', 'n_target'], matrix: [[1, 1], [1, 1]] }] })).toThrow(/not positive definite/);
  });
});

describe('Cholesky factor of a correlation matrix', () => {
  it('matches hand-worked factors', () => {
    expect(choleskyLower([[1, 0.6], [0.6, 1]])).toEqual([[1, 0], [0.6, 0.8]]);
    const L = choleskyLower([[1, 0.5, 0.2], [0.5, 1, -0.3], [0.2, -0.3, 1]]);
    // L L^T reproduces the matrix
    const M = [[1, 0.5, 0.2], [0.5, 1, -0.3], [0.2, -0.3, 1]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += L[i][k] * L[j][k];
      expect(s).toBeCloseTo(M[i][j], 14);
    }
    expect(L[0][1]).toBe(0);
  });

  it('rejects matrices that are not correlation matrices', () => {
    expect(() => choleskyLower([[2, 0], [0, 1]])).toThrow(/diagonal entry 0 is 2/);
    expect(() => choleskyLower([[1, 0.3], [0.4, 1]])).toThrow(/not symmetric/);
    expect(() => choleskyLower([[1, 1.5], [1.5, 1]])).toThrow(/not in \[-1, 1\]/);
    expect(() => choleskyLower([[1, NaN], [NaN, 1]])).toThrow(/not in \[-1, 1\]/);
    expect(() => choleskyLower([[1, 0.9, -0.9], [0.9, 1, 0.9], [-0.9, 0.9, 1]])).toThrow(/not positive definite/);
  });
});

describe('transformUnit', () => {
  it('maps independent parameters through their quantile functions', () => {
    const priors: PriorSet = { params: [{ path: 'H98', dist: LN(1, 0.14) }, { path: 'n_target', dist: { type: 'uniform', lo: 1, hi: 3 } }] };
    const V = transformUnit(Float64Array.from([0.5, 0.25, 0.975, 0.75]), priors);
    expect(V[0]).toBeCloseTo(1, 12);
    expect(V[1]).toBe(1.5);
    expect(V[2]).toBeCloseTo(Math.exp(0.14 * 1.959963984540054), 12);
    expect(V[3]).toBe(2.5);
  });

  it('a Gaussian copula produces the requested correlation and keeps the marginals', () => {
    const n = 20000;
    const priors: PriorSet = {
      params: [
        { path: 'H98', dist: { type: 'normal', mean: 1, sd: 0.1 } },
        { path: 'n_target', dist: { type: 'normal', mean: 5, sd: 2 } },
        { path: 'transport.alpha_n', dist: { type: 'uniform', lo: 0, hi: 1 } },
      ],
      correlations: [{ paths: ['H98', 'n_target'], matrix: [[1, 0.7], [0.7, 1]] }],
    };
    const V = transformUnit(unitSample('mc', n, 3, { seed: 5 }), priors);
    const col = (j: number) => Array.from({ length: n }, (_, i) => V[i * 3 + j]);
    expect(pearson(col(0), col(1))).toBeCloseTo(0.7, 1);
    expect(Math.abs(pearson(col(0), col(2)))).toBeLessThan(0.03);
    expect(mean(col(0))).toBeCloseTo(1, 2);
    expect(sd(col(0))).toBeCloseTo(0.1, 2);
    expect(mean(col(1))).toBeCloseTo(5, 1);
    expect(sd(col(1))).toBeCloseTo(2, 1);
    // the uncorrelated parameter is exactly its own quantile of the unit sample
    const U = unitSample('mc', 4, 3, { seed: 5 });
    const W = transformUnit(U, priors);
    for (let i = 0; i < 4; i++) expect(W[i * 3 + 2]).toBe(quantile({ type: 'uniform', lo: 0, hi: 1 }, U[i * 3 + 2]));
  });
});

describe('scaling uncertainty from a coefficient covariance', () => {
  it('sigma of ln tau_E is sqrt(v^T C v) with v = (1, ln x_1 ... ln x_m)', () => {
    // independent coefficients with variances 0.04 (ln C), 0.01 and 0.0025 (two exponents)
    const cov = [[0.04, 0, 0], [0, 0.01, 0], [0, 0, 0.0025]];
    expect(logScalingSigma(cov, [2, 3])).toBeCloseTo(Math.sqrt(0.04 + 4 * 0.01 + 9 * 0.0025), 14);
    // a perfect anti-correlation between ln C and the first exponent cancels the uncertainty at x = 1/ (ln x = 1) ...
    const anti = [[0.04, -0.04, 0], [-0.04, 0.04, 0], [0, 0, 0]];
    expect(logScalingSigma(anti, [1, 5])).toBeCloseTo(0, 7);
    expect(() => logScalingSigma(cov, [2])).toThrow(/must be 2 x 2/);
    expect(() => logScalingSigma([[1, 0], [0, -1]], [2])).toThrow(/not positive semi-definite/);
  });

  it('the published prediction uncertainties are the H98 prior widths', () => {
    expect(H98_SIGMA.ipb98y2).toBe(0.14);
    expect(H98_SIGMA.itpa20il).toBeCloseTo(0.44 / 2.79, 12);
  });
});

describe('default priors', () => {
  it('ITER: H98, density, impurity and seed impurity, He ash ratio and the two disruption limits, centred on the preset', () => {
    const p = defaultPriors(ITER);
    expect(p.params.map((x) => x.path)).toEqual([
      'H98', 'n_target', 'impurity.concentration', 'impurity.seedConcentration', 'transport.tau_He_over_tau_E', 'limits.betaN_limit', 'limits.greenwald_limit',
    ]);
    expect(() => checkPriors(ITER, p)).not.toThrow();
    for (const x of p.params) {
      expect(x.dist.type).toBe('lognormal');
      expect(quantile(x.dist, 0.5), x.path).toBeCloseTo(getPath(ITER, x.path) as number, 12);
      expect(x.basis, x.path).toBeTruthy();
    }
    const h = p.params[0].dist as Extract<DistSpec, { type: 'lognormal' }>;
    expect(h.sigmaLog).toBe(0.14);
    expect(p.params[0].basis).toMatch(/IPB98\(y,2\).*Nucl\. Fusion 39 \(1999\) 2175/);
  });

  it('a configuration without a seeded impurity gets no seed prior; the ITPA20-IL width can be chosen', () => {
    const p = defaultPriors(JET, { h98: 'itpa20il' });
    expect(p.params.map((x) => x.path)).not.toContain('impurity.seedConcentration');
    expect((p.params[0].dist as { sigmaLog: number }).sigmaLog).toBeCloseTo(0.44 / 2.79, 12);
    expect(p.params[0].basis).toMatch(/Verdoolaege.*076006/);
    expect(quantile(p.params[0].dist, 0.5)).toBeCloseTo(JET.H98, 12);
  });

  it('a spherical tokamak gets the tokamak set; a stellarator no tokamak limits, and its ISS04 multiplier when given', () => {
    expect(defaultPriors(MASTU).params.map((x) => x.path)).toContain('limits.betaN_limit');
    const w = defaultPriors(W7X);
    expect(w.params.map((x) => x.path)).toEqual(['H98', 'n_target', 'impurity.concentration', 'transport.tau_He_over_tau_E']);
    expect(() => checkPriors(W7X, w)).not.toThrow();
    const w2: ReactorConfig = { ...W7X, stellarator: { ...W7X.stellarator, H_ISS04: 1.1 } };
    expect(defaultPriors(w2).params[0].path).toBe('stellarator.H_ISS04');
    expect(() => checkPriors(w2, defaultPriors(w2))).not.toThrow();
  });

  it('non-magnetic configurations have no default priors', () => {
    expect(() => defaultPriors(NIF)).toThrow(/no default priors for 'icf_indirect'/);
  });

  it('describeParam reports the nominal value, the prior median and the 90 % interval', () => {
    const d = describeParam(ITER, { path: 'H98', dist: LN(1, 0.14), basis: 'b' });
    expect(d.nominal).toBe(1);
    expect(d.prior.median).toBeCloseTo(1, 12);
    expect(d.prior.p05).toBeCloseTo(Math.exp(-0.14 * 1.6448536269514722), 10);
    expect(d.basis).toBe('b');
    expect(describeParam(SPARC, { path: 'impurity.seedConcentration', dist: LN(1e-3, 0.5) }).nominal).toBeNull();
  });
});

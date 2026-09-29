import { describe, expect, it } from 'vitest';
import {
  DistSpec, cdf, clampUnit, erf, erfc, normalCdf, normalPdf, normalQuantile, parseDist, quantile, summarizeDist, validateDist,
} from './distributions';

/*
 * Reference values below come from the C library erf/erfc and Wichura's algorithm AS241 (Python's math.erf,
 * math.erfc and statistics.NormalDist.inv_cdf), i.e. from independent implementations, not from this module.
 */
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('error function and the standard normal law', () => {
  it('erf matches reference values on both sides of the series/fraction switch', () => {
    const ref: [number, number][] = [
      [0.1, 0.1124629160182849], [0.5, 0.5204998778130465], [1, 0.8427007929497149], [1.5, 0.9661051464753108],
      [2, 0.9953222650189527], [2.4999, 0.9995928300996666], [2.5, 0.999593047982555], [2.5001, 0.9995932657565293],
      [3, 0.9999779095030014], [4, 0.9999999845827421], [5, 0.9999999999984626], [6, 1],
    ];
    for (const [x, v] of ref) {
      expect(Math.abs(erf(x) - v), `erf(${x})`).toBeLessThan(2e-15);
      expect(Math.abs(erf(-x) + v), `erf(-${x})`).toBeLessThan(2e-15);
    }
    expect(erf(0)).toBe(0);
    expect(erf(NaN)).toBeNaN();
  });

  it('erfc is accurate in the far tail (relative error), and erfc(-x) = 2 - erfc(x)', () => {
    const ref: [number, number][] = [
      [0.1, 0.8875370839817152], [0.5, 0.4795001221869534], [1, 0.1572992070502851], [1.5, 0.033894853524689274],
      [2, 0.004677734981047265], [2.4999, 0.0004071699003334513], [2.5, 0.000406952017444959], [2.5001, 0.0004067342434706797],
      [3, 2.209049699858544e-05], [4, 1.5417257900280017e-08], [5, 1.5374597944280351e-12], [6, 2.1519736712498913e-17],
      [8, 1.1224297172982929e-29], [10, 2.088487583762545e-45],
    ];
    for (const [x, v] of ref) expect(rel(erfc(x), v), `erfc(${x})`).toBeLessThan(2e-15);
    expect(erfc(-1)).toBeCloseTo(2 - 0.1572992070502851, 14);
    expect(erfc(NaN)).toBeNaN();
    // the two branches agree at their switch point
    expect(Math.abs(erfc(1 - 1e-12) - erfc(1 + 1e-12))).toBeLessThan(1e-11);
  });

  it('normalCdf and normalPdf', () => {
    const ref: [number, number][] = [
      [-8, 6.220960574271819e-16], [-5, 2.8665157187919455e-07], [-3, 0.0013498980316300959], [-1, 0.15865525393145707],
      [0, 0.5], [0.5, 0.691462461274013], [2, 0.9772498680518209], [4, 0.9999683287581669],
    ];
    for (const [z, v] of ref) expect(rel(normalCdf(z), v), `Phi(${z})`).toBeLessThan(1e-13);
    expect(normalPdf(0)).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 15);
    expect(normalPdf(1)).toBeCloseTo(0.24197072451914337, 15);
  });

  it('normalQuantile inverts the CDF to full double precision, tails included', () => {
    const ref: [number, number][] = [
      [1e-15, -7.941345326170995], [1e-10, -6.361340902404056], [1e-6, -4.753424308822899], [1e-3, -3.090232306167813],
      [0.01, -2.3263478740408408], [0.025, -1.9599639845400538], [0.1, -1.2815515655446008], [0.3, -0.5244005127080407],
      [0.7, 0.5244005127080407], [0.9, 1.2815515655446008], [0.975, 1.9599639845400536], [0.999, 3.090232306167813],
    ];
    for (const [p, z] of ref) expect(rel(normalQuantile(p), z), `Phi^-1(${p})`).toBeLessThan(1e-14);
    expect(normalQuantile(0.5)).toBe(0);
    expect(normalQuantile(0)).toBe(-Infinity);
    expect(normalQuantile(1)).toBe(Infinity);
    expect(normalQuantile(-0.1)).toBeNaN();
    expect(normalQuantile(1.1)).toBeNaN();
    for (const p of [1e-12, 0.2, 0.61, 0.99]) expect(rel(normalCdf(normalQuantile(p)), p)).toBeLessThan(1e-13);
  });

  it('clampUnit keeps a unit sample strictly inside (0, 1)', () => {
    expect(clampUnit(0)).toBeGreaterThan(0);
    expect(clampUnit(1)).toBeLessThan(1);
    expect(clampUnit(0.25)).toBe(0.25);
    expect(Number.isFinite(normalQuantile(clampUnit(0)))).toBe(true);
    expect(Number.isFinite(normalQuantile(clampUnit(1)))).toBe(true);
  });
});

const SPECS: DistSpec[] = [
  { type: 'uniform', lo: -2, hi: 5 },
  { type: 'loguniform', lo: 1e-6, hi: 1e-2 },
  { type: 'normal', mean: 1.5, sd: 0.3 },
  { type: 'normal', mean: 1, sd: 0.5, lo: 0.6, hi: 2 },
  { type: 'normal', mean: 1, sd: 0.5, hi: 1.2 },
  { type: 'lognormal', median: 0.02, sigmaLog: 0.5 },
  { type: 'lognormal', median: 1, sigmaLog: 0.14, lo: 0.8, hi: 1.3 },
  { type: 'triangular', lo: 1, mode: 2, hi: 5 },
  { type: 'triangular', lo: 0, mode: 0, hi: 1 },
];

describe('distribution quantile and CDF', () => {
  it('quantile and cdf are inverse to each other and monotone', () => {
    for (const d of SPECS) {
      let prev = -Infinity;
      for (const u of [0.001, 0.05, 0.2, 0.5, 0.8, 0.95, 0.999]) {
        const x = quantile(d, u);
        expect(x, JSON.stringify(d)).toBeGreaterThan(prev);
        prev = x;
        expect(Math.abs(cdf(d, x) - u), `${JSON.stringify(d)} u=${u}`).toBeLessThan(1e-12);
      }
    }
  });

  it('known values: uniform, loguniform, normal, lognormal, triangular', () => {
    expect(quantile({ type: 'uniform', lo: 2, hi: 6 }, 0.25)).toBe(3);
    expect(quantile({ type: 'loguniform', lo: 1, hi: 100 }, 0.5)).toBeCloseTo(10, 12);
    expect(quantile({ type: 'normal', mean: 10, sd: 2 }, 0.975)).toBeCloseTo(10 + 2 * 1.959963984540054, 12);
    expect(quantile({ type: 'lognormal', median: 5, sigmaLog: 0.2 }, 0.5)).toBeCloseTo(5, 12);
    expect(quantile({ type: 'lognormal', median: 5, sigmaLog: 0.2 }, 0.975)).toBeCloseTo(5 * Math.exp(0.2 * 1.959963984540054), 12);
    // triangular(0, 1, 4): F(1) = 1/4, median = 4 - sqrt(4 * 3 * 0.5 ... ) from the closed form
    const tri: DistSpec = { type: 'triangular', lo: 0, mode: 1, hi: 4 };
    expect(cdf(tri, 1)).toBeCloseTo(0.25, 14);
    expect(quantile(tri, 0.25)).toBeCloseTo(1, 12);
    expect(quantile(tri, 0.5)).toBeCloseTo(4 - Math.sqrt(0.5 * 4 * 3), 12);
    expect(quantile({ type: 'point', value: 7 }, 0.3)).toBe(7);
    expect(cdf({ type: 'point', value: 7 }, 6.9)).toBe(0);
    expect(cdf({ type: 'point', value: 7 }, 7)).toBe(1);
  });

  it('truncation keeps every value inside the limits and renormalises the mass', () => {
    const d: DistSpec = { type: 'normal', mean: 1, sd: 0.5, lo: 0.6, hi: 2 };
    for (const u of [0, 1e-9, 0.3, 0.7, 1 - 1e-9, 1]) {
      const x = quantile(d, u);
      expect(x).toBeGreaterThanOrEqual(0.6);
      expect(x).toBeLessThanOrEqual(2);
    }
    expect(cdf(d, 0.6)).toBe(0);
    expect(cdf(d, 2)).toBe(1);
    // the mean of a symmetric truncation of a symmetric law is the centre
    const sym: DistSpec = { type: 'normal', mean: 3, sd: 1, lo: 1, hi: 5 };
    let s = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) s += quantile(sym, (i + 0.5) / n);
    expect(s / n).toBeCloseTo(3, 9);
    // lognormal truncated to [0.8, 1.3]
    const ln: DistSpec = { type: 'lognormal', median: 1, sigmaLog: 0.14, lo: 0.8, hi: 1.3 };
    expect(quantile(ln, 0)).toBeGreaterThanOrEqual(0.8);
    expect(quantile(ln, 1)).toBeLessThanOrEqual(1.3);
    expect(cdf(ln, 0.5)).toBe(0);
    expect(cdf(ln, 2)).toBe(1);
    expect(cdf({ type: 'lognormal', median: 1, sigmaLog: 0.3 }, -1)).toBe(0);
  });

  it('untruncated laws have the analytic mean and variance (midpoint rule on the quantile function)', () => {
    const N = 20000;
    const moments = (d: DistSpec) => {
      let m = 0, m2 = 0;
      for (let i = 0; i < N; i++) { const x = quantile(d, (i + 0.5) / N); m += x; m2 += x * x; }
      m /= N; m2 /= N;
      return { mean: m, sd: Math.sqrt(m2 - m * m) };
    };
    expect(moments({ type: 'uniform', lo: 0, hi: 6 }).mean).toBeCloseTo(3, 6);
    expect(moments({ type: 'uniform', lo: 0, hi: 6 }).sd).toBeCloseTo(Math.sqrt(36 / 12), 5);
    const nm = moments({ type: 'normal', mean: 2, sd: 0.5 });
    expect(nm.mean).toBeCloseTo(2, 4);
    expect(nm.sd).toBeCloseTo(0.5, 3);
    const s = 0.3, med = 2;
    const lm = moments({ type: 'lognormal', median: med, sigmaLog: s });
    expect(rel(lm.mean, med * Math.exp((s * s) / 2))).toBeLessThan(1e-3);
    const tm = moments({ type: 'triangular', lo: 1, mode: 2, hi: 6 });
    expect(tm.mean).toBeCloseTo((1 + 2 + 6) / 3, 5);
    expect(tm.sd).toBeCloseTo(Math.sqrt((1 + 4 + 36 - 2 - 6 - 12) / 18), 4);
  });

  it('summarizeDist gives the median and the central 90 % interval', () => {
    const s = summarizeDist({ type: 'normal', mean: 10, sd: 1 });
    expect(s.median).toBeCloseTo(10, 12);
    expect(s.p05).toBeCloseTo(10 - 1.6448536269514722, 10);
    expect(s.p95).toBeCloseTo(10 + 1.6448536269514722, 10);
  });
});

describe('distribution validation and parsing', () => {
  it('rejects invalid descriptions with a clear message', () => {
    const bad: [DistSpec, RegExp][] = [
      [{ type: 'uniform', lo: 1, hi: 1 }, /hi \(1\) must exceed lo/],
      [{ type: 'uniform', lo: NaN, hi: 1 }, /lo must be a finite number/],
      [{ type: 'loguniform', lo: 0, hi: 1 }, /needs 0 < lo < hi/],
      [{ type: 'normal', mean: 0, sd: 0 }, /sd must be positive/],
      [{ type: 'normal', mean: 0, sd: 1, lo: 2, hi: 1 }, /hi \(1\) must exceed lo \(2\)/],
      [{ type: 'normal', mean: 0, sd: 1, lo: 20, hi: 21 }, /no probability mass/],
      [{ type: 'normal', mean: 0, sd: 1, lo: Infinity }, /lo must be finite/],
      [{ type: 'lognormal', median: -1, sigmaLog: 0.1 }, /median must be positive/],
      [{ type: 'lognormal', median: 1, sigmaLog: 0 }, /sigmaLog must be positive/],
      [{ type: 'lognormal', median: 1, sigmaLog: 0.1, lo: -1 }, /lo must be positive/],
      [{ type: 'triangular', lo: 0, mode: 3, hi: 2 }, /lo <= mode <= hi/],
      [{ type: 'point', value: Infinity }, /value must be a finite number/],
      [{ type: 'weibull' } as unknown as DistSpec, /unknown distribution type 'weibull'/],
    ];
    for (const [d, re] of bad) expect(() => validateDist(d), JSON.stringify(d)).toThrow(re);
    for (const d of SPECS) expect(() => validateDist(d)).not.toThrow();
    expect(() => quantile({ type: 'weibull' } as unknown as DistSpec, 0.5)).toThrow(RangeError);
  });

  it('parses the colon syntax of the command line', () => {
    expect(parseDist('uniform:0:1')).toEqual({ type: 'uniform', lo: 0, hi: 1 });
    expect(parseDist(' loguniform:1e-6:1e-2 ')).toEqual({ type: 'loguniform', lo: 1e-6, hi: 1e-2 });
    expect(parseDist('normal:1:0.1')).toEqual({ type: 'normal', mean: 1, sd: 0.1 });
    expect(parseDist('normal:1:0.1:0.5:1.5')).toEqual({ type: 'normal', mean: 1, sd: 0.1, lo: 0.5, hi: 1.5 });
    expect(parseDist('normal:1:0.1:-:1.5')).toEqual({ type: 'normal', mean: 1, sd: 0.1, hi: 1.5 });
    expect(parseDist('lognormal:1:0.14')).toEqual({ type: 'lognormal', median: 1, sigmaLog: 0.14 });
    expect(parseDist('lognormal:1:0.14:0.5:-')).toEqual({ type: 'lognormal', median: 1, sigmaLog: 0.14, lo: 0.5 });
    expect(parseDist('triangular:0:1:4')).toEqual({ type: 'triangular', lo: 0, mode: 1, hi: 4 });
    expect(parseDist('point:3.5')).toEqual({ type: 'point', value: 3.5 });
  });

  it('rejects malformed distribution strings', () => {
    expect(() => parseDist('gamma:1:2')).toThrow(/unknown name 'gamma'/);
    expect(() => parseDist('uniform:1')).toThrow(/takes 2 arguments, got 1/);
    expect(() => parseDist('normal:1')).toThrow(/takes 2 to 4 arguments, got 1/);
    expect(() => parseDist('uniform:a:1')).toThrow(/lo 'a' is not a finite number/);
    expect(() => parseDist('uniform::1')).toThrow(/is not a finite number/);
    expect(() => parseDist('uniform:2:1')).toThrow(/must exceed lo/);
  });
});

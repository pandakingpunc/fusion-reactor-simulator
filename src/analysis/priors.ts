/**
 * Priors of a UQ study: which numbers of a reactor configuration are uncertain, and how. A parameter is addressed by a
 * dotted path into the configuration ('H98', 'impurity.concentration', 'transport.tau_He_over_tau_E'); its prior is a
 * {@link DistSpec}. Correlated parameters are modelled with a Gaussian copula: the unit-cube samples are transformed to
 * standard normals, correlated with the Cholesky factor of the correlation matrix, and mapped back through the
 * marginals (so any marginal law can be correlated; the rank correlation is that of the copula).
 *
 * Default priors of a magnetic-confinement preset ({@link defaultPriors}). Each entry states its basis. The width of the
 * confinement prior is a literature number; the rest are ASSUMPTIONS (expert-judgement widths, not measured
 * uncertainties) and are meant to be replaced by the user's own with --param:
 *  - H98, lognormal with sigma_ln = 0.14. The IPB98(y,2) regression has a root-mean-square error of about 14 % on its
 *    database, and its ITER prediction tau_E,th = 3.7 s is quoted with a one-standard-deviation error of +-14 %
 *    (ITER Physics Basis Editors, Nucl. Fusion 39 (1999) 2175, chapter 2; the same numbers for ITER-FEAT in
 *    IAEA-CN-77/ITERP/05, 2001). The alternative sigma_ln = 0.158 is the
 *    relative one-sigma uncertainty of the ITPA20-IL prediction for ITER, tau_E,th = 2.79 +- 0.44 s (G. Verdoolaege et al.,
 *    Nucl. Fusion 61 (2021) 076006, abstract).
 *  - ITPA20 covariance. The paper's covariance matrix of the regression coefficients is not part of the open text (only the
 *    standard errors of the exponents and the ITER prediction are), so the coefficients are NOT sampled: sampling them
 *    independently from their standard errors would ignore the strong anti-correlations of the regressors and give a
 *    prediction uncertainty far above the published 16 %. The published prediction uncertainty enters as the width of
 *    the H98 prior instead. {@link CorrelationSpec} takes the covariance as soon as it is available (see
 *    {@link logScalingSigma}).
 *  - density n_target (lognormal, sigma_ln 0.10), impurity fraction (0.5), seeded impurity fraction (0.5), He ash confinement
 *    ratio tau_He/tau_E (0.25), beta_N and Greenwald limits of the disruption model (0.08): ASSUMPTIONS.
 *
 * Pure TypeScript, no DOM or Node API.
 */
import type { ReactorConfig } from '../physics/types';
import { DistSpec, clampUnit, normalCdf, normalQuantile, quantile, summarizeDist, validateDist } from './distributions';

export interface ParamSpec {
  /** dotted path into the configuration, e.g. 'impurity.concentration' */
  path: string;
  dist: DistSpec;
  /** where the width of the prior comes from (literature reference or "ASSUMPTION ...") */
  basis?: string;
}

/** A Gaussian copula among some of the parameters: `matrix` is their correlation matrix (symmetric, unit diagonal, positive definite). */
export interface CorrelationSpec {
  paths: string[];
  matrix: number[][];
}

export interface PriorSet {
  params: ParamSpec[];
  correlations?: CorrelationSpec[];
}

/** Paths that are allowed although the base configuration does not define them (optional fields of the configuration types). */
const OPTIONAL_PATHS: readonly string[] = ['impurity.seedConcentration', 'stellarator.H_ISS04'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Value at a dotted path, or undefined if a segment is missing. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (!isRecord(cur) || !Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * A copy of `obj` with the number at `path` replaced: the objects along the path are copied, everything else is
 * shared with the original (which is left untouched).
 */
export function setPath<T>(obj: T, path: string, value: number): T {
  const keys = path.split('.');
  const rec = (node: unknown, i: number): unknown => {
    if (!isRecord(node)) throw new RangeError(`cannot set '${path}': '${keys.slice(0, i).join('.')}' is not an object`);
    return { ...node, [keys[i]]: i === keys.length - 1 ? value : rec(node[keys[i]], i + 1) };
  };
  return rec(obj, 0) as T;
}

/** Throws RangeError unless every parameter addresses a number of the configuration (or an optional field) and has a valid prior. */
export function checkPriors(cfg: ReactorConfig, priors: PriorSet): void {
  const seen = new Set<string>();
  for (const p of priors.params) {
    if (seen.has(p.path)) throw new RangeError(`parameter '${p.path}' is listed twice`);
    seen.add(p.path);
    const v = getPath(cfg, p.path);
    const parent = getPath(cfg, p.path.split('.').slice(0, -1).join('.'));
    const optional = v === undefined && OPTIONAL_PATHS.includes(p.path) && isRecord(parent);
    if (!optional && !(typeof v === 'number' && Number.isFinite(v))) {
      throw new RangeError(`parameter '${p.path}' is not a number of the ${cfg.method} configuration`);
    }
    validateDist(p.dist);
  }
  for (const c of priors.correlations ?? []) {
    const n = c.paths.length;
    for (const path of c.paths) if (!seen.has(path)) throw new RangeError(`correlated parameter '${path}' has no prior`);
    if (new Set(c.paths).size !== n) throw new RangeError('a correlation group lists a parameter twice');
    if (c.matrix.length !== n || c.matrix.some((r) => r.length !== n)) throw new RangeError(`the correlation matrix of ${c.paths.join(', ')} must be ${n} x ${n}`);
    choleskyLower(c.matrix); // throws unless symmetric positive definite with unit diagonal
  }
}

/**
 * Lower Cholesky factor L (L L^T = M) of a correlation matrix. Throws RangeError unless M is symmetric with unit diagonal,
 * entries in [-1, 1] and positive definite.
 */
export function choleskyLower(M: readonly (readonly number[])[]): number[][] {
  const n = M.length;
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    if (Math.abs(M[i][i] - 1) > 1e-12) throw new RangeError(`correlation matrix: diagonal entry ${i} is ${M[i][i]}, not 1`);
    for (let j = 0; j <= i; j++) {
      if (!Number.isFinite(M[i][j]) || Math.abs(M[i][j]) > 1 + 1e-12) throw new RangeError(`correlation matrix: entry (${i}, ${j}) = ${M[i][j]} is not in [-1, 1]`);
      if (Math.abs(M[i][j] - M[j][i]) > 1e-12) throw new RangeError(`correlation matrix: not symmetric at (${i}, ${j})`);
      let s = M[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(s > 1e-12)) throw new RangeError('correlation matrix: not positive definite');
        L[i][i] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  return L;
}

/**
 * Maps unit-cube rows (row-major, one column per parameter in the order of `priors.params`) to parameter values:
 * independent parameters through their quantile functions, correlated groups through the Gaussian copula.
 */
export function transformUnit(U: Float64Array, priors: PriorSet): Float64Array {
  const d = priors.params.length;
  const out = new Float64Array(U.length);
  const col = new Map(priors.params.map((p, i) => [p.path, i]));
  const groups = (priors.correlations ?? []).map((c) => ({ idx: c.paths.map((p) => col.get(p)!), L: choleskyLower(c.matrix) }));
  const inGroup = new Set(groups.flatMap((g) => g.idx));
  const z = new Float64Array(d);
  for (let r = 0; r < U.length; r += d) {
    for (let c = 0; c < d; c++) {
      if (!inGroup.has(c)) out[r + c] = quantile(priors.params[c].dist, U[r + c]);
    }
    for (const g of groups) {
      const k = g.idx.length;
      for (let a = 0; a < k; a++) z[a] = normalQuantile(clampUnit(U[r + g.idx[a]]));
      for (let a = 0; a < k; a++) {
        let s = 0;
        for (let b = 0; b <= a; b++) s += g.L[a][b] * z[b];
        out[r + g.idx[a]] = quantile(priors.params[g.idx[a]].dist, normalCdf(s));
      }
    }
  }
  return out;
}

/**
 * Standard deviation of ln(tau_E) of a power-law scaling tau_E = C prod x_k^e_k at a machine point, from the covariance
 * `cov` of the fitted parameters (ln C, e_1 ... e_m): sigma^2 = v^T cov v with v = (1, ln x_1 ... ln x_m). This is how the
 * covariance of a scaling regression (e.g. ITPA20) turns into the width of an H-factor prior.
 */
export function logScalingSigma(cov: readonly (readonly number[])[], lnX: readonly number[]): number {
  const v = [1, ...lnX];
  if (cov.length !== v.length || cov.some((r) => r.length !== v.length)) throw new RangeError(`covariance must be ${v.length} x ${v.length} (ln C and ${lnX.length} exponents)`);
  let s = 0, scale = 0;
  for (let i = 0; i < v.length; i++) for (let j = 0; j < v.length; j++) { const t = v[i] * cov[i][j] * v[j]; s += t; scale += Math.abs(t); }
  if (!(s >= -1e-12 * scale)) throw new RangeError('covariance matrix is not positive semi-definite along this direction');
  return Math.sqrt(Math.max(s, 0));
}

/** The relative prediction uncertainty of the confinement scalings, as used for the H98 prior width (see the file header). */
export const H98_SIGMA = {
  /** IPB98(y,2): RMSE about 14 % (ITER Physics Basis 1999, chapter 2) */
  ipb98y2: 0.14,
  /** ITPA20-IL: 0.44 s / 2.79 s (Verdoolaege et al. 2021) */
  itpa20il: 0.44 / 2.79,
} as const;

export interface DefaultPriorOptions {
  /** width of the H98 prior: 'ipb98y2' (default) or 'itpa20il' */
  h98?: keyof typeof H98_SIGMA;
}

const lognormal = (median: number, sigmaLog: number): DistSpec => ({ type: 'lognormal', median, sigmaLog });

/** Default priors of a magnetic-confinement configuration (tokamak, spherical tokamak, stellarator); see the file header. */
export function defaultPriors(cfg: ReactorConfig, opts: DefaultPriorOptions = {}): PriorSet {
  if (cfg.method !== 'tokamak' && cfg.method !== 'spherical_tokamak' && cfg.method !== 'stellarator') {
    throw new RangeError(`there are no default priors for '${cfg.method}': give the uncertain parameters explicitly`);
  }
  const stell = cfg.method === 'stellarator';
  const sigma = H98_SIGMA[opts.h98 ?? 'ipb98y2'];
  const hBasis = (opts.h98 ?? 'ipb98y2') === 'ipb98y2'
    ? 'IPB98(y,2) regression RMSE about 14 % (ITER Physics Basis, Nucl. Fusion 39 (1999) 2175, ch. 2)'
    : 'ITPA20-IL ITER prediction 2.79 +- 0.44 s (Verdoolaege et al., Nucl. Fusion 61 (2021) 076006)';
  const params: ParamSpec[] = [];
  if (stell && cfg.stellarator.H_ISS04 !== undefined) {
    params.push({ path: 'stellarator.H_ISS04', dist: lognormal(cfg.stellarator.H_ISS04, sigma), basis: `${hBasis}; applied to the ISS04 multiplier (ASSUMPTION: the same width)` });
  } else {
    params.push({ path: 'H98', dist: lognormal(cfg.H98, sigma), basis: stell ? `${hBasis}; applied to the ISS04 renormalisation (ASSUMPTION: the same width)` : hBasis });
  }
  params.push({ path: 'n_target', dist: lognormal(cfg.n_target, 0.1), basis: 'ASSUMPTION: 10 % (1 sigma) uncertainty of the achieved density' });
  params.push({ path: 'impurity.concentration', dist: lognormal(cfg.impurity.concentration, 0.5), basis: 'ASSUMPTION: factor 1.65 (1 sigma) on the impurity fraction' });
  if (cfg.impurity.seedConcentration !== undefined && cfg.impurity.seedConcentration > 0) {
    params.push({ path: 'impurity.seedConcentration', dist: lognormal(cfg.impurity.seedConcentration, 0.5), basis: 'ASSUMPTION: factor 1.65 (1 sigma) on the seeded impurity fraction' });
  }
  params.push({ path: 'transport.tau_He_over_tau_E', dist: lognormal(cfg.transport.tau_He_over_tau_E, 0.25), basis: 'ASSUMPTION: 25 % (1 sigma) on the helium-ash confinement ratio' });
  if (!stell) {
    params.push({ path: 'limits.betaN_limit', dist: lognormal(cfg.limits.betaN_limit, 0.08), basis: 'ASSUMPTION: 8 % (1 sigma) on the beta_N disruption boundary' });
    params.push({ path: 'limits.greenwald_limit', dist: lognormal(cfg.limits.greenwald_limit, 0.08), basis: 'ASSUMPTION: 8 % (1 sigma) on the density-limit disruption boundary' });
  }
  return { params };
}

/** Nominal value, prior median and 90 % interval of a parameter, for the report. */
export function describeParam(cfg: ReactorConfig, p: ParamSpec): { path: string; nominal: number | null; prior: { median: number; p05: number; p95: number }; dist: DistSpec; basis?: string } {
  const v = getPath(cfg, p.path);
  return { path: p.path, nominal: typeof v === 'number' ? v : null, prior: summarizeDist(p.dist), dist: p.dist, ...(p.basis ? { basis: p.basis } : {}) };
}

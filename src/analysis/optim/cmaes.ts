/**
 * CMA-ES: covariance matrix adaptation evolution strategy, a derivative-free global-ish optimiser for smooth or rugged, ill-conditioned
 * problems in tens of variables, where a simplex method stalls.
 *
 * The (mu/mu_w, lambda) strategy of N. Hansen & A. Ostermeier, "Completely derandomized self-adaptation in evolution strategies",
 * Evol. Comput. 9 (2001) 159-195, with the weights, learning rates and update equations (40)-(47) and the default parameters of
 * table 1 of N. Hansen, "The CMA evolution strategy: a tutorial", arXiv:1604.00772 (2016):
 *   lambda = 4 + floor(3 ln n),  mu = floor(lambda/2),  w_i ~ ln((lambda + 1)/2) - ln i  (normalised, i <= mu),  mu_eff = 1/sum w_i^2,
 *   c_sigma = (mu_eff + 2)/(n + mu_eff + 5),  d_sigma = 1 + 2 max(0, sqrt((mu_eff - 1)/(n + 1)) - 1) + c_sigma,
 *   c_c = (4 + mu_eff/n)/(n + 4 + 2 mu_eff/n),  c_1 = 2/((n + 1.3)^2 + mu_eff),  c_mu = min(1 - c_1, 2 (mu_eff - 2 + 1/mu_eff)/((n + 2)^2 + mu_eff)).
 * The eigendecomposition of C is done every generation with the cyclic Jacobi method (fine for the small n of this project).
 * Bounds: a sample outside the box is redrawn (up to 50 times) and then clipped. Restarts with a doubled population (IPOP:
 * A. Auger & N. Hansen, "A restart CMA evolution strategy with increasing population size", IEEE CEC 2005, 1769-1776) help on multimodal
 * functions. The random numbers come from the project's seeded RNG: the same seed gives the same run.
 * Pure TypeScript, no DOM or Node API.
 */
import { RNG } from '../../physics/rng';
import type { OptimResult } from './neldermead';

export interface CmaesOptions {
  lower?: readonly number[];
  upper?: readonly number[];
  /** initial step size (default 0.3 of the mean box width, or 0.3 without bounds) */
  sigma0?: number;
  /** population size (default 4 + floor(3 ln n)) */
  popSize?: number;
  seed?: number;
  /** budget of objective evaluations (default 2000 n^2) */
  maxEvals?: number;
  /** stop when the best values of the last generations differ by less than this (default 1e-12) */
  tolFun?: number;
  /** stop when the step size times the largest standard deviation falls below this (default 1e-12) */
  tolX?: number;
  /** IPOP restarts with a doubled population after a converged run (default 0) */
  restarts?: number;
}

export interface CmaesResult extends OptimResult {
  generations: number;
  restartsUsed: number;
}

/** Eigendecomposition of a symmetric matrix by cyclic Jacobi rotations: eigenvalues and eigenvectors as the columns of V. */
export function jacobiEigen(A: readonly (readonly number[])[]): { values: number[]; vectors: number[][] } {
  const n = A.length;
  const a = A.map((r) => [...r]);
  const V: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
        for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
        for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
      }
    }
  }
  return { values: a.map((r, i) => r[i]), vectors: V };
}

interface RunOutcome { x: number[]; f: number; evals: number; generations: number; reason: string }

function runCmaes(f: (x: number[]) => number, x0: readonly number[], o: Required<Pick<CmaesOptions, 'sigma0' | 'tolFun' | 'tolX'>> & { lo: number[]; hi: number[]; lambda: number; maxEvals: number; rng: RNG }): RunOutcome {
  const n = x0.length, { lo, hi, lambda, rng } = o;
  const mu = Math.floor(lambda / 2);
  const wRaw = Array.from({ length: mu }, (_, i) => Math.log((lambda + 1) / 2) - Math.log(i + 1));
  const wSum = wRaw.reduce((s, w) => s + w, 0);
  const w = wRaw.map((v) => v / wSum);
  const muEff = 1 / w.reduce((s, v) => s + v * v, 0);
  const cs = (muEff + 2) / (n + muEff + 5);
  const ds = 1 + 2 * Math.max(0, Math.sqrt((muEff - 1) / (n + 1)) - 1) + cs;
  const cc = (4 + muEff / n) / (n + 4 + (2 * muEff) / n);
  const c1 = 2 / ((n + 1.3) ** 2 + muEff);
  const cmu = Math.min(1 - c1, (2 * (muEff - 2 + 1 / muEff)) / ((n + 2) ** 2 + muEff));
  const chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));
  let m = x0.map((v, i) => Math.min(Math.max(v, lo[i]), hi[i]));
  let sigma = o.sigma0;
  const ps = new Array<number>(n).fill(0), pc = new Array<number>(n).fill(0);
  let C: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  let B: number[][] = C.map((r) => [...r]);
  let D = new Array<number>(n).fill(1);
  const bounded = lo.some(Number.isFinite) || hi.some(Number.isFinite);
  let evals = 0, gen = 0;
  let bestX = [...m], bestF = Infinity;
  const hist: number[] = [];
  const histLen = 10 + Math.ceil((30 * n) / lambda);
  const safe = (v: number) => (Number.isFinite(v) ? v : Infinity);
  let reason = 'maxEvals';
  while (evals < o.maxEvals) {
    gen++;
    const pop: { x: number[]; y: number[]; f: number }[] = [];
    for (let k = 0; k < lambda; k++) {
      let x: number[] = [], y: number[] = [];
      for (let tries = 0; tries < 51; tries++) {
        const z = Array.from({ length: n }, () => rng.normal());
        const dz = z.map((v, i) => D[i] * v);
        y = Array.from({ length: n }, (_, i) => { let s = 0; for (let j = 0; j < n; j++) s += B[i][j] * dz[j]; return s; });
        x = m.map((v, i) => v + sigma * y[i]);
        if (!bounded || x.every((v, i) => v >= lo[i] && v <= hi[i])) break;
        if (tries === 50) { x = x.map((v, i) => Math.min(Math.max(v, lo[i]), hi[i])); y = x.map((v, i) => (v - m[i]) / sigma); }
      }
      const fx = safe(f(x));
      evals++;
      pop.push({ x, y, f: fx });
      if (fx < bestF) { bestF = fx; bestX = x; }
    }
    pop.sort((a, b) => a.f - b.f);
    hist.push(pop[0].f);
    if (hist.length > histLen) hist.shift();
    // recombination
    const yw = new Array<number>(n).fill(0);
    for (let k = 0; k < mu; k++) for (let i = 0; i < n; i++) yw[i] += w[k] * pop[k].y[i];
    m = m.map((v, i) => v + sigma * yw[i]);
    // C^(-1/2) yw = B D^-1 B^T yw
    const bt = Array.from({ length: n }, (_, j) => { let s = 0; for (let i = 0; i < n; i++) s += B[i][j] * yw[i]; return s / D[j]; });
    const cinv = Array.from({ length: n }, (_, i) => { let s = 0; for (let j = 0; j < n; j++) s += B[i][j] * bt[j]; return s; });
    for (let i = 0; i < n; i++) ps[i] = (1 - cs) * ps[i] + Math.sqrt(cs * (2 - cs) * muEff) * cinv[i];
    const psNorm = Math.sqrt(ps.reduce((s, v) => s + v * v, 0));
    const hs = psNorm / Math.sqrt(1 - (1 - cs) ** (2 * gen)) < (1.4 + 2 / (n + 1)) * chiN ? 1 : 0;
    for (let i = 0; i < n; i++) pc[i] = (1 - cc) * pc[i] + hs * Math.sqrt(cc * (2 - cc) * muEff) * yw[i];
    const delta = (1 - hs) * cc * (2 - cc);
    const scale = 1 + c1 * delta - c1 - cmu;
    C = C.map((row, i) => row.map((v, j) => {
      let rank = 0;
      for (let k = 0; k < mu; k++) rank += w[k] * pop[k].y[i] * pop[k].y[j];
      return scale * v + c1 * pc[i] * pc[j] + cmu * rank;
    }));
    sigma *= Math.exp((cs / ds) * (psNorm / chiN - 1));
    // eigendecomposition
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) { const s = 0.5 * (C[i][j] + C[j][i]); C[i][j] = s; C[j][i] = s; }
    const eig = jacobiEigen(C);
    const vals = eig.values.map((v) => Math.max(v, 1e-300));
    D = vals.map(Math.sqrt);
    B = eig.vectors;
    // termination
    const dMax = Math.max(...D), dMin = Math.min(...D);
    if (!Number.isFinite(sigma) || sigma * dMax < o.tolX) { reason = 'tolX'; break; }
    if (dMax / dMin > 1e7) { reason = 'conditionCov'; break; }
    if (hist.length >= histLen && Math.max(...hist) - Math.min(...hist) < o.tolFun && Number.isFinite(pop[0].f)) { reason = 'tolFun'; break; }
  }
  return { x: bestX, f: bestF, evals, generations: gen, reason };
}

/** Minimises f over the box [lower, upper] starting near x0 (the mean of the first generation). */
export function cmaes(f: (x: number[]) => number, x0: readonly number[], opts: CmaesOptions = {}): CmaesResult {
  const n = x0.length;
  if (n < 1) throw new RangeError('cmaes: needs at least one variable');
  const lo = Array.from({ length: n }, (_, i) => opts.lower?.[i] ?? -Infinity), hi = Array.from({ length: n }, (_, i) => opts.upper?.[i] ?? Infinity);
  for (let i = 0; i < n; i++) if (!(hi[i] >= lo[i])) throw new RangeError(`cmaes: upper[${i}] < lower[${i}]`);
  const widths = lo.map((l, i) => hi[i] - l).filter(Number.isFinite);
  const sigma0 = opts.sigma0 ?? (widths.length ? 0.3 * (widths.reduce((s, v) => s + v, 0) / widths.length) : 0.3);
  if (!(sigma0 > 0)) throw new RangeError('cmaes: sigma0 must be positive');
  const rng = new RNG(opts.seed ?? 1);
  const maxEvals = opts.maxEvals ?? 2000 * n * n;
  const lambda0 = opts.popSize ?? 4 + Math.floor(3 * Math.log(n));
  if (!Number.isInteger(lambda0) || lambda0 < 4) throw new RangeError('cmaes: popSize must be an integer >= 4');
  let best: RunOutcome | null = null;
  let evals = 0, generations = 0, used = 0;
  let start = [...x0];
  for (let r = 0; r <= (opts.restarts ?? 0); r++) {
    const out = runCmaes(f, start, { sigma0, tolFun: opts.tolFun ?? 1e-12, tolX: opts.tolX ?? 1e-12, lo, hi, lambda: lambda0 * 2 ** r, maxEvals: maxEvals - evals, rng });
    evals += out.evals; generations += out.generations; used = r;
    if (!best || out.f < best.f) best = out;
    if (out.reason === 'maxEvals' || evals >= maxEvals) break;
    // IPOP: a random restart point inside the box (around x0 without bounds)
    start = start.map((v, i) => (Number.isFinite(lo[i]) && Number.isFinite(hi[i]) ? lo[i] + rng.next() * (hi[i] - lo[i]) : v + sigma0 * rng.normal()));
  }
  const b = best!;
  return { x: b.x, f: b.f, evals, iterations: generations, generations, restartsUsed: used, converged: b.reason !== 'maxEvals', reason: b.reason };
}

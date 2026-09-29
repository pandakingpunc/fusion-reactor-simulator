/**
 * NSGA-II: elitist non-dominated sorting genetic algorithm for multi-objective problems (the Pareto front of several conflicting
 * objectives, all to be minimised) with inequality constraints.
 *
 * K. Deb, A. Pratap, S. Agarwal & T. Meyarivan, "A fast and elitist multiobjective genetic algorithm: NSGA-II", IEEE Trans. Evol.
 * Comput. 6 (2002) 182-197: fast non-dominated sorting, crowding distance, binary tournament with the crowded-comparison operator,
 * (mu + lambda) elitist survival, and the constrained-domination rule of section V (a feasible solution dominates an infeasible
 * one; of two infeasible ones the smaller total violation dominates; feasible ones are compared by Pareto dominance). The variation
 * operators are the bounded simulated binary crossover (Deb & Agrawal, Complex Systems 9 (1995) 115-148) and the bounded polynomial
 * mutation of the reference implementation, with distribution indices 20. All random numbers come from the project's seeded RNG:
 * the same seed gives the same front.
 * Also here: the two-objective hypervolume (E. Zitzler & L. Thiele, IEEE Trans. Evol. Comput. 3 (1999) 257), the standard quality
 * measure of a front.
 * Pure TypeScript, no DOM or Node API.
 */
import { RNG } from '../../physics/rng';

export interface Nsga2Problem {
  n: number;
  /** number of objectives (>= 2), all minimised */
  m: number;
  f: (x: number[]) => number[];
  /** inequality constraints g_i(x) <= 0 */
  g?: (x: number[]) => number[];
  lower: readonly number[];
  upper: readonly number[];
}

export interface Nsga2Options {
  /** population size, a multiple of 4 (default 100) */
  popSize?: number;
  /** generations (default 250) */
  generations?: number;
  seed?: number;
  /** distribution indices of crossover and mutation (default 20) */
  etaC?: number;
  etaM?: number;
  /** crossover probability (default 0.9) and mutation probability per variable (default 1/n) */
  pCross?: number;
  pMut?: number;
  /** decision vectors that replace the first random individuals of the initial population (e.g. the single-objective optima, which NSGA-II reaches slowly on a narrow feasible set) */
  initial?: readonly (readonly number[])[];
  /** a total violation up to this counts as feasible (default 0); solutions from a solver that stops at a constraint have a tiny positive one */
  feasTol?: number;
}

export interface Individual {
  x: number[];
  f: number[];
  /** total constraint violation, sum of max(0, g_i); 0 = feasible */
  violation: number;
  rank: number;
  crowding: number;
}

export interface Nsga2Result {
  /** the non-dominated feasible individuals of the final population (all non-dominated ones if none is feasible), sorted by the first objective */
  front: Individual[];
  population: Individual[];
  evals: number;
  generations: number;
}

/** true if a constrained-dominates b (Deb et al. 2002, section V) */
export function dominates(a: Pick<Individual, 'f' | 'violation'>, b: Pick<Individual, 'f' | 'violation'>): boolean {
  const fa = a.violation === 0, fb = b.violation === 0;
  if (fa && !fb) return true;
  if (!fa && fb) return false;
  if (!fa && !fb) return a.violation < b.violation;
  let strictly = false;
  for (let k = 0; k < a.f.length; k++) {
    if (a.f[k] > b.f[k]) return false;
    if (a.f[k] < b.f[k]) strictly = true;
  }
  return strictly;
}

/** Fast non-dominated sorting: the fronts as arrays of indices (front 0 first) and sets `rank` of each individual. */
export function nonDominatedSort(pop: Individual[]): number[][] {
  const N = pop.length;
  const dominated: number[][] = Array.from({ length: N }, () => []);
  const count = new Array<number>(N).fill(0);
  const fronts: number[][] = [[]];
  for (let p = 0; p < N; p++) {
    for (let q = 0; q < N; q++) {
      if (p === q) continue;
      if (dominates(pop[p], pop[q])) dominated[p].push(q);
      else if (dominates(pop[q], pop[p])) count[p]++;
    }
    if (count[p] === 0) { pop[p].rank = 0; fronts[0].push(p); }
  }
  let i = 0;
  while (fronts[i].length) {
    const next: number[] = [];
    for (const p of fronts[i]) for (const q of dominated[p]) if (--count[q] === 0) { pop[q].rank = i + 1; next.push(q); }
    i++;
    fronts.push(next);
  }
  fronts.pop();
  return fronts;
}

/** Crowding distance of the individuals of one front (boundary points get Infinity). */
export function assignCrowding(pop: Individual[], front: readonly number[]): void {
  for (const i of front) pop[i].crowding = 0;
  if (front.length <= 2) { for (const i of front) pop[i].crowding = Infinity; return; }
  const m = pop[front[0]].f.length;
  for (let k = 0; k < m; k++) {
    const idx = [...front].sort((a, b) => pop[a].f[k] - pop[b].f[k]);
    const lo = pop[idx[0]].f[k], hi = pop[idx[idx.length - 1]].f[k];
    pop[idx[0]].crowding = Infinity; pop[idx[idx.length - 1]].crowding = Infinity;
    if (!(hi > lo)) continue;
    for (let j = 1; j < idx.length - 1; j++) pop[idx[j]].crowding += (pop[idx[j + 1]].f[k] - pop[idx[j - 1]].f[k]) / (hi - lo);
  }
}

/** crowded-comparison: lower rank wins, then larger crowding distance */
const better = (a: Individual, b: Individual): boolean => a.rank < b.rank || (a.rank === b.rank && a.crowding > b.crowding);

/**
 * Hypervolume dominated by a set of points of two objectives (minimisation) and bounded by the reference point: the area of the
 * union of the boxes [f1, ref1] x [f2, ref2]. Points that do not dominate the reference point are ignored.
 */
export function hypervolume2D(points: readonly (readonly number[])[], ref: readonly [number, number]): number {
  const pts = points.filter((p) => p[0] < ref[0] && p[1] < ref[1]).map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let hv = 0, bestF2 = ref[1];
  for (const [f1, f2] of pts) {
    if (f2 < bestF2) { hv += (ref[0] - f1) * (bestF2 - f2); bestF2 = f2; }
  }
  return hv;
}

/** Runs NSGA-II. */
export function nsga2(p: Nsga2Problem, opts: Nsga2Options = {}): Nsga2Result {
  const { n, m } = p;
  if (n < 1) throw new RangeError('nsga2: needs at least one variable');
  if (m < 2) throw new RangeError('nsga2: needs at least two objectives');
  if (p.lower.length !== n || p.upper.length !== n) throw new RangeError('nsga2: lower and upper must have one entry per variable');
  for (let i = 0; i < n; i++) if (!(p.upper[i] > p.lower[i])) throw new RangeError(`nsga2: upper[${i}] must exceed lower[${i}]`);
  const N = opts.popSize ?? 100;
  if (!Number.isInteger(N) || N < 8 || N % 4 !== 0) throw new RangeError('nsga2: popSize must be a multiple of 4 and at least 8');
  const gens = opts.generations ?? 250;
  const etaC = opts.etaC ?? 20, etaM = opts.etaM ?? 20, pC = opts.pCross ?? 0.9, pM = opts.pMut ?? 1 / n;
  const rng = new RNG(opts.seed ?? 1);
  let evals = 0;
  const make = (x: number[]): Individual => {
    evals++;
    const f = p.f(x).map((v) => (Number.isFinite(v) ? v : 1e300));
    if (f.length !== m) throw new RangeError(`nsga2: the objective function returned ${f.length} values, expected ${m}`);
    let violation = 0;
    if (p.g) for (const g of p.g(x)) violation += Number.isFinite(g) ? Math.max(0, g) : 1e300;
    if (violation <= (opts.feasTol ?? 0)) violation = 0;
    return { x, f, violation, rank: 0, crowding: 0 };
  };
  const seeds = (opts.initial ?? []).slice(0, N).map((x) => {
    if (x.length !== n) throw new RangeError(`nsga2: an initial point has ${x.length} entries, the problem has ${n} variables`);
    return x.map((v, i) => Math.min(Math.max(v, p.lower[i]), p.upper[i]));
  });
  let pop: Individual[] = Array.from({ length: N }, (_, k) => make(k < seeds.length ? seeds[k] : Array.from({ length: n }, (_, i) => p.lower[i] + rng.next() * (p.upper[i] - p.lower[i]))));
  const rankAndCrowd = (arr: Individual[]): number[][] => { const fr = nonDominatedSort(arr); for (const f of fr) assignCrowding(arr, f); return fr; };
  rankAndCrowd(pop);

  const tournament = (): Individual => {
    const a = pop[Math.floor(rng.next() * N)], b = pop[Math.floor(rng.next() * N)];
    return better(a, b) ? a : better(b, a) ? b : rng.next() < 0.5 ? a : b;
  };
  const sbx = (p1: number[], p2: number[]): [number[], number[]] => {
    const c1 = [...p1], c2 = [...p2];
    if (rng.next() > pC) return [c1, c2];
    for (let i = 0; i < n; i++) {
      if (rng.next() > 0.5 || Math.abs(p1[i] - p2[i]) < 1e-14) continue;
      const y1 = Math.min(p1[i], p2[i]), y2 = Math.max(p1[i], p2[i]);
      const yl = p.lower[i], yu = p.upper[i], u = rng.next();
      const betaq = (beta: number): number => {
        const alpha = 2 - Math.pow(beta, -(etaC + 1));
        return u <= 1 / alpha ? Math.pow(u * alpha, 1 / (etaC + 1)) : Math.pow(1 / (2 - u * alpha), 1 / (etaC + 1));
      };
      let a = 0.5 * (y1 + y2 - betaq(1 + (2 * (y1 - yl)) / (y2 - y1)) * (y2 - y1));
      let b = 0.5 * (y1 + y2 + betaq(1 + (2 * (yu - y2)) / (y2 - y1)) * (y2 - y1));
      a = Math.min(Math.max(a, yl), yu); b = Math.min(Math.max(b, yl), yu);
      if (rng.next() < 0.5) { c1[i] = b; c2[i] = a; } else { c1[i] = a; c2[i] = b; }
    }
    return [c1, c2];
  };
  const mutate = (x: number[]): number[] => x.map((y, i) => {
    if (rng.next() > pM) return y;
    const yl = p.lower[i], yu = p.upper[i], d1 = (y - yl) / (yu - yl), d2 = (yu - y) / (yu - yl), r = rng.next(), mp = 1 / (etaM + 1);
    let dq: number;
    if (r <= 0.5) dq = Math.pow(2 * r + (1 - 2 * r) * Math.pow(1 - d1, etaM + 1), mp) - 1;
    else dq = 1 - Math.pow(2 * (1 - r) + 2 * (r - 0.5) * Math.pow(1 - d2, etaM + 1), mp);
    return Math.min(Math.max(y + dq * (yu - yl), yl), yu);
  });

  for (let g = 0; g < gens; g++) {
    const kids: Individual[] = [];
    while (kids.length < N) {
      const [c1, c2] = sbx(tournament().x, tournament().x);
      kids.push(make(mutate(c1)));
      if (kids.length < N) kids.push(make(mutate(c2)));
    }
    const all = [...pop, ...kids];
    const fronts = nonDominatedSort(all);
    const next: Individual[] = [];
    for (const fr of fronts) {
      assignCrowding(all, fr);
      if (next.length + fr.length <= N) { for (const i of fr) next.push(all[i]); continue; }
      const rest = [...fr].sort((a, b) => all[b].crowding - all[a].crowding);
      for (const i of rest) { if (next.length === N) break; next.push(all[i]); }
      break;
    }
    pop = next;
    rankAndCrowd(pop);
  }
  const feasible = pop.filter((i) => i.violation === 0);
  const pool = feasible.length ? feasible : pop;
  const fr = nonDominatedSort(pool);
  const front = (fr[0] ?? []).map((i) => pool[i]).sort((a, b) => a.f[0] - b.f[0]);
  return { front, population: pop, evals, generations: gens };
}

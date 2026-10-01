/**
 * kadomtsevMixingRadius (mhd.ts): the radius ρ_mix behind the outermost q = 1 surface where the helical flux
 * ψ*(ρ) = ∫₀^ρ (1/q − 1) Φ_b 2ρ dρ returns to ψ*(0) = 0.
 *
 *  - for every monotonic q with q₀ < 1 the result is bitwise the one of the implementation before the fix (a verbatim copy
 *    is kept below), over random profiles and uniform, random and edge-packed grids;
 *  - for a hollow core (q₀ > 1, q < 1 in an annulus) it follows ψ* of the analytic profile q = q₀ − aρ² + bρ⁴
 *    (closed form, checked against Simpson quadrature), converging at second order in the grid width;
 *  - no mixing radius (−1, never a value below −1, never NaN) when the annulus does not outweigh the core deficit
 *    or q ≥ 1 everywhere; 1 when ψ* is still positive at the edge;
 *  - several q < 1 annuli: the radius behind the outermost one, against a brute-force quadrature.
 * The old implementation divided by its 1e-30 floor for a hollow core whose first q < 1 face did not outweigh the core deficit
 * (a value of about −1e25 that closed the sawtooth gate), and opened the gate or not with the grid; both are shown below.
 */
import { describe, expect, it } from 'vitest';
import { circularGeometry, packedFaces, type GridSpec, type TransportGeometry } from './geometry1d';
import { kadomtsevMixingRadius, rhoOfQ } from './mhd';

/** The implementation before the fix (peaked on the first face increment > 0), verbatim */
function legacyMixingRadius(g: TransportGeometry, qF: Float64Array): number {
  const N = g.N;
  let psiS = 0, prev = 0, peaked = false;
  for (let f = 1; f <= N; f++) {
    const r0 = g.rhoF[f - 1], r1 = g.rhoF[f];
    const val = (0.5 * (1 / qF[f - 1] + 1 / qF[f]) - 1) * (r1 * r1 - r0 * r0);
    prev = psiS;
    psiS += val;
    if (val > 0) peaked = true;
    if (peaked && psiS <= 0) {
      const t = prev / Math.max(prev - psiS, 1e-30);
      return r0 + t * (r1 - r0);
    }
  }
  return peaked ? 1 : -1;
}

/** The same radius in two passes (last face interval with q < 1 on average, then the first return to zero behind it) */
function twoPassMixingRadius(g: TransportGeometry, qF: Float64Array): number {
  const N = g.N;
  const psi = new Float64Array(N + 1);
  let last = 0;
  for (let f = 1; f <= N; f++) {
    const r0 = g.rhoF[f - 1], r1 = g.rhoF[f];
    const val = (0.5 * (1 / qF[f - 1] + 1 / qF[f]) - 1) * (r1 * r1 - r0 * r0);
    psi[f] = psi[f - 1] + val;
    if (val > 0) last = f;
  }
  if (last === 0 || !(psi[last] > 0)) return -1;
  for (let f = last + 1; f <= N; f++) {
    if (psi[f] <= 0) {
      const prev = psi[f - 1];
      const t = prev / Math.max(prev - psi[f], 1e-30);
      return g.rhoF[f - 1] + t * (g.rhoF[f] - g.rhoF[f - 1]);
    }
  }
  return 1;
}

/** A grid reduced to what the mixing radius reads (N and the faces) */
function gridOf(rhoF: ArrayLike<number>): TransportGeometry {
  return { N: rhoF.length - 1, rhoF: Float64Array.from(rhoF) } as unknown as TransportGeometry;
}

/** Deterministic uniform random numbers in [0, 1) (mulberry32) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PACKINGS: GridSpec[] = [{ packing: 2, rhoT: 0.85, width: 0.05 }, { packing: 4, rhoT: 0.9, width: 0.03 }, { packing: 1, rhoT: 0.7, width: 0.1 }];
const packedCache = new Map<string, Float64Array>();
function packed(N: number, k: number): Float64Array {
  const key = `${N}/${k}`;
  let f = packedCache.get(key);
  if (!f) packedCache.set(key, (f = packedFaces(N, PACKINGS[k])));
  return f;
}

/** Faces of a random grid: uniform, edge-packed or random (increasing, no cell narrower than 1/(20N)) */
function randomFaces(rand: () => number): Float64Array {
  const kind = Math.floor(rand() * 3);
  if (kind === 1) {
    const sizes = [16, 32, 64, 100, 128, 200];
    return packed(sizes[Math.floor(rand() * sizes.length)], Math.floor(rand() * PACKINGS.length));
  }
  const N = 6 + Math.floor(rand() * 295);
  const faces = new Float64Array(N + 1);
  if (kind === 0) {
    for (let f = 0; f <= N; f++) faces[f] = f / N;
    return faces;
  }
  const w = Float64Array.from({ length: N }, () => 0.05 + rand());
  const sum = w.reduce((s, x) => s + x, 0);
  for (let f = 1; f <= N; f++) faces[f] = faces[f - 1] + w[f - 1] / sum;
  faces[N] = 1;
  return faces;
}

/** A q profile on the faces that does not decrease outwards (q ≤ 50 as qFromDpsi caps it), q₀ < 1 or q₀ ≥ 1 */
function monotonicQ(rand: () => number, rhoF: Float64Array, below1: boolean): Float64Array {
  const n = rhoF.length, q = new Float64Array(n);
  const q0 = below1 ? 0.15 + 0.845 * rand() : 1 + 0.8 * rand();
  const kind = Math.floor(rand() * 5);
  if (kind === 0) { // q₀ + c ρ^p
    const c = 0.05 + 6 * rand(), p = 0.5 + 3.5 * rand();
    for (let f = 0; f < n; f++) q[f] = Math.min(q0 + c * rhoF[f] ** p, 50);
  } else if (kind === 1) { // random walk upwards with flat stretches
    const s = 0.005 + 0.3 * rand();
    q[0] = q0;
    for (let f = 1; f < n; f++) q[f] = Math.min(q[f - 1] + (rand() < 0.3 ? 0 : -Math.log(1 - rand()) * s), 50);
  } else if (kind === 2) { // a step through q = 1 inside one interval, then a plateau
    const j = 1 + Math.floor(rand() * (n - 1)), top = q0 + 0.001 + 3 * rand();
    for (let f = 0; f < n; f++) q[f] = f < j ? q0 : top + 0.01 * rhoF[f];
  } else if (kind === 3) { // q stays below 1 (or at q₀ ≥ 1 stays flat): the whole profile is one lobe
    const c = below1 ? rand() * (0.995 - q0) : rand() * 0.1;
    for (let f = 0; f < n; f++) q[f] = q0 + c * rhoF[f];
  } else { // linear to exactly q = 1 on a face, then up
    const k = 1 + Math.floor(rand() * (n - 1)), c = 4 * rand();
    for (let f = 0; f < n; f++) q[f] = f < k ? q0 + ((1 - q0) * f) / k : 1 + (c * (f - k)) / n;
    q[k] = 1;
  }
  return q;
}

/** A profile of any shape: a rising base with hollow-core dips, up to three, and sometimes per-face noise */
function arbitraryQ(rand: () => number, rhoF: Float64Array): Float64Array {
  const base = 0.5 + 1.5 * rand(), slope = 3 * rand();
  const dips = Array.from({ length: Math.floor(rand() * 4) }, () => ({ d: 1.2 * rand(), c: rand(), w: 0.02 + 0.13 * rand() }));
  const noise = rand() < 0.3 ? 0.05 * rand() : 0;
  return Float64Array.from(rhoF, (r) => {
    let q = base + slope * r * r;
    for (const k of dips) q -= k.d * Math.exp(-(((r - k.c) / k.w) ** 2));
    return Math.min(Math.max(q + noise * (rand() - 0.5), 0.05), 50);
  });
}

describe('kadomtsevMixingRadius: monotonic profiles are bitwise unchanged', () => {
  it('q₀ < 1 and q rising outwards: the result is bit for bit the one of the old implementation (random profiles and grids)', () => {
    const rand = rng(20261001);
    let minusOne = 0, one = 0, inside = 0, mismatches = 0;
    const trials = 30000;
    for (let i = 0; i < trials; i++) {
      const rhoF = randomFaces(rand);
      const g = gridOf(rhoF);
      const qF = monotonicQ(rand, rhoF, true);
      expect(qF[0]).toBeLessThan(1);
      const now = kadomtsevMixingRadius(g, qF), old = legacyMixingRadius(g, qF);
      if (!Object.is(now, old)) mismatches++;
      if (old === -1) minusOne++; else if (old === 1) one++; else inside++;
    }
    expect(mismatches).toBe(0);
    // all three kinds of result were exercised
    expect(minusOne).toBeGreaterThan(300);
    expect(one).toBeGreaterThan(300);
    expect(inside).toBeGreaterThan(3000);
  });

  it('q ≥ 1 everywhere (rising outwards): −1 as before, bit for bit', () => {
    const rand = rng(77);
    for (let i = 0; i < 5000; i++) {
      const rhoF = randomFaces(rand);
      const g = gridOf(rhoF);
      const qF = monotonicQ(rand, rhoF, false);
      const now = kadomtsevMixingRadius(g, qF);
      expect(now).toBe(-1);
      expect(Object.is(now, legacyMixingRadius(g, qF))).toBe(true);
    }
  });

  it('the profile of the existing helical-flux test (q = 0.7 + 2.5ρ², 200 uniform cells) keeps its radius to the bit', () => {
    const g = circularGeometry(3, 1, 3, 200);
    const qF = Float64Array.from(g.rhoF, (r) => 0.7 + 2.5 * r * r);
    expect(Object.is(kadomtsevMixingRadius(g, qF), legacyMixingRadius(g, qF))).toBe(true);
  });
});

/** The hollow profile q = q₀ − aρ² + bρ⁴ with its helical flux ψ*(ρ)/Φ_b in closed form: with u = ρ², ∫ du/(bu² − au + q₀) = (2/s) atan((2bu − a)/s), s = √(4b q_min) */
function hollow(q0: number, a: number, b: number) {
  const qmin = q0 - (a * a) / (4 * b);
  const s = Math.sqrt(4 * b * qmin);
  const F = (u: number) => (2 / s) * Math.atan((2 * b * u - a) / s) - u;
  const q = (r: number) => q0 - a * r * r + b * r ** 4;
  const psi = (r: number) => F(r * r) - F(0);
  /** the outermost q = 1 radius (−1: none) and the radius behind it where ψ* returns to zero (−1: ψ* is not positive at ρ₁; 1: never) */
  const M = 200000;
  let rho1 = -1;
  for (let k = M; k >= 1; k--) if ((q(k / M) - 1) * (q((k - 1) / M) - 1) <= 0) { rho1 = (k - 1) / M; break; }
  let root = -1;
  if (rho1 >= 0 && psi(rho1) > 0) {
    root = 1;
    if (!(psi(1) > 0)) {
      let lo = rho1, hi = 1;
      for (let it = 0; it < 200; it++) { const m = 0.5 * (lo + hi); if (psi(m) > 0) lo = m; else hi = m; }
      root = 0.5 * (lo + hi);
    }
  }
  return { q, psi, qmin, rho1, root };
}

/** Simpson quadrature of ∫₀^ρ (1/q − 1) 2ρ' dρ' = ∫₀^{ρ²} (1/q(√u) − 1) du with 2n panels */
function simpsonPsi(q: (r: number) => number, rho: number, n = 2000): number {
  const U = rho * rho, h = U / (2 * n);
  const fn = (u: number) => 1 / q(Math.sqrt(u)) - 1;
  let s = fn(0) + fn(U);
  for (let k = 1; k < 2 * n; k++) s += fn(k * h) * (k % 2 ? 4 : 2);
  return (s * h) / 3;
}

const widest = (g: TransportGeometry) => { let w = 0; for (let f = 1; f <= g.N; f++) w = Math.max(w, g.rhoF[f] - g.rhoF[f - 1]); return w; };

describe('kadomtsevMixingRadius: hollow core (q₀ > 1 > q_min)', () => {
  // [q0, a, b]: q_min = q0 − a²/(4b) at ρ² = a/(2b); the annulus outweighs the core deficit and ψ* returns to zero before the edge
  const WITH_ROOT: Array<[number, number, number]> = [[1.1, 1.5, 3.0], [1.05, 1.0, 2.2], [1.2, 1.6, 2.4], [1.001, 1.5, 3.0]];

  it('the closed form of ψ* of the reference profile is the Simpson quadrature of its definition', () => {
    for (const [q0, a, b] of [...WITH_ROOT, [1.3, 2, 3], [1.05, 1, 1.05]] as Array<[number, number, number]>) {
      const h = hollow(q0, a, b);
      for (const r of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) expect(Math.abs(h.psi(r) - simpsonPsi(h.q, r))).toBeLessThan(1e-10);
    }
  });

  it('ρ_mix is the zero of ψ* behind the outer q = 1 surface, on uniform and edge-packed grids, second order in the grid width', () => {
    for (const [q0, a, b] of WITH_ROOT) {
      const h = hollow(q0, a, b);
      expect(h.qmin).toBeLessThan(1); // hollow: q₀ > 1 > q_min, q = 1 twice
      expect(h.root).toBeGreaterThan(h.rho1 + 0.05);
      expect(h.root).toBeLessThan(1);
      const errs: number[] = [];
      for (const N of [100, 200, 400]) {
        const g = circularGeometry(3, 1, 3, N);
        const qF = Float64Array.from(g.rhoF, h.q);
        const rmix = kadomtsevMixingRadius(g, qF);
        errs.push(Math.abs(rmix - h.root));
        // the radius is behind the outermost q = 1 surface, as the callers require, and within the width of the cell of the root
        expect(rmix).toBeGreaterThan(rhoOfQ(g, qF, 1));
        expect(errs[errs.length - 1]).toBeLessThan(0.25 * widest(g));
      }
      // O(h²): halving the cells divides the error by about four (the trapezoid in 1/q of the faces)
      expect(errs[0] / errs[2]).toBeGreaterThan(8);
      // packed grids: the fine cells are at the edge, the root lies in the coarse core
      for (const spec of PACKINGS) {
        const g = circularGeometry(3, 1, 3, 200, undefined, spec);
        const qF = Float64Array.from(g.rhoF, h.q);
        const rmix = kadomtsevMixingRadius(g, qF);
        expect(Math.abs(rmix - h.root)).toBeLessThan(0.25 * widest(g));
        expect(rmix).toBeGreaterThan(rhoOfQ(g, qF, 1));
      }
    }
  });

  it('the old implementation returned about −1e25 for these hollow cores (its first q < 1 face did not outweigh the core)', () => {
    for (const [q0, a, b] of WITH_ROOT.slice(0, 3)) {
      const g = circularGeometry(3, 1, 3, 200);
      const qF = Float64Array.from(g.rhoF, hollow(q0, a, b).q);
      expect(legacyMixingRadius(g, qF)).toBeLessThan(-1e20);
      expect(kadomtsevMixingRadius(g, qF)).toBeGreaterThan(0.5);
    }
  });

  it('whether the gate opens does not depend on the grid: ρ_mix > ρ₁ at every N, where the old function flipped between the sentinel and a radius', () => {
    const [q0, a, b] = [1.001, 1.5, 3.0];
    const h = hollow(q0, a, b);
    const old: number[] = [];
    for (let N = 10; N <= 400; N += 5) {
      const g = circularGeometry(3, 1, 3, N);
      const qF = Float64Array.from(g.rhoF, h.q);
      const rmix = kadomtsevMixingRadius(g, qF);
      expect(rmix).toBeGreaterThan(rhoOfQ(g, qF, 1));
      expect(Math.abs(rmix - h.root)).toBeLessThan(0.25 * widest(g) + 1e-3);
      old.push(legacyMixingRadius(g, qF));
    }
    // the artefact itself: the old gate was closed (the sentinel) at some grids and open at others, for the same physical q profile
    expect(old.some((r) => r < -1)).toBe(true);
    expect(old.some((r) => r > 0 && r <= 1)).toBe(true);
  });

  it('no mixing radius (−1, not −1e25) when the annulus does not outweigh the core deficit', () => {
    for (const [q0, a, b] of [[1.3, 2, 3], [1.1, 1.2, 3]] as Array<[number, number, number]>) {
      const h = hollow(q0, a, b);
      expect(h.qmin).toBeLessThan(1); // there is a q < 1 annulus ...
      expect(h.rho1).toBeGreaterThan(0.3); // ... with an outer q = 1 surface ...
      expect(h.psi(h.rho1)).toBeLessThan(0); // ... but ψ* is negative there
      expect(h.root).toBe(-1);
      for (const N of [20, 100, 400]) {
        const g = circularGeometry(3, 1, 3, N);
        const qF = Float64Array.from(g.rhoF, h.q);
        expect(kadomtsevMixingRadius(g, qF)).toBe(-1);
        expect(legacyMixingRadius(g, qF)).toBeLessThan(-1e20);
      }
    }
  });

  it('ψ* still positive at the edge: 1, as before for a lobe that never returns', () => {
    const h = hollow(1.05, 1.0, 1.05);
    expect(h.root).toBe(1);
    const g = circularGeometry(3, 1, 3, 100);
    expect(kadomtsevMixingRadius(g, Float64Array.from(g.rhoF, h.q))).toBe(1);
    // a q profile below 1 from the axis to the edge
    expect(kadomtsevMixingRadius(g, Float64Array.from(g.rhoF, (r) => 0.6 + 0.3 * r))).toBe(1);
  });

  it('q ≥ 1 everywhere: −1, with and without a q₀ > q_min dip', () => {
    const g = circularGeometry(3, 1, 3, 100);
    expect(kadomtsevMixingRadius(g, Float64Array.from(g.rhoF, (r) => 1.2 + 2 * r * r))).toBe(-1);
    expect(kadomtsevMixingRadius(g, Float64Array.from(g.rhoF, () => 1))).toBe(-1);
    const h = hollow(1.2, 1.5, 3.0); // q_min = 1.0125 > 1
    expect(h.qmin).toBeGreaterThan(1);
    expect(kadomtsevMixingRadius(g, Float64Array.from(g.rhoF, h.q))).toBe(-1);
  });
});

/** The reference of the specification by brute force: ψ* on 2·10⁵ fine steps, the outermost q = 1 crossing, the first return to zero behind it */
function bruteForceMixing(q: (r: number) => number, M = 200000): { rho1: number; rmix: number } {
  const psi = new Float64Array(M + 1);
  for (let k = 1; k <= M; k++) {
    const r0 = (k - 1) / M, r1 = k / M;
    psi[k] = psi[k - 1] + (0.5 * (1 / q(r0) + 1 / q(r1)) - 1) * (r1 * r1 - r0 * r0);
  }
  let k1 = -1;
  for (let k = M; k >= 1; k--) if ((q(k / M) - 1) * (q((k - 1) / M) - 1) <= 0) { k1 = k - 1; break; }
  if (k1 < 0 || !(psi[k1] > 0)) return { rho1: k1 < 0 ? -1 : k1 / M, rmix: -1 };
  for (let k = k1; k <= M; k++) {
    if (psi[k] <= 0) return { rho1: k1 / M, rmix: ((k - 1) + psi[k - 1] / (psi[k - 1] - psi[k])) / M };
  }
  return { rho1: k1 / M, rmix: 1 };
}

const dip = (r: number, c: number, w: number) => Math.exp(-(((r - c) / w) ** 2));

describe('kadomtsevMixingRadius: several q < 1 annuli', () => {
  // q = base + 0.6 ρ² − d₁ dip(ρ; 0.12, 0.05) − d₂ dip(ρ; c₂, w₂): q₀ > 1, two annuli (q = 1 four times)
  const profile = (base: number, d1: number, d2: number, c2: number, w2: number) => (r: number) => base + 0.6 * r * r - d1 * dip(r, 0.12, 0.05) - d2 * dip(r, c2, w2);

  const cases = [
    // ψ* rises in the inner annulus, falls back below zero in the gap and is lifted above zero again by the outer annulus:
    // the first return to zero (ρ ≈ 0.243) is inside the outer q = 1 surface, the mixing radius is the one behind the outer annulus
    { name: 'the outer annulus lifts ψ* above zero again', q: profile(1.15, 0.4, 0.6, 0.5, 0.06), expectRoot: true, firstReturnBelowRho1: true },
    // ψ* stays positive over the gap: the outer annulus only delays the return to zero
    { name: 'ψ* stays positive over the gap', q: profile(1.02, 0.4, 0.5, 0.5, 0.06), expectRoot: true, firstReturnBelowRho1: false },
    // the outer annulus is too weak to bring ψ* back above zero: no mixing radius although the inner lobe was positive
    { name: 'the outer annulus is too weak', q: profile(1.15, 0.4, 0.4, 0.5, 0.1), expectRoot: false, firstReturnBelowRho1: true },
  ];

  for (const c of cases) {
    it(`${c.name}: the radius behind the outermost q = 1 surface, or −1 (brute force reference)`, () => {
      const ref = bruteForceMixing(c.q);
      // the profile has four q = 1 crossings
      let crossings = 0;
      for (let k = 1; k <= 2000; k++) if ((c.q(k / 2000) - 1) * (c.q((k - 1) / 2000) - 1) < 0) crossings++;
      expect(crossings).toBe(4);
      expect(c.q(0)).toBeGreaterThan(1);
      expect(ref.rmix > 0).toBe(c.expectRoot);
      for (const N of [200, 400]) {
        const g = circularGeometry(3, 1, 3, N);
        const qF = Float64Array.from(g.rhoF, c.q);
        const rmix = kadomtsevMixingRadius(g, qF);
        if (!c.expectRoot) { expect(rmix).toBe(-1); continue; }
        expect(Math.abs(rmix - ref.rmix)).toBeLessThan(0.25 / N);
        expect(rmix).toBeGreaterThan(rhoOfQ(g, qF, 1));
        // the first return to zero of ψ* alone (the earlier criterion's reading of 'peaked') would sit inside ρ₁ here
        const firstReturn = firstReturnToZero(g, qF);
        expect(firstReturn < rhoOfQ(g, qF, 1)).toBe(c.firstReturnBelowRho1);
      }
    });
  }
});

/** ψ* back at or below zero for the first time after it was positive: the reading that ignores the later annuli */
function firstReturnToZero(g: TransportGeometry, qF: Float64Array): number {
  let psi = 0, positive = false;
  for (let f = 1; f <= g.N; f++) {
    const r0 = g.rhoF[f - 1], r1 = g.rhoF[f];
    const prev = psi;
    psi += (0.5 * (1 / qF[f - 1] + 1 / qF[f]) - 1) * (r1 * r1 - r0 * r0);
    if (psi > 0) positive = true;
    else if (positive) return r0 + (prev / (prev - psi)) * (r1 - r0);
  }
  return positive ? 1 : -1;
}

describe('kadomtsevMixingRadius: any profile', () => {
  it('is −1 or in (0, 1], never below −1 and never NaN, and is the two-pass formulation, bit for bit (random profiles of any shape)', () => {
    const rand = rng(424242);
    let minusOne = 0, one = 0, inside = 0, legacyBelow = 0;
    const trials = 30000;
    for (let i = 0; i < trials; i++) {
      const rhoF = randomFaces(rand);
      const g = gridOf(rhoF);
      const qF = arbitraryQ(rand, rhoF);
      const now = kadomtsevMixingRadius(g, qF);
      expect(Number.isNaN(now)).toBe(false);
      expect(now === -1 || (now > 0 && now <= 1)).toBe(true);
      expect(Object.is(now, twoPassMixingRadius(g, qF))).toBe(true);
      if (now === -1) minusOne++; else if (now === 1) one++; else inside++;
      if (legacyMixingRadius(g, qF) < -1) legacyBelow++;
    }
    expect(minusOne).toBeGreaterThan(1000);
    expect(one).toBeGreaterThan(100);
    expect(inside).toBeGreaterThan(3000);
    // the old function returned values below −1 for a sizeable share of these profiles
    expect(legacyBelow).toBeGreaterThan(300);
  });

  it('non-finite q at a face does not turn the result into NaN or a value below −1', () => {
    const g = circularGeometry(3, 1, 3, 50);
    for (const bad of [NaN, Infinity, 0]) {
      for (const at of [0, 10, 50]) {
        const qF = Float64Array.from(g.rhoF, (r) => 0.7 + 2.5 * r * r);
        qF[at] = bad;
        const r = kadomtsevMixingRadius(g, qF);
        expect(r === -1 || (r > 0 && r <= 1) || Number.isNaN(r)).toBe(true);
        expect(r < -1).toBe(false);
      }
    }
  });
});

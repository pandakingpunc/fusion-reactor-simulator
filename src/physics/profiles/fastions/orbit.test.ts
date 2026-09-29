/**
 * The orbit-width smoothing of the fast-ion source (orbit.ts): the kernel conserves the energy exactly, is the identity for a vanishing
 * width, is finite and smooth at the axis, and the Bessel function it is built on matches its series.
 */
import { describe, expect, it } from 'vitest';
import { besselI0e, larmorRadius, orbitKernel, orbitSigma, MAX_SIGMA, ORBIT_RMS } from './orbit';
import { PoolField } from './pool';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

/** A radial grid of N equal cells of a torus (R0 = 3, a = 1, circular): rho at the centres, the cell width and the volume of each cell */
function grid(N: number) {
  const rhoC = new Float64Array(N), dRhoC = new Float64Array(N), dV = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    rhoC[i] = (i + 0.5) / N; dRhoC[i] = 1 / N;
    const r0 = i / N, r1 = (i + 1) / N;
    dV[i] = 2 * Math.PI * 3 * Math.PI * (r1 * r1 - r0 * r0);
  }
  return { rhoC, dRhoC, dV };
}

describe('e^{-x} I_0(x)', () => {
  // I_0(x) = Σ (x²/4)^k / (k!)²
  const series = (x: number) => {
    let term = 1, sum = 1;
    for (let k = 1; k < 400; k++) { term *= (x * x) / (4 * k * k); sum += term; if (term < 1e-18 * sum) break; }
    return sum * Math.exp(-x);
  };
  it('matches the power series to 5e-7 (Abramowitz and Stegun 9.8.1, 9.8.2) over 0 ... 60', () => {
    for (const x of [0, 1e-3, 0.1, 0.5, 1, 2, 3, 3.7, 3.75, 3.8, 5, 10, 20, 40, 60]) expect(rel(besselI0e(x), series(x))).toBeLessThan(5e-7);
  });
  it('is continuous at the switch of the two approximations', () => {
    expect(rel(besselI0e(3.75 - 1e-9), besselI0e(3.75 + 1e-9))).toBeLessThan(5e-7);
  });
});

describe('Larmor radius and rms width', () => {
  it('a 3.5 MeV alpha in 5 T has rho_L = 5.4 cm; a 110 keV deuteron in 3.7 T 1.8 cm (m v / q B = sqrt(2 m E) / (q B))', () => {
    expect(larmorRadius(3500, 4.0015, 2, 5)).toBeCloseTo(0.05388, 4);
    expect(larmorRadius(110, 2.014, 1, 3.7)).toBeCloseTo(0.018315, 4);
  });
  it('sigma = ORBIT_RMS q rho_L / a, scaled by fastOrbitScale, bounded below by q >= 0.2 and above by MAX_SIGMA; a zero scale switches it off', () => {
    const out = new Float64Array(3);
    const q = [0.05, 2, 1e4];
    const rl = larmorRadius(500, 2.014, 1, 3);
    orbitSigma(out, q, [{ E_keV: 500, A: 2.014, Z: 1, weight: 1 }], 3, 1, 1);
    expect(rel(out[0], (ORBIT_RMS * 0.2 * rl) / 1)).toBeLessThan(1e-12);
    expect(rel(out[1], (ORBIT_RMS * 2 * rl) / 1)).toBeLessThan(1e-12);
    expect(out[2]).toBe(MAX_SIGMA);
    orbitSigma(out, q, [{ E_keV: 500, A: 2.014, Z: 1, weight: 1 }], 3, 1, 0);
    expect([...out]).toEqual([0, 0, 0]);
    // the rms of several birth energies is the power-weighted rms of their Larmor radii
    orbitSigma(out, [1, 1, 1], [{ E_keV: 100, A: 2.014, Z: 1, weight: 3 }, { E_keV: 400, A: 2.014, Z: 1, weight: 1 }], 3, 1, 1);
    const r1 = larmorRadius(100, 2.014, 1, 3), r2 = larmorRadius(400, 2.014, 1, 3);
    expect(rel(out[0], ORBIT_RMS * Math.sqrt((3 * r1 * r1 + r2 * r2) / 4))).toBeLessThan(1e-12);
  });
});

describe('the orbit kernel', () => {
  const N = 40;
  const g = grid(N);

  it('every row is a probability distribution: p_ji >= 0 and sum_i p_ji = 1 (energy is not created or lost)', () => {
    const sigma = new Float64Array(N);
    for (let j = 0; j < N; j++) sigma[j] = 0.02 + 0.2 * (j / N);
    const T = new Float64Array(N * N);
    orbitKernel(T, g.rhoC, g.dRhoC, g.dV, sigma);
    for (let j = 0; j < N; j++) {
      let s = 0;
      for (let i = 0; i < N; i++) { expect(T[j * N + i]).toBeGreaterThanOrEqual(0); s += T[j * N + i]; }
      expect(Math.abs(s - 1)).toBeLessThan(1e-13);
    }
  });

  it('a vanishing width is the identity', () => {
    const T = new Float64Array(N * N);
    orbitKernel(T, g.rhoC, g.dRhoC, g.dV, new Float64Array(N));
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) expect(T[j * N + i]).toBe(i === j ? 1 : 0);
  });

  it('smoothing a source conserves its integral to round-off and widens it; the profile of an on-axis source is finite and monotone at the axis', () => {
    const f = new PoolField(N);
    const sigma = new Float64Array(N).fill(0.08);
    f.setKernel(g, sigma);
    const P = new Float64Array(N);
    for (let i = 0; i < N; i++) P[i] = 1e6 * Math.exp(-((g.rhoC[i] / 0.15) ** 2));
    f.smooth(g.dV, P);
    let before = 0, after = 0;
    for (let i = 0; i < N; i++) { before += P[i] * g.dV[i]; after += f.S[i] * g.dV[i]; }
    expect(rel(after, before)).toBeLessThan(1e-13);
    for (let i = 0; i < N; i++) expect(Number.isFinite(f.S[i]) && f.S[i] >= 0).toBe(true);
    // the peak is lower and the wings are higher than the birth profile
    expect(f.S[0]).toBeLessThan(P[0]);
    expect(f.S[N - 8]).toBeGreaterThan(P[N - 8]);
    // no 1/rho cusp at the axis: the first cells vary smoothly (a Gaussian in rho divided by the volume of the cell would diverge)
    expect(f.S[0]).toBeLessThan(1.5 * f.S[1]);
    expect(f.S[0]).toBeGreaterThan(0.5 * f.S[1]);
  });

  it('a wide source is renormalised to the plasma: the ions born near the edge are not lost', () => {
    const f = new PoolField(N);
    f.setKernel(g, new Float64Array(N).fill(0.3));
    const P = new Float64Array(N);
    P[N - 2] = 1e6; P[N - 1] = 1e6;
    f.smooth(g.dV, P);
    let before = 0, after = 0;
    for (let i = 0; i < N; i++) { before += P[i] * g.dV[i]; after += f.S[i] * g.dV[i]; }
    expect(rel(after, before)).toBeLessThan(1e-13);
  });

  it('the second moment of the displacement is the width: an ion born mid-radius spreads with an rms of about sigma', () => {
    const sigma = 0.06;
    const T = new Float64Array(N * N);
    orbitKernel(T, g.rhoC, g.dRhoC, g.dV, new Float64Array(N).fill(sigma));
    const j = 20; // rho = 0.5125
    let m1 = 0, m2 = 0;
    for (let i = 0; i < N; i++) { m1 += T[j * N + i] * g.rhoC[i]; }
    for (let i = 0; i < N; i++) { m2 += T[j * N + i] * (g.rhoC[i] - m1) ** 2; }
    // the radial rms of an isotropic 2D Gaussian of rms sigma per direction, seen at rho = 0.51 from the axis: about sigma (the weight dV/rho of the
    // annulus and the cell size of 0.025 add a few per cent)
    expect(Math.sqrt(m2)).toBeGreaterThan(0.85 * sigma);
    expect(Math.sqrt(m2)).toBeLessThan(1.25 * sigma);
    expect(Math.abs(m1 - g.rhoC[j])).toBeLessThan(0.15 * sigma);
  });
});

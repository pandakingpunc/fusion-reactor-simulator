/**
 * The helical-flux-conserving poloidal-flux reset of Kadomtsev's reconnection (events/kadomtsev.ts) against the analytic q profile q = 0.75 + 2.5 ρ̂²
 * (helical flux s(Φ̃) = 0.4 ln(1 + 10Φ̃/3) − Φ̃, Φ̃ = ρ̂²): the mixing radius, the pairing of the surfaces of equal helical flux with their volume
 * added, the continuity of ψ, q > 1 in the mixed region, and the fallbacks.
 */
import { describe, expect, it } from 'vitest';
import { JET_15D } from '../../presets';
import { ProfileModel } from '../model';
import { kadomtsevMixingRadius, qFromDpsi } from '../mhd';
import { kadomtsevReset } from './kadomtsev';

const q0 = 0.75, qa = 2.5;
const qAn = (r: number) => q0 + qa * r * r;
/** helical flux in units of Φ_b/2π at Φ̃ = ρ² */
const sAn = (x: number) => (1 / qa) * Math.log(1 + (qa * x) / q0) - x;

/** A grid of the JET15 model with q on the faces and ψ at the cell centres for the q profile qf (analytic ψ = (Φ_b/2π) ∫ dΦ̃/q for the default profile) */
function setup(qf: (rho: number) => number = qAn) {
  const m = new ProfileModel(JET_15D);
  const g = m.ctx.tg, N = m.ctx.N;
  const qF = new Float64Array(N + 1);
  for (let f = 0; f <= N; f++) qF[f] = qf(g.rhoF[f]);
  // ψ(ρ_c) = ∫_0^{ρ_c} Φ_b ρ/(π q) dρ by Simpson panels on the analytic q
  const psi = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const R = g.rhoC[i], n = 400;
    let s = 0;
    for (let k = 0; k < n; k++) { const r = ((k + 0.5) / n) * R; s += (g.PhiB * r) / (Math.PI * qf(r)) * (R / n); }
    psi[i] = s;
  }
  return { g, N, qF, psi };
}

/** the root of s(x) = level on the inner (x < 0.1, s rising) or outer (x > 0.1, s falling) branch, by bisection */
function branch(level: number, inner: boolean): number {
  let lo = inner ? 0 : 0.1, hi = inner ? 0.1 : 0.9;
  for (let it = 0; it < 200; it++) {
    const m = 0.5 * (lo + hi);
    if ((sAn(m) > level) === inner) hi = m; else lo = m;
  }
  return 0.5 * (lo + hi);
}

describe('the reset of the poloidal flux', () => {
  it('finds the q = 1 surface and the mixing radius of the analytic profile', () => {
    const { g, qF, psi } = setup();
    const r = kadomtsevReset(g, qF, psi)!;
    expect(r).not.toBeNull();
    expect(Math.abs(r.rho1 - Math.sqrt(0.1))).toBeLessThan(2e-3);
    // s(Φ̃_mix) = 0
    let lo = 0.1, hi = 0.9;
    for (let it = 0; it < 100; it++) { const m = 0.5 * (lo + hi); if (sAn(m) > 0) lo = m; else hi = m; }
    expect(Math.abs(r.rhoMix - Math.sqrt(lo))).toBeLessThan(5e-3);
    expect(Math.abs(r.s1 - sAn(0.1))).toBeLessThan(2e-3 * sAn(0.1) + 1e-5);
    // the trapezoid mixing radius of mhd.ts is the same to the grid
    expect(Math.abs(kadomtsevMixingRadius(g, qF) - r.rhoMix)).toBeLessThan(0.03);
  });

  it('every new surface holds the helical flux of the two old ones it joins, with their volumes added: s_new(Φ̃_out − Φ̃_in) = s(Φ̃_in) = s(Φ̃_out)', () => {
    const { g, N, qF, psi } = setup();
    const before = Float64Array.from(psi);
    const r = kadomtsevReset(g, qF, psi)!;
    const k = g.PhiB / (2 * Math.PI);
    // ψ_ref: the old flux at ρ_mix (linear between the centres)
    let ic = 0;
    while (g.rhoC[ic + 1] < r.rhoMix) ic++;
    const t = (r.rhoMix - g.rhoC[ic]) / (g.rhoC[ic + 1] - g.rhoC[ic]);
    const psiRef = before[ic] + t * (before[ic + 1] - before[ic]);
    const phMix = r.rhoMix * r.rhoMix;
    let checked = 0, worst = 0;
    for (let i = 0; i < N && g.rhoC[i] < r.rhoMix; i++) {
      const ph = g.rhoC[i] ** 2;
      const level = (psi[i] - psiRef) / k - ph + phMix; // the helical flux of the new surface
      expect(level).toBeGreaterThanOrEqual(-1e-9);
      expect(level).toBeLessThanOrEqual(sAn(0.1) * (1 + 5e-3));
      // the two old surfaces of that level and the volume they leave together
      const pin = branch(level, true), pout = branch(level, false);
      worst = Math.max(worst, Math.abs(pout - pin - ph));
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
    // the grid is 0.02 wide in ρ̂: Φ̃ = ρ̂² is known to about 2 ρ̂ dρ̂ ≈ 0.02
    expect(worst).toBeLessThan(0.012);
  });

  it('q > 1 in the whole mixed region, q → 1 on the axis, ψ increasing, ψ outside the mixing radius untouched (bitwise), ψ continuous through it', () => {
    const { g, N, qF, psi } = setup();
    const before = Float64Array.from(psi);
    const r = kadomtsevReset(g, qF, psi)!;
    const dpsiF = new Float64Array(N + 1), qNew = new Float64Array(N + 1), qC = new Float64Array(N);
    for (let f = 1; f < N; f++) dpsiF[f] = (psi[f] - psi[f - 1]) / g.distF[f];
    dpsiF[N] = (before[N - 1] - before[N - 2]) / g.distF[N - 1];
    qFromDpsi(g, dpsiF, qNew, qC);
    let iMix = 0;
    while (g.rhoC[iMix + 1] < r.rhoMix) iMix++;
    for (let f = 2; f <= iMix; f++) {
      expect(dpsiF[f]).toBeGreaterThan(0);
      expect(qNew[f]).toBeGreaterThan(1 - 1e-3);
    }
    expect(r.q0New).toBeGreaterThan(1);
    expect(r.q0New).toBeLessThan(1.2);
    for (let i = iMix + 1; i < N; i++) expect(psi[i]).toBe(before[i]);
    // continuous: the last reset cell and the first untouched one differ by the old slope over a cell (no jump of ψ)
    const slopeOld = (before[iMix + 1] - before[iMix]) / (g.rhoC[iMix + 1] - g.rhoC[iMix]);
    expect(Math.abs(psi[iMix + 1] - psi[iMix])).toBeLessThan(1.5 * slopeOld * (g.rhoC[iMix + 1] - g.rhoC[iMix]) + 1e-12);
    // the reset differs from the old profile inside the mixing radius (there was a q < 1 core)
    expect(psi[0]).not.toBe(before[0]);
  });

  it('no reconnection (null, ψ untouched) without a q = 1 surface, or when the helical flux does not return to its axis value before ρ = 0.95', () => {
    const above = setup((r) => 1.05 + r * r);
    const psi0 = Float64Array.from(above.psi);
    expect(kadomtsevReset(above.g, above.qF, above.psi)).toBeNull();
    expect(Array.from(above.psi)).toEqual(Array.from(psi0));
    // q hardly above 1 outside: 1/q − 1 stays ≈ −0.01 and the helical flux of the core is never given back
    const flat = setup((r) => 0.9 + 0.12 * r * r);
    const before = Float64Array.from(flat.psi);
    expect(kadomtsevReset(flat.g, flat.qF, flat.psi, 0.4)).toBeNull();
    expect(Array.from(flat.psi)).toEqual(Array.from(before));
  });
});

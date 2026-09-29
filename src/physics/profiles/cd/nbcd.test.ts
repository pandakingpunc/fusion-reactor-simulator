/**
 * Neutral-beam current drive of the 'physics' current-drive model (cd/nbcd.ts): the shielding factor of Start and Cordey, the fast-ion current of
 * the Gaffey distribution against a brute-force moment of the distribution itself, the birth pitch of the chord, and the source in a JET15 model.
 */
import { describe, expect, it } from 'vitest';
import { criticalEnergy, spitzerSlowingDownTime } from '../../heating';
import { ITER_15D, JET_15D } from '../../presets';
import type { MagneticConfig } from '../../types';
import { gaffeyCurrentIntegral, gaffeyDistribution, pitchScatteringZhat } from '../fastions/slowingDown';
import { ProfileModel } from '../model';
import { NbiChord, volumeIntegral } from '../sources/deposition';
import { fastIonCurrentDensity, shieldingFactor, startCordeyG } from './nbcd';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

const physicsCfg = (cfg: MagneticConfig, extra: Partial<NonNullable<MagneticConfig['profiles']>> = {}): MagneticConfig => ({
  ...cfg, profiles: { ...cfg.profiles, cdModel: 'physics', ...extra },
});

describe('the shielding factor of Start and Cordey (Phys. Fluids 23 (1980) 1477, the fit of Mikkelsen and Singer 1983)', () => {
  it('G(Z, ε) = (1.55 + 0.85/Z) √ε − (0.20 + 1.55/Z) ε, with the coefficients of the paper', () => {
    // Z = 1: 2.40 √ε − 1.75 ε; Z = 2: 1.975 √ε − 0.975 ε
    expect(startCordeyG(1, 0.1)).toBeCloseTo(2.4 * Math.sqrt(0.1) - 1.75 * 0.1, 12);
    expect(startCordeyG(2, 0.25)).toBeCloseTo(1.975 * 0.5 - 0.975 * 0.25, 12);
    expect(startCordeyG(1.6, 0.3)).toBeCloseTo((1.55 + 0.85 / 1.6) * Math.sqrt(0.3) - (0.2 + 1.55 / 1.6) * 0.3, 12);
  });
  it('vanishes on the axis, stays in [0, 1] and grows with ε up to the trapped fraction of the model', () => {
    expect(startCordeyG(1.5, 0)).toBe(0);
    let prev = 0;
    for (const e of [0.01, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5]) {
      const G = startCordeyG(1.5, e);
      expect(G).toBeGreaterThan(prev);
      expect(G).toBeLessThan(1);
      prev = G;
    }
  });
  it('F = 1 − (Z_b/Z_eff)(1 − G): on the axis the electrons cancel the current of the fast ions for Z_eff = Z_b, and leave 1 − Z_b/Z_eff otherwise', () => {
    expect(shieldingFactor(1, 1, 0)).toBe(0);
    expect(shieldingFactor(1, 2, 0)).toBeCloseTo(0.5, 14);
    expect(shieldingFactor(1, 1.5, 0)).toBeCloseTo(1 / 3, 14);
    // outside the axis the trapped electrons carry less of the return current, F increases with ε and reaches 1 − (Z_b/Z_eff)(1 − G) < 1
    expect(shieldingFactor(1, 1.5, 0.2)).toBeGreaterThan(shieldingFactor(1, 1.5, 0.05));
    expect(shieldingFactor(1, 1.5, 0.3)).toBeCloseTo(1 - (1 / 1.5) * (1 - startCordeyG(1.5, 0.3)), 14);
    expect(shieldingFactor(1, 1.5, 0.3)).toBeLessThan(1);
    // more impurities (larger Z_eff) shield less
    expect(shieldingFactor(1, 3, 0.1)).toBeGreaterThan(shieldingFactor(1, 1.5, 0.1));
  });
});

describe('the current of the fast ions, e Z_b S τ_s v_b ξ_b I(y_c, Ẑ)', () => {
  const plasma = { Te: 8, ne: 6e19, A: 2.014, Z: 1, Eb: 110, ionSum: 0.5, zeff: 1.4, S: 1.2e18, xi: 0.7 };

  it('equals the parallel moment of the Gaffey distribution of the same source, integrated over the pitch and the speed with no code in common', () => {
    const Ec = criticalEnergy(plasma.Te, plasma.A, plasma.ionSum);
    const tauS = spitzerSlowingDownTime(plasma.Te, plasma.ne, plasma.A, plasma.Z);
    const mass = plasma.A * 1.66053906660e-27;
    const vb = Math.sqrt((2 * plasma.Eb * 1.602176634e-16) / mass), vc = vb * Math.sqrt(Ec / plasma.Eb);
    const Zhat = pitchScatteringZhat(plasma.zeff, plasma.ionSum, plasma.A);
    // ∫ v_∥ f d³v = 2π ∫∫ (ξ v) f v² dv dξ over the distribution of slowingDown.ts (Legendre terms up to l = 4, the l = 1 term carries the flow)
    const ub = vb / vc, nu = 600, nxi = 400;
    let sum = 0;
    for (let a = 0; a < nu; a++) {
      const u = ((a + 0.5) / nu) * ub;
      for (let b = 0; b < nxi; b++) {
        const xi = -1 + ((b + 0.5) / nxi) * 2;
        sum += gaffeyDistribution(u, xi, ub, plasma.xi, Zhat, plasma.S, tauS, vc) * xi * (u * vc) ** 3 * vc * (ub / nu) * (2 / nxi);
      }
    }
    const flow = 2 * Math.PI * sum;
    const J = fastIonCurrentDensity(plasma);
    expect(rel(J, 1.602176634e-19 * plasma.Z * flow)).toBeLessThan(2e-4);
  });

  it('the 12-node integral of the model agrees with the 24-node one to 1e-6 over y_c = 0.05 … 3 and Ẑ = 0.3 … 6', () => {
    let worst = 0;
    for (const yc of [0.05, 0.2, 0.5, 0.8, 1, 1.5, 2, 3]) for (const Z of [0.3, 1, 2.5, 6]) worst = Math.max(worst, rel(gaffeyCurrentIntegral(yc, Z, 12), gaffeyCurrentIntegral(yc, Z, 24)));
    expect(worst).toBeLessThan(1e-6);
  });

  it('is proportional to the source and to the pitch, zero without a source, and larger at higher T_e (τ_s ∝ T_e^{3/2})', () => {
    const J = fastIonCurrentDensity(plasma);
    expect(J).toBeGreaterThan(0);
    expect(rel(fastIonCurrentDensity({ ...plasma, S: 2 * plasma.S }), 2 * J)).toBeLessThan(1e-13);
    expect(rel(fastIonCurrentDensity({ ...plasma, xi: 0.35 }), 0.5 * J)).toBeLessThan(1e-13);
    expect(fastIonCurrentDensity({ ...plasma, S: 0 })).toBe(0);
    expect(fastIonCurrentDensity({ ...plasma, Te: 16 })).toBeGreaterThan(J);
  });

  it('with no scattering and E_b ≫ E_c the current is e Z_b S τ_s v_b ξ_b (I → 1): the fast ions carry their birth parallel velocity for a slowing-down time', () => {
    const p = { ...plasma, Eb: 5000, ionSum: 1e-4 };
    const tauS = spitzerSlowingDownTime(p.Te, p.ne, p.A, p.Z);
    const vb = Math.sqrt((2 * p.Eb * 1.602176634e-16) / (p.A * 1.66053906660e-27));
    // Ẑ = zeff/(A ionSum) is huge here; test the Ẑ = 0 limit through the plain integral instead
    expect(gaffeyCurrentIntegral(1e-3, 0)).toBeGreaterThan(0.99);
    expect(fastIonCurrentDensity({ ...p, zeff: 1e-6 }, 1e-6 * p.Eb) / (1.602176634e-19 * p.S * tauS * vb * p.xi)).toBeGreaterThan(0.99);
  });
});

describe('the birth pitch of the beam chord (NbiChord.deposit)', () => {
  const m = new ProfileModel(JET_15D);
  const g = m.ctx.tg, N = m.ctx.N;
  const ne = new Float64Array(N).fill(5e19);

  it('is R_tan/R along the chord, weighted by the power deposited: between R_tan/R_max and 1, the same kernel as the power', () => {
    const Rt = 0.9 * g.R0;
    const chord = new NbiChord(g, Rt);
    const dep = new Float64Array(N), pitch = new Float64Array(N);
    const r = chord.deposit(ne, 110, 2.014, dep, pitch);
    expect(r.shine).toBeGreaterThan(0);
    for (let i = 0; i < N; i++) {
      expect(pitch[i]).toBeGreaterThan(Rt / g.RoutF[N] - 1e-9);
      expect(pitch[i]).toBeLessThanOrEqual(1);
    }
    // the deposition is unchanged by asking for the pitch (bitwise)
    const dep2 = new Float64Array(N);
    new NbiChord(g, Rt).deposit(ne, 110, 2.014, dep2);
    expect(Array.from(dep2)).toEqual(Array.from(dep));
    // a more tangential beam (larger R_tan) has the larger pitch cosine everywhere it deposits
    const dep3 = new Float64Array(N), pitch3 = new Float64Array(N);
    new NbiChord(g, 0.5 * g.R0).deposit(ne, 110, 2.014, dep3, pitch3);
    const i0 = Array.from(dep).findIndex((x) => x > 0.5 * Math.max(...dep));
    expect(pitch[i0]).toBeGreaterThan(pitch3[i0]);
    // on the axis (the chord passes at R ≈ R_axis there) the pitch is R_tan/R_axis to the grid resolution
    expect(pitch[0]).toBeGreaterThan(0.8 * Rt / g.Raxis);
    expect(pitch[0]).toBeLessThan(1.05 * Rt / g.Raxis + 0.05);
  });
});

describe("the NBCD source in a JET15 model (cdModel 'physics')", () => {
  /** A model with T_e, n_e profiles set and the sources' current hooks evaluated on them */
  function evaluated(cfg: MagneticConfig, Te0: number, ne0: number) {
    const m = new ProfileModel(cfg);
    const y = m.initialState();
    const st = m.ctx.view(y);
    const g = m.ctx.tg;
    for (let i = 0; i < m.ctx.N; i++) {
      const r = g.rhoC[i];
      st.Te[i] = 0.3 + Te0 * (1 - r * r) ** 1.5; st.Ti[i] = 0.9 * st.Te[i]; st.ne[i] = ne0 * (1 - 0.3 * r * r);
    }
    const K = m.physics.evaluateWorkArrays(100, st);
    m.ctx.w.jcdB.fill(0);
    for (const s of m.physics.sources) s.current?.(m.ctx, st, K);
    return { m, K, st, I: (jB: ArrayLike<number>) => volumeIntegral(g, Array.from(jB, (jb, i) => jb / (2 * Math.PI * g.RgeoC[i] * g.B0))) };
  }

  it('the beam current is in w.jcdB and in the diagnostics part; the legacy scaling adds none; ECCD off drives nothing', () => {
    const { m, I } = evaluated(physicsCfg(JET_15D), 8, 6e19);
    const w = m.ctx.w, parts = m.ctx.cdParts!;
    expect(parts).toBeTruthy();
    expect(m.physics.sources.map((s) => s.id)).toEqual(['nbi', 'nbcd', 'rf', 'eccd', 'fusion', 'radiation', 'exchange']);
    for (let i = 0; i < m.ctx.N; i++) {
      expect(parts.nbcd[i]).toBeGreaterThanOrEqual(0);
      expect(parts.eccd[i]).toBe(0);
      expect(w.jcdB[i]).toBe(parts.nbcd[i] + parts.eccd[i]);
    }
    const Inb = I(parts.nbcd);
    // a JET-size beam of 29 MW: order of a megampere at this density, not the tens the legacy ε-free scalings can reach at low n
    expect(Inb).toBeGreaterThan(0.3e6);
    expect(Inb).toBeLessThan(2.5e6);
    // legacy: the scaling of sources/nbi.ts
    const leg = evaluated(JET_15D, 8, 6e19);
    expect(leg.m.ctx.cdParts).toBeNull();
    expect(leg.I(leg.m.ctx.w.jcdB)).toBeGreaterThan(0);
  });

  it('shielding: a plasma with more impurities (larger Z_eff) drives more current at the same source, T_e and n_e; the current falls with density (τ_s ∝ 1/n)', () => {
    const lo = evaluated(physicsCfg(JET_15D), 8, 4e19);
    const hi = evaluated(physicsCfg(JET_15D), 8, 8e19);
    expect(lo.I(lo.m.ctx.cdParts!.nbcd)).toBeGreaterThan(hi.I(hi.m.ctx.cdParts!.nbcd));
    const dirty = evaluated(physicsCfg({ ...JET_15D, impurity: { ...JET_15D.impurity, concentration: 0.05 } }), 8, 6e19);
    const clean = evaluated(physicsCfg({ ...JET_15D, impurity: { ...JET_15D.impurity, concentration: 0.005 } }), 8, 6e19);
    expect(dirty.m.ctx.volAvg(dirty.m.ctx.w.Zeff)).toBeGreaterThan(clean.m.ctx.volAvg(clean.m.ctx.w.Zeff));
    expect(dirty.I(dirty.m.ctx.cdParts!.nbcd)).toBeGreaterThan(clean.I(clean.m.ctx.cdParts!.nbcd));
  });

  it('ITER (33 MW at 1 MeV) with T_e0 = 18 keV, n̄ = 1e20 m^-3: the efficiency γ = I n̄ R/P is that of the literature, 0.2-0.4 × 10^20 A W^-1 m^-2 (ITER negative-ion NBI design studies), and larger with a hotter plasma', () => {
    const at = (Te0: number) => {
      const e = evaluated(physicsCfg(ITER_15D, { nbiRtan: 0.85 }), Te0, 1.1e20);
      const nbar = e.m.ctx.lineAvg(e.st.ne);
      return { gamma: (e.I(e.m.ctx.cdParts!.nbcd) * (nbar / 1e20) * e.m.ctx.tg.R0) / (e.K.P_NBI * (1 - e.K.shine)), nbar };
    };
    const ref = at(18);
    expect(ref.nbar / 1e20).toBeGreaterThan(0.95);
    expect(ref.nbar / 1e20).toBeLessThan(1.05);
    expect(ref.gamma).toBeGreaterThan(0.2);
    expect(ref.gamma).toBeLessThan(0.4);
    expect(at(25).gamma).toBeGreaterThan(ref.gamma);
    expect(at(12).gamma).toBeLessThan(ref.gamma);
  });
});

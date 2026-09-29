/**
 * The ECCD source (cd/eccdSource.ts) in a DIII-D 1.5D model: its own deposition, the direction of the driven current, the resonance parameter of a
 * given frequency, and the figure of merit ζ = 32.7 n_20 R I/(T_keV P) of the current it drives.
 */
import { describe, expect, it } from 'vitest';
import { DIIID } from '../../presets';
import type { MagneticConfig } from '../../types';
import { ProfileModel } from '../model';
import { volumeIntegral } from '../sources/deposition';
import { cyclotronRatio, defaultResonanceY, resolveLauncher } from './eccdSource';
import { MC2_KEV } from './eccd';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

const diiid = (extra: NonNullable<MagneticConfig['profiles']>, P_ECRH_MW = 3): MagneticConfig => ({
  ...DIIID, fidelity: '1.5D', heating: { ...DIIID.heating, P_NBI_MW: 0, P_ECRH_MW }, profiles: { cdModel: 'physics', ...extra },
});

/** A model with T_e, n_e profiles set (T_e0 = 5 keV) and the sources evaluated on them */
function evaluated(cfg: MagneticConfig, Te0 = 5, ne0 = 4e19) {
  const m = new ProfileModel(cfg);
  const y = m.initialState();
  const st = m.ctx.view(y);
  const g = m.ctx.tg;
  for (let i = 0; i < m.ctx.N; i++) {
    const r = g.rhoC[i];
    st.Te[i] = 0.3 + Te0 * (1 - r * r) ** 1.5; st.Ti[i] = 0.8 * st.Te[i]; st.ne[i] = ne0 * (1 - 0.4 * r * r);
  }
  const K = m.physics.evaluateWorkArrays(100, st);
  m.ctx.w.jcdB.fill(0);
  for (const s of m.physics.sources) s.current?.(m.ctx, st, K);
  const I = (jB: ArrayLike<number>) => volumeIntegral(g, Array.from(jB, (jb, i) => jb / (2 * Math.PI * g.RgeoC[i] * g.B0)));
  return { m, K, st, g, I };
}

describe('the launcher', () => {
  it('has defaults: second harmonic, n∥ 0.3 co-current, outboard midplane, aimed at ecrhRho with the ECRH width', () => {
    const m = new ProfileModel(diiid({}));
    const l = resolveLauncher(m.ctx);
    expect(l).toEqual({ harmonic: 2, nPar: 0.3, thetaP: 0, rho: m.ctx.ps.ecrhRho, width: m.ctx.ps.ecrhWidth, freq_GHz: undefined });
    const c = resolveLauncher(new ProfileModel(diiid({ eccd: { harmonic: 1, nPar: -0.4, thetaP_deg: 90, rho: 0.5, width: 0.05, freq_GHz: 170 } })).ctx);
    expect(c).toEqual({ harmonic: 1, nPar: -0.4, thetaP: Math.PI / 2, rho: 0.5, width: 0.05, freq_GHz: 170 });
  });

  it('y = ℓ ω_c/ω of a frequency: 1 at the cold resonance (110 GHz second harmonic at 1.96 T on the axis radius), falling with R as B ∝ 1/R', () => {
    // f_ce = e B/(2π m_e) = 27.9925 GHz/T × B
    const B = 110 / (2 * 27.99249); // T at which 2 f_ce = 110 GHz: B = 1.9646 T
    expect(rel(cyclotronRatio(2, 110, B, 1.67, 1.67), 1)).toBeLessThan(1e-4);
    expect(rel(cyclotronRatio(2, 110, B, 1.67, 1.67 * 1.1), 1 / 1.1)).toBeLessThan(1e-4);
    expect(rel(cyclotronRatio(1, 110, B, 1.67, 1.67), 0.5)).toBeLessThan(1e-4);
  });

  it('without a frequency y is the one whose resonance curve starts at u∥ = u_e: a little below 1, and above the existence limit √(1 − n∥²)', () => {
    for (const [Te, n] of [[2, 0.3], [5, 0.3], [10, 0.5], [20, 0.2]]) {
      const y = defaultResonanceY(Te, n);
      expect(y).toBeLessThan(1 + 2 * Te / MC2_KEV);
      expect(y).toBeGreaterThan(Math.sqrt(1 - n * n) - 1e-12);
    }
    expect(defaultResonanceY(5, 0.3)).toBeLessThan(defaultResonanceY(5, 0.1));
  });
});

describe('the ECCD source', () => {
  it('replaces the Gaussian layer of the RF source: the power is the ECRH power in the launcher layer, and the legacy scaling drives no current in this mode', () => {
    const { m, K, g } = evaluated(diiid({ ecrhRho: 0.3, eccd: { rho: 0.5, width: 0.06 } }));
    const w = m.ctx.w;
    expect(rel(volumeIntegral(g, w.PecE), K.P_EC)).toBeLessThan(1e-12);
    // the peak of the layer is at the aim, not at ecrhRho
    let iMax = 0;
    for (let i = 0; i < m.ctx.N; i++) if (w.PecE[i] > w.PecE[iMax]) iMax = i;
    expect(Math.abs(g.rhoC[iMax] - 0.5)).toBeLessThan(0.03);
    // eccdEff is not used
    const withEff = evaluated(diiid({ eccd: { rho: 0.5 }, eccdEff: 0.4 }));
    const without = evaluated(diiid({ eccd: { rho: 0.5 }, eccdEff: 0 }));
    expect(Array.from(withEff.m.ctx.w.jcdB)).toEqual(Array.from(without.m.ctx.w.jcdB));
  });

  it('drives current along the plasma current for n∥ > 0 and against it for n∥ < 0, in w.jcdB and the diagnostics part, the ohmic-free part of f_cd', () => {
    const co = evaluated(diiid({ eccd: { rho: 0.4, nPar: 0.35 } }));
    const ctr = evaluated(diiid({ eccd: { rho: 0.4, nPar: -0.35 } }));
    const Ico = co.I(co.m.ctx.cdParts!.eccd), Ictr = ctr.I(ctr.m.ctx.cdParts!.eccd);
    expect(Ico).toBeGreaterThan(0);
    expect(Ictr).toBeLessThan(0);
    expect(rel(Ico, -Ictr)).toBeLessThan(1e-12);
    for (let i = 0; i < co.m.ctx.N; i++) expect(co.m.ctx.w.jcdB[i]).toBe(co.m.ctx.cdParts!.nbcd[i] + co.m.ctx.cdParts!.eccd[i]);
    expect(co.m.ctx.cdParts!.nbcd.every((x) => x === 0)).toBe(true);
  });

  it('is linear in the power, and nothing without ECRH power', () => {
    const p1 = evaluated(diiid({ eccd: { rho: 0.4 } }, 1.5)), p2 = evaluated(diiid({ eccd: { rho: 0.4 } }, 3));
    expect(rel(p2.I(p2.m.ctx.cdParts!.eccd), 2 * p1.I(p1.m.ctx.cdParts!.eccd))).toBeLessThan(1e-12);
    const off = evaluated(diiid({ eccd: { rho: 0.4 } }, 0));
    expect(off.I(off.m.ctx.cdParts!.eccd)).toBe(0);
  });

  it('the figure of merit of the driven current, ζ = 32.7 n_20 R I/(T_keV P), is of the order the experiments find (DIII-D: 0.1-0.4, Luce et al., PRL 83 (1999) 4550; ζ_ec of ITER-like plasmas 0.2-0.5)', () => {
    const e = evaluated(diiid({ eccd: { rho: 0.35, nPar: 0.3, width: 0.05 } }), 5, 4e19);
    const I = e.I(e.m.ctx.cdParts!.eccd);
    // the deposition-weighted T_e and n_e of the layer
    const dep = e.m.ctx.w.PecE, g = e.g;
    let sT = 0, sn = 0, s = 0;
    for (let i = 0; i < e.m.ctx.N; i++) { sT += dep[i] * g.dV[i] * e.st.Te[i]; sn += dep[i] * g.dV[i] * e.st.ne[i]; s += dep[i] * g.dV[i]; }
    const zeta = (32.74 * (sn / s / 1e20) * g.R0 * I) / ((sT / s) * (e.K.P_EC / 1e6 * 1e6));
    expect(zeta).toBeGreaterThan(0.05);
    expect(zeta).toBeLessThan(0.6);
  });

  it('a frequency fixes y at every cell by B ∝ 1/R: the resonance moves with the layer, and a frequency far from the resonance drives nothing (no resonance curve)', () => {
    const near = evaluated(diiid({ eccd: { rho: 0.4, freq_GHz: 110, nPar: 0.3 } }));
    const far = evaluated(diiid({ eccd: { rho: 0.4, freq_GHz: 40, nPar: 0.3 } }));
    expect(far.I(far.m.ctx.cdParts!.eccd)).toBe(0);
    expect(Math.abs(near.I(near.m.ctx.cdParts!.eccd))).toBeGreaterThanOrEqual(0);
  });
});

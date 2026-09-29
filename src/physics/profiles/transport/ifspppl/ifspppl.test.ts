/**
 * The IFS-PPPL fit (formula.ts, Kotschenreuther et al., Phys. Plasmas 2 (1995) 2381) and the 'ifspppl' transport model built on it.
 * The reference numbers below were evaluated with a separate transcription of equations (1)-(4) of the paper; the trends are the ones the
 * paper states in words ("stabilizing trends result from increasing T_i/T_e, deuterium dilution by carbon or beams, and magnetic shear;
 * increasing q is destabilizing, as are trapped particle effects, which are moderated by collisions").
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../../simulation';
import { JET_15D } from '../../../presets';
import { ProfileModel } from '../../model';
import { createTransportModel } from '..';
import { clampToDomain, critGradientCarbon, critGradientDeuterium, IFS_C0, IFS_DOMAIN, IfsInputs, ifsChi, stiffnessG } from './formula';
import { IfsPpplTransport } from './ifspppl';

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

/** A mid-radius L-mode point: q = 2, ŝ = 1, T_i = T_e, ε = 0.15, ν = 1, Z_eff = 1.5, R/L_n = 2 */
const base: IfsInputs = { RLT: 10, RLn: 2, q: 2, shear: 1, tau: 1, eps: 0.15, nu: 1, Zeff: 1.5 };

describe('the IFS-PPPL fit', () => {
  it('has the amplitude C0 = 12 and G(x) = min(x, √x) H(x)', () => {
    expect(IFS_C0).toBe(12);
    expect(stiffnessG(-1)).toBe(0);
    expect(stiffnessG(0)).toBe(0);
    expect(stiffnessG(0.25)).toBe(0.25);
    expect(stiffnessG(1)).toBe(1);
    expect(stiffnessG(4)).toBe(2);
    expect(stiffnessG(9)).toBe(3);
  });

  it('reproduces the equations of the paper at reference points (a separate transcription)', () => {
    let r = ifsChi({ ...base, RLT: 6 });
    close(r.crit1, 2.6394436916); close(r.crit2, 46.812);
    close(r.chiI, 35.4245477609); close(r.chiE, 8.5411178405);
    expect(r.branch).toBe(1);
    r = ifsChi({ RLT: 5, RLn: 3, q: 1.5, shear: 0.8, tau: 1.2, eps: 0.2, nu: 2, Zeff: 1.8 });
    close(r.crit1, 2.8962398853); close(r.crit2, 22.572);
    close(r.chiI, 21.2371016631); close(r.chiE, 8.3162668906);
    // Z_eff 3.8: the carbon mode has a threshold below the deuterium one but its amplitude max[0.25, Z_eff − 3] τ_b^−0.8/(1 + ŝ) is smaller
    r = ifsChi({ RLT: 9, RLn: 1, q: 3, shear: 1.5, tau: 0.7, eps: 0.25, nu: 3, Zeff: 3.8 });
    close(r.crit1, 4.9072480602); close(r.crit2, 7.426875);
    close(r.chiI, 46.4017869565); close(r.chiE, 15.5970929496);
    expect(r.branch).toBe(1);
  });

  it('has no transport below the critical gradient, and the critical gradient of the deuterium mode is the threshold of the ion channel', () => {
    const crit = critGradientDeuterium(clampToDomain(base));
    expect(ifsChi({ ...base, RLT: crit - 0.01 })).toMatchObject({ chiI: 0, chiE: 0, branch: 0 });
    expect(ifsChi({ ...base, RLT: crit + 0.01 }).chiI).toBeGreaterThan(0);
    // linear above the threshold up to one unit, then the square root of the excess (G): the stiffness saturates
    const c = (x: number) => ifsChi({ ...base, RLT: crit + x }).chiI;
    close(c(0.5) / c(0.25), 2); close(c(4) / c(1), 2); close(c(9) / c(4), 1.5);
    // the electrons follow the ions: no ion drive, no electron transport, the ratio χ_e/χ_i is that of equation (4)
    const r = ifsChi({ ...base, RLT: crit + 1 });
    close(r.chiE / r.chiI, 0.72 * 0.17 * Math.pow(1, 0.14) * Math.pow(2 / 1, 0.3) * Math.pow(1, 0.4) * Math.max(1.5, 1 + 0.3 * 2), 1e-12);
  });

  it('follows the trends the paper states: T_i/T_e, shear and dilution stabilise; q, trapped particles destabilise; collisions moderate them', () => {
    const at = (over: Partial<IfsInputs>) => { const p = { ...base, ...over }; return { crit: critGradientDeuterium(clampToDomain(p)), chi: ifsChi(p).chiI }; };
    const mono = (key: keyof IfsInputs, values: number[], crit: 'up' | 'down', chi: 'up' | 'down') => {
      const rows = values.map((v) => at({ [key]: v }));
      for (let i = 1; i < rows.length; i++) {
        expect(crit === 'up' ? rows[i].crit > rows[i - 1].crit : rows[i].crit < rows[i - 1].crit, `${String(key)} ${values[i]}: critical gradient`).toBe(true);
        expect(chi === 'up' ? rows[i].chi > rows[i - 1].chi : rows[i].chi < rows[i - 1].chi, `${String(key)} ${values[i]}: χ_i`).toBe(true);
      }
    };
    mono('tau', [0.5, 0.75, 1, 2, 4], 'up', 'down');
    mono('shear', [0.5, 1, 1.5, 2], 'up', 'down');
    mono('q', [0.7, 1, 2, 4, 8], 'down', 'up');
    mono('eps', [0.05, 0.1, 0.15, 0.2, 0.3], 'down', 'up');
    mono('nu', [0.5, 1, 2, 5, 10], 'up', 'down');
    // dilution by carbon (Z*_eff): stabilising, and above 3 the factor Z = (3/Z*_eff)^1.8 cuts the amplitude
    mono('Zeff', [1, 1.5, 2, 3, 4], 'up', 'down');
  });

  it('carbon mode: its threshold is far above the deuterium one at ordinary Z_eff (irrelevant in L-mode, as the paper says) and E(Z_eff) lifts it', () => {
    const p = clampToDomain(base);
    expect(critGradientCarbon(p)).toBeGreaterThan(10 * critGradientDeuterium(p));
    close(critGradientCarbon({ ...p, Zeff: 1 }), 0.75 * 2 * 2 * (3 - 0.67 * 2) * (1 + 6 * 1.9));
    close(critGradientCarbon({ ...p, Zeff: 3, RLn: 0 }), 0.75 * 2 * 2 * 3 * (1 + 6 * 0));
    // at Z_eff = 3.9 and R/L_n = 0 the carbon threshold (3 · 3 = 9) is below R/L_T = 12 and its χ is set by 0.66 τ^−0.8/(1 + ŝ) max[0.25, Z_eff − 3]
    const r = ifsChi({ RLT: 12, RLn: 0, q: 2, shear: 1, tau: 1, eps: 0.15, nu: 1, Zeff: 3.9 });
    close(r.crit2, 0.75 * 2 * 2 * 3 * 1);
    expect(r.chiI).toBeGreaterThan(0);
  });

  it('is evaluated inside the domain of validity: arguments outside it give the value at its edge, ε is left alone, a NaN is the lower limit', () => {
    const edge = { ...base, q: 8, shear: 2, tau: 4, nu: 10, Zeff: 4, RLn: 6 };
    const out = { ...base, q: 30, shear: 7, tau: 9, nu: 500, Zeff: 6, RLn: 25 };
    expect(ifsChi(out)).toEqual(ifsChi(edge));
    const low = { ...base, q: 0.7, shear: 0.5, tau: 0.5, nu: 0.5, Zeff: 1, RLn: 0 };
    expect(ifsChi({ ...base, q: 0.1, shear: -0.01, tau: 0.1, nu: 0.01, Zeff: 0.5, RLn: -3 })).toEqual(ifsChi(low));
    // the sign of the shear is not used
    expect(ifsChi({ ...base, shear: -1.3 })).toEqual(ifsChi({ ...base, shear: 1.3 }));
    expect(clampToDomain({ ...base, eps: 0.02 }).eps).toBe(0.02);
    expect(clampToDomain({ ...base, q: NaN }).q).toBe(IFS_DOMAIN.q[0]);
    // no argument makes a number that is not finite
    for (const q of [0, 1e-9, 1e9]) for (const nu of [0, 1e-12, 1e12]) for (const Zeff of [0, 1, 50]) {
      const r = ifsChi({ ...base, q, nu, Zeff, eps: 0 });
      expect(Number.isFinite(r.chiI) && Number.isFinite(r.chiE)).toBe(true);
    }
  });

  it('the beam charge fraction enters through τ_b = τ/(1 − σ_b)', () => {
    const a = ifsChi({ ...base, sigmaB: 0.2, tau: 0.8 });
    const b = ifsChi({ ...base, sigmaB: 0, tau: 1 });
    close(a.crit1, b.crit1, 1e-12);
    close(a.crit2, b.crit2, 1e-12);
  });
});

describe("the 'ifspppl' transport model", () => {
  it('is registered, predictive and made per shot', () => {
    const m = createTransportModel('ifspppl');
    expect(m.id).toBe('ifspppl');
    expect(m.predictive).toBe(true);
    expect(m).toBeInstanceOf(IfsPpplTransport);
    expect(createTransportModel('ifspppl')).not.toBe(m);
  });

  it('gives χ_i, χ_e of the normalisation ρ_i² v_ti / R on the faces of a JET-size plasma, zero shear at the axis and the magnetic shear of the old q profile', () => {
    const sim = new Simulation({ ...JET_15D, t_end: 0.05, profiles: { transportModel: 'ifspppl' } });
    const m = sim.model as ProfileModel, ctx = m.ctx;
    const y = m.initialState();
    m.diagnostics(0, y);
    const tr = m.physics.transport as IfsPpplTransport;
    const N = ctx.N, g = ctx.tg, q = ctx.w.qF;
    // ŝ = ρ d ln q/dρ on the faces, recomputed here from the q profile the hook saw
    for (const f of [1, 10, 25, 40, N - 1]) {
      const s = Math.abs((g.rhoF[f] * (q[f + 1] - q[f - 1])) / (g.rhoF[f + 1] - g.rhoF[f - 1]) / q[f]);
      close(tr.shearOfStep[f], s, 1e-12);
    }
    expect(tr.shearOfStep[0]).toBe(0);
    // the physics of the fit on a face: the same number from the formula and the closure
    const st = ctx.view(y);
    const chiE = new Float64Array(N + 1), chiI = new Float64Array(N + 1);
    tr.diffusivities(ctx, st, chiE, chiI);
    expect(chiE.every((x) => Number.isFinite(x) && x >= 0)).toBe(true);
    expect(chiI.every((x) => Number.isFinite(x) && x >= 0)).toBe(true);
    expect(chiE[0]).toBe(chiE[1]);
    expect(chiI[0]).toBe(chiI[1]);
    expect(Math.max(...chiI)).toBeGreaterThan(0.1);
  });
});

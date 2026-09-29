/**
 * The EPED1-type pedestal and the Loarte ELM energy loss (profiles/pedestal/): the KBM width and the peeling–ballooning height as pure
 * functions against the numbers of the papers they come from, the shape of the ELM crash, and the model in short shots (defaults untouched,
 * the ELM at the limit, rewind and chunking bitwise, ITER15 against the published EPED prediction and its grid convergence).
 *
 * Published numbers used here (all read from the documents named in eped1.ts and loarte.ts):
 *  - Snyder 2009 (Nucl. Fusion 49 085035), quoted by Saarelma et al., Nucl. Fusion 52 (2012) 103020: ITER 15 MA pedestal pressure 92 kPa;
 *  - Snyder, APS-DPP 2010 summary slide: ITER β_N,ped = 0.6 to 0.7, Δψ ≈ 0.04 (95 to 111 kPa at 15 MA, 5.3 T, a = 2 m);
 *  - Snyder, ITER School 2015 (slide 47): the EPED H-mode branch for the ITER baseline, p_ped against n_ped Z_eff^{1/2};
 *  - Loarte et al., PPCF 45 (2003) 1549: ITER ν*_ped = 0.062, W_ped = 112 MJ, ΔW_ELM = 22 MJ.
 */
import { describe, expect, it } from 'vitest';
import { ITER_15D, JET_15D } from '../../presets';
import { Simulation } from '../../simulation';
import { runAllYielding } from '../../../testing/yielding';
import type { MagneticConfig, ProfileSettings, SimEvent } from '../../types';
import type { ProfileContext } from '../context';
import type { TriggerState } from '../events/EventModel';
import type { ProfileState } from '../state';
import { DEFAULT_PROFILE_SETTINGS } from '../defaults';
import { ElmEvents } from '../events/elm';
import { buildGrid, gridSpec } from '../geometry1d';
import { elmCrash } from '../mhd';
import { ProfileModel } from '../model';
import { checkProfileSettings } from '../settings';
import { barrierFactor } from '../transport/pedestal';
import {
  DIIID_PB_FIT, KBM_COEFFICIENT, MU0, PB_DENSITY_EXPONENT, PB_DENSITY_REF, PB_GRADIENT, PEDESTAL_GRID_WIDTH, kbmWidth, normalisedGradient, pbBeta,
  poloidalBeta, poloidalField, pressureOfBeta, rhoOfPsiN, solveEped1, widthInRho,
} from './eped1';
import { ELM_DEPTH_MAX, ELM_DEPTH_TYP, ELM_WIDTH_MAX, ELM_WIDTH_STD, elmShapeForEnergy, loarteElmLoss } from './elmSize';
import { LOARTE_FIT, LOARTE_ITER, coulombLogarithm, loarteEnergyFraction, pedestalCollisionality } from './loarte';
import { A_STEP_MAX, KBM_CAP, LN_A_MIN, PedestalModel, kbmClamp, pressureAt } from './PedestalModel';

const KEV = 1.602176634e-16;

/** ITER: 15 MA, 5.3 T, a = 2 m, and the perimeter of the LCFS of this code's ITER equilibrium (κ = 1.85, δ = 0.49) */
const ITER = { Ip: 15e6, BT: 5.3, a: 2, L: 18.43 };
const nGreenwald = (Ip: number, a: number) => Ip / 1e6 / (Math.PI * a * a) * 1e20;
/** β_N,ped [%] of a pedestal pressure [Pa] of the ITER shot */
const betaN = (p: number) => ((2 * MU0 * p) / (ITER.BT * ITER.BT)) * 100 * (ITER.a * ITER.BT) / (ITER.Ip / 1e6);
const pIter = (nHat: number) => pressureOfBeta(solveEped1({}, nHat / PB_DENSITY_REF).betaP, poloidalField(ITER.Ip, ITER.L));

/** The EPED H-mode branch for the ITER baseline (Snyder 2015): [n_ped Z_eff^{1/2} in 10¹⁹ m⁻³, p_ped in kPa] from the vector graphics of the slide */
const EPED_ITER_2015: readonly (readonly [number, number])[] = [
  [4.0, 64.25], [4.243, 65.59], [4.95, 69.56], [5.657, 73.46], [6.364, 77.45], [7.071, 81.24],
  [9.899, 85.16], [11.314, 89.0], [12.021, 92.91], [12.728, 96.85], [14.142, 100.55], [15.556, 104.52],
];
/** the published pressure at x = n_ped Z_eff^{1/2} [10¹⁹ m⁻³], log-log between the points */
function epedIter(x: number): number {
  const P = EPED_ITER_2015;
  let i = 0;
  while (i < P.length - 2 && x > P[i + 1][0]) i++;
  const [x0, y0] = P[i], [x1, y1] = P[i + 1];
  return Math.exp(Math.log(y0) + (Math.log(x / x0) * Math.log(y1 / y0)) / Math.log(x1 / x0));
}

/** least-squares slope of ln y against ln x */
function logSlope(pts: readonly (readonly [number, number])[]): number {
  const n = pts.length, sx = pts.reduce((s, [x]) => s + Math.log(x), 0), sy = pts.reduce((s, [, y]) => s + Math.log(y), 0);
  const sxx = pts.reduce((s, [x]) => s + Math.log(x) ** 2, 0), sxy = pts.reduce((s, [x, y]) => s + Math.log(x) * Math.log(y), 0);
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}

describe('KBM width and peeling–ballooning height (eped1.ts)', () => {
  it('the width is Δ = 0.076 β_p,ped^{1/2} (Snyder 2009; Groebner GA-A26243)', () => {
    expect(KBM_COEFFICIENT).toBe(0.076);
    expect(kbmWidth(1)).toBeCloseTo(0.076, 15);
    expect(kbmWidth(0.25)).toBeCloseTo(0.038, 15);
    expect(kbmWidth(4)).toBeCloseTo(0.152, 15);
    // quadrupling the pedestal beta doubles the width; no negative width
    expect(kbmWidth(0.64) / kbmWidth(0.16)).toBeCloseTo(2, 14);
    expect(kbmWidth(-1)).toBe(0);
    expect(kbmWidth(0.25, 0.1)).toBeCloseTo(0.05, 15);
  });

  it('β_p,ped = 2 μ0 p/B̄_p² and p = β_p B̄_p²/(2 μ0) are inverse, with B̄_p = μ0 I_p/L', () => {
    const Bp = poloidalField(ITER.Ip, ITER.L);
    expect(Bp).toBeCloseTo((MU0 * 15e6) / 18.43, 12);
    expect(Bp).toBeCloseTo(1.0228, 3);
    expect(poloidalBeta(pressureOfBeta(0.3, Bp), Bp)).toBeCloseTo(0.3, 14);
  });

  it('C is the DIII-D fit of the maximum gradient, (∇p)_max = 103 (I_p B_T)^0.94 kPa per ψ_N, at the top of its range, normalised by B̄_p²/2 μ0', () => {
    const grad = 103e3 * Math.pow(DIIID_PB_FIT.IpBT, 0.94);
    expect(grad / 1e3).toBeCloseTo(307.5, 0);
    const L = DIIID_PB_FIT.perimeterPerCircumference * 2 * Math.PI * DIIID_PB_FIT.a;
    expect(normalisedGradient(grad, DIIID_PB_FIT.Ip, L)).toBeCloseTo(PB_GRADIENT, 12);
    expect(PB_GRADIENT).toBeGreaterThan(6.1);
    expect(PB_GRADIENT).toBeLessThan(6.3);
    // the fit spans a factor of 3 in I_p and B_T (Fig. 3 of the report) and the reference point is at its top
    expect(DIIID_PB_FIT.IpBT).toBeGreaterThan(DIIID_PB_FIT.IpBTRange[1]);
    expect(DIIID_PB_FIT.IpBT).toBeLessThan(1.1 * DIIID_PB_FIT.IpBTRange[1]);
  });

  it('the constraints meet at the fixed point of Δ → 0.076 β_PB(Δ)^{1/2}: the pair of the KBM curve with gradient C', () => {
    const s = solveEped1();
    expect(s.converged).toBe(true);
    expect(s.iterations).toBeLessThan(200);
    expect(s.widthRef).toBeCloseTo(0.076 * 0.076 * PB_GRADIENT, 15);
    expect(s.betaRef).toBeCloseTo((0.076 * PB_GRADIENT) ** 2, 14);
    expect(s.width).toBeCloseTo(s.widthRef, 10);
    expect(s.betaP).toBeCloseTo(s.betaRef, 10);
    // both constraints are satisfied there: the KBM width of β and the P–B height of the width
    expect(kbmWidth(s.betaP)).toBeCloseTo(s.width, 10);
    expect(pbBeta(s.width)).toBeCloseTo(s.betaP, 10);
    // the maximum gradient of a tanh pedestal is p_ped/Δ, and it is C (in β_p per ψ_N)
    expect(s.betaP / s.width).toBeCloseTo(PB_GRADIENT, 8);
    // Δ^{3/4} rises more slowly than the Δ² of the KBM curve: at a larger width the P–B limit lies below the KBM pressure, at a smaller one above it (a unique crossing)
    expect(pbBeta(1.5 * s.width)).toBeGreaterThan(s.betaP);
    expect(kbmWidth(pbBeta(1.5 * s.width))).toBeLessThan(1.5 * s.width);
    expect(kbmWidth(pbBeta(0.5 * s.width))).toBeGreaterThan(0.5 * s.width);
  });

  it('a steeper limit gives a wider and higher pedestal, Δ ∝ C and β_p,ped ∝ C², and p_ped/Δ = C at every C', () => {
    const a = solveEped1({ pbGradient: 3 }), b = solveEped1({ pbGradient: 12 });
    expect(a.converged && b.converged).toBe(true);
    expect(b.width / a.width).toBeCloseTo(4, 8);
    expect(b.betaP / a.betaP).toBeCloseTo(16, 6);
    expect(a.betaP / a.width).toBeCloseTo(3, 8);
  });

  it('the pedestal density lifts the height as (n̂/0.5)^γ; γ = 0 removes the dependence', () => {
    const s1 = solveEped1({}, 1), s2 = solveEped1({}, 2);
    expect(s2.betaP / s1.betaP).toBeCloseTo(Math.pow(2, PB_DENSITY_EXPONENT), 8);
    expect(s2.width / s1.width).toBeCloseTo(Math.pow(2, PB_DENSITY_EXPONENT / 2), 8);
    expect(solveEped1({ densityExponent: 0 }, 3).betaP).toBeCloseTo(s1.betaP, 10);
    expect(solveEped1({ densityExponent: 0.5 }, 4).betaP / s1.betaP).toBeCloseTo(2, 8);
    // a density of zero does not divide by zero
    expect(Number.isFinite(solveEped1({}, 0).betaP)).toBe(true);
  });

  it('a zero, negative or missing coefficient or gradient is refused', () => {
    expect(() => solveEped1({ pbGradient: 0 })).toThrow(RangeError);
    expect(() => solveEped1({ kbmCoefficient: -0.07 })).toThrow(RangeError);
    expect(() => solveEped1({ pbGradient: NaN })).toThrow(/must be positive/);
  });
});

describe('against the published EPED prediction for the ITER baseline', () => {
  it('the exponent of the density lift is the one of the published curve (least squares over n Z_eff^{1/2} = 4 to 15.6·10¹⁹ m⁻³)', () => {
    const slope = logSlope(EPED_ITER_2015);
    expect(slope).toBeGreaterThan(0.3);
    expect(slope).toBeLessThan(0.38);
    expect(PB_DENSITY_EXPONENT).toBeCloseTo(slope, 1);
    // the curve is smooth: no point is off the power law by more than 5 %
    const c = Math.exp((EPED_ITER_2015.reduce((s, [, y]) => s + Math.log(y), 0) - slope * EPED_ITER_2015.reduce((s, [x]) => s + Math.log(x), 0)) / EPED_ITER_2015.length);
    for (const [x, y] of EPED_ITER_2015) expect(Math.abs(c * Math.pow(x, slope) / y - 1)).toBeLessThan(0.05);
  });

  it('ITER at 15 MA: Δ_ψ = 0.036 and 93 kPa at the middle of the DIII-D density range, against 92 kPa (Snyder 2009) and Δ_ψ ≈ 0.04', () => {
    const s = solveEped1();
    const p = pIter(0.5);
    expect(s.width).toBeGreaterThan(0.034);
    expect(s.width).toBeLessThan(0.046);
    expect(Math.abs(s.width / 0.04 - 1)).toBeLessThan(0.15);
    expect(p / 1e3).toBeGreaterThan(88);
    expect(p / 1e3).toBeLessThan(98);
    expect(Math.abs(p / 92e3 - 1)).toBeLessThan(0.1);
  });

  it('ITER at the pedestal density of the EPED baseline, n_ped = 7·10¹⁹ m⁻³: β_N,ped in the published 0.6 to 0.7 and T_ped = p/(2 n e) ≈ 4.5 keV', () => {
    const nHat = 7e19 / nGreenwald(ITER.Ip, ITER.a);
    expect(nHat).toBeCloseTo(0.586, 2);
    const p = pIter(nHat);
    // 95 to 111 kPa (β_N,ped 0.6 to 0.7), within 15 % of that band
    expect(betaN(p)).toBeGreaterThan(0.6 * 0.85);
    expect(betaN(p)).toBeLessThan(0.7 * 1.15);
    expect(p / 1e3).toBeGreaterThan(95 * 0.85);
    expect(p / 1e3).toBeLessThan(111 * 1.15);
    // the temperature that carries this pressure in EPED's convention (T_i = T_e, n_i = n_e): the published ITER T_ped is 4 to 5 keV (validation reference 4.5 ± 0.5)
    const Tp = p / (2 * 7e19 * KEV);
    expect(Math.abs(Tp / 4.5 - 1)).toBeLessThan(0.15);
    // the width of the same pedestal, published ≈ 0.04
    expect(Math.abs(solveEped1({}, nHat / PB_DENSITY_REF).width / 0.04 - 1)).toBeLessThan(0.15);
  });

  it('the pressure at every density of the published H-mode branch is within 25 % (Z_eff = 1.7 for the axis of the slide)', () => {
    const Zeff = 1.7;
    for (const [x] of EPED_ITER_2015) {
      const nPed = (x * 1e19) / Math.sqrt(Zeff);
      const ratio = pIter(nPed / nGreenwald(ITER.Ip, ITER.a)) / 1e3 / epedIter(x);
      expect(ratio).toBeGreaterThan(0.85);
      expect(ratio).toBeLessThan(1.25);
    }
  });
});

describe('the pedestal top in the radial coordinate (eped1.ts)', () => {
  const psiN = [0, 0.25, 0.5, 0.75, 1], rhoTor = [0, 0.5, 0.71, 0.87, 1];

  it('ρ̂ at ψ_N is linear between the table nodes and holds at its ends', () => {
    expect(rhoOfPsiN(psiN, rhoTor, 0.5)).toBe(0.71);
    expect(rhoOfPsiN(psiN, rhoTor, 0.625)).toBeCloseTo(0.79, 12);
    expect(rhoOfPsiN(psiN, rhoTor, -1)).toBe(0);
    expect(rhoOfPsiN(psiN, rhoTor, 2)).toBe(1);
    expect(rhoOfPsiN([], [], 0.5)).toBeNaN();
  });

  it('the width in ρ̂ is 1 − ρ̂(1 − Δψ), limited to [0.005, 0.25]', () => {
    expect(widthInRho(psiN, rhoTor, 0.25)).toBeCloseTo(0.13, 12);
    expect(widthInRho(psiN, rhoTor, 1e-6)).toBe(0.005);
    expect(widthInRho(psiN, rhoTor, 0.9)).toBe(0.25);
    // a table without a finite value gives the width in ψ_N (ρ̂ ≈ ψ_N)
    expect(widthInRho([0, 1], [NaN, NaN], 0.04)).toBeCloseTo(0.04, 12);
    expect(PEDESTAL_GRID_WIDTH).toBeGreaterThan(0.04);
    expect(PEDESTAL_GRID_WIDTH).toBeLessThan(0.05);
  });
});

describe('Loarte et al. (2003): ELM energy loss against the pedestal collisionality (loarte.ts)', () => {
  it('the fit gives the paper\'s ITER extrapolation to 5 % (ν*_ped = 0.062: ΔW_ELM/W_ped = 22/112) and decreases with ν*', () => {
    const f = loarteEnergyFraction(LOARTE_ITER.nuStar);
    expect(f).toBeCloseTo(0.189, 3);
    expect(Math.abs(f / (LOARTE_ITER.dWelm / LOARTE_ITER.Wped) - 1)).toBeLessThan(0.05);
    expect(loarteEnergyFraction(0.5)).toBeLessThan(loarteEnergyFraction(0.1));
    expect(loarteEnergyFraction(5)).toBeLessThan(loarteEnergyFraction(0.5));
  });

  it('is held at the ends of the plotted range, and a value that is not a number is the smallest collisionality', () => {
    expect(loarteEnergyFraction(1e-4)).toBe(loarteEnergyFraction(LOARTE_FIT.nuMin));
    expect(loarteEnergyFraction(100)).toBe(loarteEnergyFraction(LOARTE_FIT.nuMax));
    expect(loarteEnergyFraction(NaN)).toBe(loarteEnergyFraction(LOARTE_FIT.nuMin));
    expect(loarteEnergyFraction(LOARTE_FIT.nuMin)).toBeLessThan(0.25);
  });

  it('ν*_ped of the ITER pedestal (7·10¹⁹ m⁻³, 4 keV, q95 = 3) is the paper\'s 0.062 to 20 %, and W_ped = 3/2 n (T_e + T_i) V is its 112 MJ', () => {
    const nu = pedestalCollisionality(7e19, 4, 6.2, 2, 3);
    expect(Math.abs(nu / LOARTE_ITER.nuStar - 1)).toBeLessThan(0.2);
    const Wped = 1.5 * 7e19 * (4 + 4) * KEV * 831;
    expect(Math.abs(Wped / LOARTE_ITER.Wped - 1)).toBeLessThan(0.02);
    // ν* ∝ q95 n ln Λ / T²: linear in q95, doubling the density doubles it less the change of ln Λ, doubling the temperature quarters it up to ln Λ
    expect(pedestalCollisionality(7e19, 4, 6.2, 2, 6) / nu).toBeCloseTo(2, 12);
    expect(pedestalCollisionality(14e19, 4, 6.2, 2, 3) / nu).toBeCloseTo((2 * coulombLogarithm(14e19, 4)) / coulombLogarithm(7e19, 4), 12);
    expect(pedestalCollisionality(7e19, 8, 6.2, 2, 3) / nu).toBeCloseTo((0.25 * coulombLogarithm(7e19, 8)) / coulombLogarithm(7e19, 4), 12);
  });
});

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// the model
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const jet = (profiles: Partial<ProfileSettings>, tEnd = 1.5): MagneticConfig => ({ ...JET_15D, t_end: tEnd, profiles: { ...JET_15D.profiles, ...profiles } });
const EPED: Partial<ProfileSettings> = { pedestalModel: 'eped1' };
const EPED_LOARTE: Partial<ProfileSettings> = { pedestalModel: 'eped1', elmLoss: 'loarte' };

function shot(cfg: MagneticConfig) {
  const m = new ProfileModel(cfg);
  const y = m.initialState();
  const d0 = m.diagnostics(0, y);
  return { m, ctx: m.ctx, y, st: m.ctx.view(y), d0 };
}

describe('the pedestal model is opt-in: the default settings leave the pedestal alone', () => {
  it('no pedestal model, the width and the barrier of the settings, and no ped_ diagnostics', () => {
    // absent from the defaults (the UI reads them and the main chunk must not grow): an unset setting is the fixed pedestal and the fixed ELM size
    expect(DEFAULT_PROFILE_SETTINGS.pedestalModel).toBeUndefined();
    expect(DEFAULT_PROFILE_SETTINGS.elmLoss).toBeUndefined();
    const { ctx, d0 } = shot(jet({}, 0.2));
    expect(ctx.ped).toBeNull();
    expect(ctx.pedWidth).toBe(ctx.ps.pedestalWidth);
    expect(Object.keys(d0).filter((k) => k.startsWith('ped_'))).toEqual([]);
    // the factor of the barrier is the one of the settings: 1 − w (1 − etb) with w the tanh step at 1 − pedestalWidth
    for (const rho of [0.5, 0.93, 0.94, 0.95, 0.99]) {
      const w = 0.5 * (1 + Math.tanh((rho - (1 - ctx.ps.pedestalWidth)) / 0.01));
      expect(barrierFactor(ctx, rho)).toBe(1 - w * (1 - ctx.ps.etbFactor));
    }
    expect(gridSpec({ gridPacking: 4, pedestalWidth: ctx.ps.pedestalWidth })).toEqual(gridSpec(ctx.ps));
  });

  it('the pedestal model has its diagnostics from the first state, its width on the grid packing, and is a part of the checkpoint', () => {
    const { m, ctx, d0 } = shot(jet(EPED, 0.2));
    expect(ctx.ped).toBeInstanceOf(PedestalModel);
    for (const k of ['ped_width', 'ped_width_psi', 'ped_beta_p', 'ped_p', 'ped_p_lim', 'ped_ratio', 'ped_depth', 'ped_nu', 'ped_ne', 'ped_Ti', 'ped_Tp', 'ped_Te_elm', 'ped_p_elm', 'ped_Tp_elm']) {
      expect(Number.isFinite(d0[k]), k).toBe(true);
    }
    expect(d0.ped_width).toBeGreaterThan(0.02);
    expect(d0.ped_width).toBeLessThan(0.08);
    expect(d0.ped_p_lim).toBeGreaterThan(0);
    // the packing is for the EPED width, not for the 0.06 of the settings
    const g = gridSpec(ctx.ps)!;
    expect(g.width).toBeCloseTo(0.75 * PEDESTAL_GRID_WIDTH, 14);
    expect(g.rhoT).toBeCloseTo(1 - 1.25 * PEDESTAL_GRID_WIDTH, 14);
    expect(Object.keys(m.saveInternal())).toEqual(expect.arrayContaining(['ped_width', 'ped_lnA', 'ped_ratio', 'ped_elmSeen']));
  });

  it('ELMs off (events.elms false) or L-mode: the ELM margin is −1 whatever the pressure; in H-mode it is the pressure over the limit, minus one', () => {
    const { ctx, st } = shot(jet(EPED, 0.2));
    const state = (c: ProfileContext, s: ProfileState): TriggerState => ({ Te: s.Te, Ti: s.Ti, ne: s.ne, psi: s.psi, niOverNe: new Float64Array(c.N).fill(0.9), Ip: s.s.Ip });
    const ts = state(ctx, st);
    expect(ctx.ped!.margin(ctx, ts, undefined as never)).toBe(-1);
    ctx.hmode = true;
    const pTop = pressureAt(ctx.tg, ts.Te, ts.Ti, ts.ne, ts.niOverNe, 1 - ctx.ped!.width);
    ctx.ped!.pLim = pTop / 1.5;
    expect(ctx.ped!.margin(ctx, ts, undefined as never)).toBeCloseTo(0.5, 12);
    ctx.ped!.pLim = 0;
    expect(ctx.ped!.margin(ctx, ts, undefined as never)).toBe(-1);
    // no ELMs in the configuration
    const off = shot({ ...jet(EPED, 0.2), events: { ...JET_15D.events, elms: false } });
    off.ctx.hmode = true;
    off.ctx.ped!.pLim = 1;
    expect(off.ctx.ped!.margin(off.ctx, state(off.ctx, off.st), undefined as never)).toBe(-1);
  });
});

describe('the adaptive barrier (PedestalModel)', () => {
  const setup = () => { const s = shot(jet(EPED, 0.2)); return { ...s, ped: s.ctx.ped! }; };

  it('the clamp above the limit is r⁶ up to 30 and 1 below it', () => {
    expect(kbmClamp(0)).toBe(1);
    expect(kbmClamp(1)).toBe(1);
    expect(kbmClamp(1.2)).toBeCloseTo(1.2 ** 6, 12);
    expect(kbmClamp(3)).toBe(KBM_CAP);
  });

  it('deepens below the limit, relaxes above it, within [1/16, 1], and only in H-mode (an L-mode resets it)', () => {
    const { ctx, ped } = setup();
    ctx.hmode = true;
    ped.ratio = 0.5;
    ped.advance(ctx, 1e-3);
    expect(ped.lnA).toBeLessThan(0);
    const one = ped.lnA;
    ped.advance(ctx, 1e-3);
    expect(ped.lnA).toBeLessThan(one);
    // an above-limit pedestal relaxes it, never past the nominal depth
    ped.ratio = 2;
    for (let i = 0; i < 100; i++) ped.advance(ctx, 0.5);
    expect(ped.lnA).toBe(0);
    // a long deep step is limited per step, and the range has a floor
    ped.ratio = 0.1;
    ped.advance(ctx, 100);
    expect(ped.lnA).toBeCloseTo(-A_STEP_MAX, 12);
    for (let i = 0; i < 100; i++) ped.advance(ctx, 100);
    expect(ped.lnA).toBe(LN_A_MIN);
    expect(Math.exp(LN_A_MIN)).toBeCloseTo(1 / 16, 12);
    // no step, no change; no pedestal evaluated yet (r = 0), no change
    ped.advance(ctx, 0);
    expect(ped.lnA).toBe(LN_A_MIN);
    ped.lnA = -1; ped.ratio = 0;
    ped.advance(ctx, 1);
    expect(ped.lnA).toBe(-1);
    // L-mode: the barrier is not applied, and the next H-mode starts from the nominal depth
    ctx.hmode = false;
    ped.ratio = 0.5;
    ped.advance(ctx, 1e-3);
    expect(ped.lnA).toBe(0);
  });

  it('the barrier factor is 1 − w (1 − etbFactor A k): 1 inside, the depth at the top of the pedestal and beyond', () => {
    const { ctx, ped } = setup();
    ped.width = 0.045; ped.lnA = Math.log(0.25); ped.ratio = 0.9;
    expect(ped.depth()).toBeCloseTo(0.25, 14);
    expect(ped.barrierFactor(0.5)).toBeCloseTo(1, 12);
    expect(ped.barrierFactor(1)).toBeCloseTo(ctx.ps.etbFactor * 0.25, 3);
    ped.ratio = 1.2;
    expect(ped.depth()).toBeCloseTo(0.25 * 1.2 ** 6, 12);
    expect(barrierFactor(ctx, 1)).toBe(ped.barrierFactor(1));
  });

  it('keeps the pedestal top of the ELM: the running state until the first ELM, then the one at the onset', () => {
    const { ctx, y, m, ped } = setup();
    const st = ctx.view(y);
    // the state at t = 0 is what the first update saw; a later update before any ELM moves it
    const before = ped.pre.p;
    st.ne.forEach((_, i) => { st.ne[i] *= 1.5; });
    ctx.diagStale = true;
    m.diagnostics(0, y);
    expect(ped.elmSeen).toBe(false);
    expect(ped.pre.p).toBeGreaterThan(before);
    expect(ped.pre).toEqual(ped.top);
    const onset = { ...ped.top };
    ped.onElm();
    expect(ped.elmSeen).toBe(true);
    st.ne.forEach((_, i) => { st.ne[i] *= 0.5; });
    ctx.diagStale = true;
    m.diagnostics(0, y);
    expect(ped.pre).toEqual(onset);
    expect(ped.top.ne).toBeLessThan(onset.ne);
    const d = m.diagnostics(0, y);
    expect(d.ped_p_elm).toBeCloseTo(onset.p / 1e3, 12);
    expect(d.ped_Te_elm).toBe(onset.Te);
    expect(d.ped_Tp_elm).toBeCloseTo(onset.p / (2 * onset.ne * KEV), 12);
  });

  it('save and restore round-trip every field, and a record without them restores the defaults', () => {
    const { ped, ctx } = setup();
    ped.lnA = -0.7; ped.ratio = 0.8; ped.pLim = 9e4; ped.pTop = 7e4; ped.width = 0.041; ped.widthPsi = 0.035; ped.betaP = 0.21;
    ped.top = { Te: 5, Ti: 4, ne: 5e19, p: 7e4 }; ped.pre = { Te: 6, Ti: 5, ne: 5.5e19, p: 9e4 }; ped.elmSeen = true;
    const rec: Record<string, number> = {};
    ped.save(rec);
    const other = new PedestalModel(ctx.ps);
    other.restore(rec);
    expect(other).toMatchObject({ lnA: -0.7, ratio: 0.8, pLim: 9e4, pTop: 7e4, width: 0.041, widthPsi: 0.035, betaP: 0.21, elmSeen: true });
    expect(other.top).toEqual({ Te: 5, Ti: 4, ne: 5e19, p: 7e4 });
    expect(other.pre).toEqual({ Te: 6, Ti: 5, ne: 5.5e19, p: 9e4 });
    other.restore({});
    expect(other).toMatchObject({ lnA: 0, ratio: 0, pLim: 0, width: ctx.ps.pedestalWidth, elmSeen: false });
  });

  it('the pressure at ρ is linear between the two cell centres around it and holds at the ends', () => {
    const g = buildGrid(50);
    const Te = Float64Array.from({ length: 50 }, (_, i) => 1 + i), Ti = new Float64Array(50).fill(2), ne = new Float64Array(50).fill(1e19), ni = new Float64Array(50).fill(0.8);
    const cell = (i: number) => (1e19 * Te[i] + 1e19 * 0.8 * 2) * KEV;
    const same = (a: number, b: number) => expect(Math.abs(a / b - 1)).toBeLessThan(1e-12);
    same(pressureAt(g, Te, Ti, ne, ni, g.rhoC[20]), cell(20));
    same(pressureAt(g, Te, Ti, ne, ni, 0.5 * (g.rhoC[20] + g.rhoC[21])), 0.5 * (cell(20) + cell(21)));
    expect(pressureAt(g, Te, Ti, ne, ni, 0)).toBe(cell(0));
    expect(pressureAt(g, Te, Ti, ne, ni, 1)).toBe(cell(49));
  });
});

describe('the Loarte ELM shape (elmSize.ts)', () => {
  /** the energy of the crash (f, w) on the state of a shot [J] */
  const lossOf = (s: ReturnType<typeof shot>, rhoPed: number, f: number, w: number) => {
    const Te = Float64Array.from(s.st.Te), Ti = Float64Array.from(s.st.Ti), ne = Float64Array.from(s.st.ne), ni = Float64Array.from(s.ctx.w.ni);
    return elmCrash(s.ctx.tg, Te, Ti, ne, ni, s.ctx.bc.Te, s.ctx.bc.Ti, s.ctx.bc.n, rhoPed, f, 0.5 * f, w);
  };

  it('the energy of the crash is carried by the depth in the standard region, then by the width, then by the depth again, and is met exactly', () => {
    const s = shot(jet(EPED_LOARTE, 0.2));
    const rhoPed = 1 - s.ctx.pedWidth;
    const E1 = lossOf(s, rhoPed, ELM_DEPTH_TYP, ELM_WIDTH_STD), E2 = lossOf(s, rhoPed, ELM_DEPTH_TYP, ELM_WIDTH_MAX), E3 = lossOf(s, rhoPed, ELM_DEPTH_MAX, ELM_WIDTH_MAX);
    expect(E1).toBeGreaterThan(0);
    expect(E2).toBeGreaterThan(E1);
    expect(E3).toBeGreaterThan(E2);

    const a = elmShapeForEnergy(s.ctx, s.st, rhoPed, 0.5 * E1);
    expect(a.capped).toBe(false);
    expect(a.width).toBe(ELM_WIDTH_STD);
    expect(a.depth).toBeGreaterThan(0);
    expect(a.depth).toBeLessThan(ELM_DEPTH_TYP);
    expect(Math.abs(a.energy / (0.5 * E1) - 1)).toBeLessThan(1e-6);

    const b = elmShapeForEnergy(s.ctx, s.st, rhoPed, 0.5 * (E1 + E2));
    expect(b.depth).toBe(ELM_DEPTH_TYP);
    expect(b.width).toBeGreaterThan(ELM_WIDTH_STD);
    expect(b.width).toBeLessThan(ELM_WIDTH_MAX);
    expect(Math.abs(b.energy / (0.5 * (E1 + E2)) - 1)).toBeLessThan(1e-6);

    const c = elmShapeForEnergy(s.ctx, s.st, rhoPed, 0.5 * (E2 + E3));
    expect(c.width).toBe(ELM_WIDTH_MAX);
    expect(c.depth).toBeGreaterThan(ELM_DEPTH_TYP);
    expect(c.depth).toBeLessThan(ELM_DEPTH_MAX);
    expect(Math.abs(c.energy / (0.5 * (E2 + E3)) - 1)).toBeLessThan(1e-6);
    // the shape only grows with the energy
    expect(a.depth).toBeLessThan(b.depth + 1e-12);
    expect(b.width).toBeLessThan(c.width + 1e-12);
  });

  it('a target that the widest, deepest crash cannot carry is delivered as far as it goes, and no target is no crash', () => {
    const s = shot(jet(EPED_LOARTE, 0.2));
    const rhoPed = 1 - s.ctx.pedWidth;
    const E3 = lossOf(s, rhoPed, ELM_DEPTH_MAX, ELM_WIDTH_MAX);
    const big = elmShapeForEnergy(s.ctx, s.st, rhoPed, 5 * E3);
    expect(big).toMatchObject({ depth: ELM_DEPTH_MAX, width: ELM_WIDTH_MAX, capped: true });
    expect(Math.abs(big.energy / E3 - 1)).toBeLessThan(1e-9);
    expect(elmShapeForEnergy(s.ctx, s.st, rhoPed, 0)).toEqual({ depth: 0, width: ELM_WIDTH_STD, energy: 0, capped: false });
    expect(elmShapeForEnergy(s.ctx, s.st, rhoPed, -1).depth).toBe(0);
  });

  it('ΔW_ELM = f(ν*_ped) W_ped of the pedestal top: the pieces of loarteElmLoss agree', () => {
    const s = shot(jet(EPED_LOARTE, 0.2));
    const loss = loarteElmLoss(s.ctx, s.st, 1 - s.ctx.pedWidth, 3.3);
    expect(loss.energy).toBe(loss.fraction * loss.Wped);
    expect(loss.fraction).toBe(loarteEnergyFraction(loss.nuStar));
    const top = s.ctx.ped!.top;
    expect(Math.abs(loss.Wped / (1.5 * top.ne * (top.Te + top.Ti) * KEV * s.ctx.tg.volume) - 1)).toBeLessThan(1e-9);
  });
});

describe('ELMs of the pedestal model in a shot', () => {
  const evKey = (e: SimEvent) => `${e.t} ${e.kind} ${e.msg}`;

  it('fire when the pedestal-top pressure reaches the peeling–ballooning limit, and the α_ped/α_crit test is not applied', () => {
    const { ctx, st, d0 } = shot(jet(EPED, 0.2));
    const elm = new ElmEvents();
    const run = (d: Record<string, number>, t: number) => { const ev: SimEvent[] = []; elm.afterStep(ctx, t, st, d, ev); return ev; };
    ctx.hmode = true;
    // α over its limit does nothing; the pressure over its limit fires
    expect(run({ ...d0, alpha_ped: 5, ped_ratio: 0.9, tauE: 0.2 }, 1)).toEqual([]);
    const ev = run({ ...d0, alpha_ped: 0.1, ped_ratio: 1.03, tauE: 0.2, q95: 3.3 }, 2);
    expect(ev.map((e) => e.kind)).toEqual(['ELM']);
    expect(ev[0].msg).toContain('p_ped/p_lim = 1.03');
    expect(ctx.ped!.elmSeen).toBe(true);
  });

  it('the fixed pedestal still triggers on α_ped/α_crit', () => {
    const { ctx, st, d0 } = shot(jet({}, 0.2));
    const elm = new ElmEvents();
    ctx.hmode = true;
    const ev: SimEvent[] = [];
    elm.afterStep(ctx, 1, st, { ...d0, alpha_ped: 1.2, tauE: 0.2 }, ev);
    expect(ev).toHaveLength(1);
    expect(ev[0].msg).toContain('α_ped/α_crit = 1.20');
  });

  it('with elmLoss "loarte" the crash carries f(ν*_ped) W_ped of the pedestal before it, with the scatter of the fixed size (0.8 to 1.2)', () => {
    const s = shot(jet(EPED_LOARTE, 0.2));
    const { ctx, st, d0 } = s;
    const elm = new ElmEvents();
    ctx.hmode = true;
    const target = loarteElmLoss(ctx, st, 1 - ctx.pedWidth, 3.3).energy;
    const ev: SimEvent[] = [];
    elm.afterStep(ctx, 1, st, { ...d0, ped_ratio: 1.05, tauE: 0.2, q95: 3.3 }, ev);
    expect(ev).toHaveLength(1);
    const dW = ev[0].value! * 1e6;
    expect(dW).toBeGreaterThanOrEqual(0.8 * target * (1 - 1e-6));
    expect(dW).toBeLessThanOrEqual(1.2 * target * (1 + 1e-6));
    expect(ev[0].msg).toMatch(/W_ped at ν\*_ped = /);
  });

  it('a JET15 shot with the pedestal model: ELMs at the limit, the width of the EPED pedestal, finite, checkpointed', () => {
    const sim = new Simulation(jet(EPED, 1.5));
    sim.runAll();
    const elms = sim.events.filter((e) => e.kind === 'ELM');
    expect(elms.length).toBeGreaterThan(10);
    for (const e of elms) expect(e.msg).toContain('p_ped/p_lim');
    const late = sim.history.filter((h) => h.t > 0.8);
    for (const h of late) {
      const d = h.d;
      for (const k of ['ped_width', 'ped_p', 'ped_p_lim', 'ped_ratio', 'ped_depth', 'ped_nu', 'ped_p_elm', 'Tped']) expect(Number.isFinite(d[k]), k).toBe(true);
      expect(d.ped_width_psi).toBeGreaterThan(0.025);
      expect(d.ped_width_psi).toBeLessThan(0.06);
      expect(d.ped_depth).toBeGreaterThanOrEqual(Math.exp(LN_A_MIN) - 1e-12);
    }
    // the pedestal at the onset of the ELMs is at the limit (an ELM waits for its refractory time, so a little above)
    const last = late[late.length - 1].d;
    expect(last.ped_p_elm / last.ped_p_lim).toBeGreaterThan(0.95);
    expect(last.ped_p_elm / last.ped_p_lim).toBeLessThan(1.3);
    // the pressure never exceeds the limit by more than the clamp allows over the refractory time
    expect(Math.max(...late.map((h) => h.d.ped_ratio))).toBeLessThan(1.4);
  }, 120000);

  it('rewinds bitwise: the run replayed from a frame gives the same frames, events and pedestal', () => {
    const sim = new Simulation(jet(EPED_LOARTE, 1.5));
    sim.advance(1.5);
    let idx = -1;
    sim.history.forEach((h, i) => { if (h.prof && h.t > 0.9 && h.t < 1.1) idx = i; });
    expect(idx).toBeGreaterThan(0);
    const t0 = sim.history[idx].t;
    const ref = sim.history.slice(idx + 1), refEvents = sim.events.filter((e) => e.t > t0).map(evKey);
    expect(refEvents.some((e) => e.includes('ELM'))).toBe(true);
    sim.rewindTo(idx);
    sim.advance(1.5);
    const again = sim.history.slice(idx + 1);
    expect(again.length).toBe(ref.length);
    for (let k = 0; k < ref.length; k++) {
      expect(again[k].t).toBe(ref[k].t);
      for (const key of ['W', 'ped_depth', 'ped_p', 'ped_p_lim', 'ped_width', 'ped_Te_elm', 'ped_p_elm']) expect(again[k].d[key], `${key} at frame ${k}`).toBe(ref[k].d[key]);
    }
    expect(sim.events.filter((e) => e.t > t0).map(evKey)).toEqual(refEvents);
  }, 120000);

  it('is chunk-invariant: advance() in pieces gives bitwise the run of runAll()', () => {
    const whole = new Simulation(jet(EPED_LOARTE, 1.2));
    whole.runAll();
    const pieces = new Simulation(jet(EPED_LOARTE, 1.2));
    for (const dt of [0.31, 0.5, 2]) pieces.advance(dt);
    expect(pieces.history.length).toBe(whole.history.length);
    for (const key of ['t', 'W', 'ped_depth', 'ped_p', 'ped_width', 'ped_p_elm']) {
      const a = whole.history[whole.history.length - 1], b = pieces.history[pieces.history.length - 1];
      expect(key === 't' ? b.t : b.d[key], key).toBe(key === 't' ? a.t : a.d[key]);
    }
    expect(pieces.events.map(evKey)).toEqual(whole.events.map(evKey));
  }, 120000);
});

describe('settings of the pedestal model that are outside their domain are replaced by the default and reported', () => {
  const base = { ...DEFAULT_PROFILE_SETTINGS, pedestalModel: 'eped1' as const };

  it('valid values, and the fixed pedestal whatever the numbers, say nothing', () => {
    expect(checkProfileSettings(base).notes).toEqual([]);
    expect(checkProfileSettings({ ...base, pedPbGradient: 3, pedKbmCoefficient: 0.1, pedDensityExponent: 0 }).notes).toEqual([]);
    expect(checkProfileSettings({ ...DEFAULT_PROFILE_SETTINGS, pedPbGradient: -1, pedKbmCoefficient: NaN }).notes).toEqual([]);
    const { pedPbGradient, pedKbmCoefficient, pedDensityExponent, ...bare } = base;
    void pedPbGradient; void pedKbmCoefficient; void pedDensityExponent;
    expect(checkProfileSettings(bare).notes).toEqual([]);
  });

  it.each([[0], [-2], [NaN], [Infinity]])('pedPbGradient and pedKbmCoefficient = %s', (bad) => {
    for (const key of ['pedPbGradient', 'pedKbmCoefficient'] as const) {
      const r = checkProfileSettings({ ...base, [key]: bad });
      expect(r.ps[key]).toBe(key === 'pedPbGradient' ? PB_GRADIENT : KBM_COEFFICIENT);
      expect(r.notes).toHaveLength(1);
      expect(r.notes[0].message).toContain(`ProfileSettings.${key}`);
    }
  });

  it.each([[-0.1], [NaN], [Infinity]])('pedDensityExponent = %s', (bad) => {
    const r = checkProfileSettings({ ...base, pedDensityExponent: bad });
    expect(r.ps.pedDensityExponent).toBe(PB_DENSITY_EXPONENT);
    expect(r.notes).toHaveLength(1);
  });

  it('a shot with a zero gradient is built with the default in its place', () => {
    const { m } = shot(jet({ ...EPED, pedPbGradient: 0 }, 0.2));
    expect(m.ctx.ps.pedPbGradient).toBe(PB_GRADIENT);
    expect(m.ctx.ped!.options.pbGradient).toBe(PB_GRADIENT);
  });

  it('an unset number is the constant of eped1.ts: the shot of the defaults has the published pedestal', () => {
    const { m } = shot(jet(EPED, 0.2));
    expect(m.ctx.ps.pedPbGradient).toBeUndefined();
    expect(m.ctx.ped!.options).toEqual({ pbGradient: undefined, kbmCoefficient: undefined, densityExponent: undefined });
    // at the reference density the pedestal of those options is the one of the published constants
    expect(solveEped1(m.ctx.ped!.options).width).toBeCloseTo(0.076 * 0.076 * PB_GRADIENT, 12);
  });
});

describe('ITER15 with the pedestal model against the published EPED prediction', () => {
  const T_END = 50, T0 = 34;
  /** flat-top window averages of the ITER15 shot to T_END with the model on (both options), at nRho radial cells */
  async function iter15(nRho: number): Promise<Record<string, number>> {
    const sim = new Simulation({ ...ITER_15D, t_end: T_END, profiles: { ...ITER_15D.profiles, ...EPED_LOARTE, nRho } });
    await runAllYielding(sim);
    const fr = sim.history.filter((h) => h.t >= T0);
    const out: Record<string, number> = { ELMs: sim.events.filter((e) => e.kind === 'ELM' && e.t >= T0).length };
    for (const k of ['Tped', 'ped_Te_elm', 'ped_p_elm', 'ped_p_lim', 'ped_width_psi', 'ped_ne', 'Zeff', 'ped_Tp_elm']) out[k] = fr.reduce((s, h) => s + h.d[k], 0) / fr.length;
    return out;
  }

  it('T_ped within 15 % of the published 4 to 5 keV, the pressure at ELM onset within 30 % of the published curve at the density of the shot, and 50 vs 100 cells within 2 %', async () => {
    const a = await iter15(50), b = await iter15(100);
    // T_ped: the flat-top mean of T_e at the pedestal top, the metric of the validation table (reference 4.5 ± 0.5 keV, EPED)
    expect(Math.abs(a.Tped / 4.75 - 1)).toBeLessThan(0.15);
    // the ELM-averaged pedestal is below the limit; the pedestal at the onset of the ELM is at it
    expect(a.ped_p_elm / a.ped_p_lim).toBeGreaterThan(0.98);
    expect(a.ped_p_elm / a.ped_p_lim).toBeLessThan(1.15);
    // EPED gives the pressure at the density it is given: the published H-mode branch at n_ped Z_eff^{1/2} of this shot
    const pEped = epedIter(a.ped_ne * 10 * Math.sqrt(a.Zeff));
    expect(Math.abs(a.ped_p_elm / pEped - 1)).toBeLessThan(0.3);
    // the width of the pedestal, published ≈ 0.04 (0.6 to 0.7 for β_N,ped)
    expect(Math.abs(a.ped_width_psi / 0.04 - 1)).toBeLessThan(0.15);
    // grid convergence between 50 and 100 cells
    expect(a.ELMs).toBeGreaterThan(30);
    for (const k of ['Tped', 'ped_Te_elm', 'ped_p_elm', 'ped_p_lim']) expect(Math.abs(b[k] / a[k] - 1), k).toBeLessThan(0.02);
    expect(Math.abs(b.ped_width_psi / a.ped_width_psi - 1)).toBeLessThan(0.05);
  }, 600000);
});

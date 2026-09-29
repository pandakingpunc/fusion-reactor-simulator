/**
 * The 1.5D separatrix boundary (boundary/sol.ts, boundary/edge.ts) evaluated on the initial equilibrium of a model: the legacy
 * two-point formula, the edge-model boundary condition, the guard band, and the P_SOL update.
 */
import { describe, expect, it } from 'vitest';
import { JET_15D } from '../../presets';
import type { MagneticConfig } from '../../types';
import { edgeSetup, solveEdge } from '../../edge';
import { ProfileModel } from '../model';
import { q95 } from '../qprofile';
import { edgeChannels1D, edgePlasma1D, twoPointSeparatrixT, TSEP_GUARD_KEV } from './edge';
import { separatrixT, updateBoundary, updatePsol } from './sol';

const model = (over: Partial<MagneticConfig> = {}) => {
  const m = new ProfileModel({ ...JET_15D, ...over });
  m.initialState();
  return m;
};

describe('boundary values', () => {
  it("'legacy' (default) is the conduction-limited formula with the outboard share 0.6 and the clamp 0.03–0.5 keV", () => {
    const m = model(), ctx = m.ctx, y = m.initialState();
    ctx.PSOL = 30e6;
    updateBoundary(ctx, 0.5, ctx.view(y));
    const Tsep = separatrixT(ctx, 30e6, q95(ctx), ctx.view(y).s.Ip);
    expect(ctx.bc.Te).toBe(Tsep);
    expect(ctx.bc.Ti).toBe(Tsep);
    expect(Tsep).toBeGreaterThan(0.03);
    expect(Tsep).toBeLessThan(0.5);
    // clamps at both ends
    ctx.PSOL = 1e9;
    expect(separatrixT(ctx, 1e9, q95(ctx), 3.5e6)).toBe(0.5);
    expect(separatrixT(ctx, 1e5, q95(ctx), 3.5e6)).toBeGreaterThanOrEqual(0.03);
    // the fixed value wins
    const f = model({ profiles: { ...JET_15D.profiles, Tsep_keV: 0.2 } });
    expect(separatrixT(f.ctx, 30e6, 3.5, 3.5e6)).toBe(0.2);
  });

  it("'twoPoint' is the T_u of the edge model from the same P_SOL, boundary density and equilibrium (in keV)", () => {
    const m = model({ profiles: { ...JET_15D.profiles, edgeModel: 'twoPoint' } }), ctx = m.ctx, y = m.initialState();
    ctx.PSOL = 30e6;
    const Ip = ctx.view(y).s.Ip;
    updateBoundary(ctx, 3, ctx.view(y)); // after the density ramp
    const n = ctx.bc.n;
    const r = solveEdge(edgePlasma1D(ctx, 30e6, n, q95(ctx), Ip), edgeSetup(ctx.cfg).par);
    expect(ctx.bc.Te).toBeCloseTo(r.T_u / 1000, 12);
    expect(ctx.bc.Ti).toBe(ctx.bc.Te);
    expect(twoPointSeparatrixT(ctx, 30e6, n, q95(ctx), Ip)).toBeCloseTo(r.T_u / 1000, 12);
    // and it is within a few percent of the legacy formula at the same P_SOL (at the density of the flat top; at the low density of
    // the start-up the target is sheath-limited and the two-point T_u is higher than the conduction-limited value)
    const legacy = separatrixT(ctx, 30e6, q95(ctx), Ip);
    expect(Math.abs(ctx.bc.Te / legacy - 1)).toBeLessThan(0.15);
    // n_sep is the same in both models
    const l = model(), ly = l.ctx;
    ly.PSOL = 30e6;
    updateBoundary(ly, 3, ly.view(l.initialState()));
    expect(ly.bc.n).toBe(n);
  });

  it('the inputs of the edge model follow the equilibrium: P_sep, n_sep, B_pol = μ0 I_p/L_pol, R_u of the LCFS, the ion mass', () => {
    const m = model(), ctx = m.ctx;
    const p = edgePlasma1D(ctx, 12e6, 3e19, 3.7, 3.5e6);
    expect(p.P_sep).toBe(12e6);
    expect(p.n_sep).toBe(3e19);
    expect(p.R_u).toBe(ctx.tg.RoutF[ctx.tg.N]);
    expect(p.B_pol).toBeCloseTo((1.25663706212e-6 * 3.5e6) / ctx.tg.perimeter, 12);
    expect(p.m_i).toBeCloseTo(ctx.M * 1.66053906660e-27, 30);
    expect(p.f_rad_div).toBe(0.7);
    expect(p.seed).toBeUndefined();
  });

  it('the guard band is 5 eV – 2 keV and holds for an absurd P_SOL or none', () => {
    expect(TSEP_GUARD_KEV).toEqual([0.005, 2]);
    const m = model({ profiles: { ...JET_15D.profiles, edgeModel: 'twoPoint' } }), ctx = m.ctx;
    const Ip = 3.5e6, q = q95(ctx);
    expect(twoPointSeparatrixT(ctx, 1e15, 3e19, q, Ip)).toBe(2);
    const cold = twoPointSeparatrixT(ctx, 0, 3e19, q, Ip);
    expect(cold).toBeGreaterThanOrEqual(0.005);
    expect(cold).toBeLessThan(0.05);
  });

  it('the edge channels of the diagnostics are those of the current boundary state', () => {
    const m = model(), ctx = m.ctx, y = m.initialState();
    ctx.PSOL = 25e6;
    const Ip = ctx.view(y).s.Ip;
    const ch = edgeChannels1D(ctx, q95(ctx), Ip);
    const r = solveEdge(edgePlasma1D(ctx, 25e6, ctx.bc.n, q95(ctx), Ip), edgeSetup(ctx.cfg).par);
    expect(ch.T_t).toBe(r.T_t);
    expect(ch.q_peak).toBe(r.q_peak);
    expect(ch.P_sep_R).toBe(r.P_sep_R);
  });
});

describe('lagged P_SOL', () => {
  it('relaxes towards P_heat − P_rad − dW/dt with τ = 20 ms, floored at 5 % of P_heat (and 0.1 MW)', () => {
    const m = model(), ctx = m.ctx;
    ctx.PSOL = 0;
    updatePsol(ctx, 0.02, 100e6, 20e6, 5e6);
    expect(ctx.PSOL).toBeCloseTo((1 - Math.exp(-1)) * 75e6, 3);
    for (let i = 0; i < 100; i++) updatePsol(ctx, 0.02, 100e6, 20e6, 5e6);
    expect(ctx.PSOL).toBeCloseTo(75e6, 0);
    // a negative balance is floored
    for (let i = 0; i < 100; i++) updatePsol(ctx, 0.02, 100e6, 20e6, 90e6);
    expect(ctx.PSOL).toBeCloseTo(5e6, 0);
    for (let i = 0; i < 100; i++) updatePsol(ctx, 0.02, 1e4, 0, 1e6);
    expect(ctx.PSOL).toBeCloseTo(1e5, -2);
  });
});

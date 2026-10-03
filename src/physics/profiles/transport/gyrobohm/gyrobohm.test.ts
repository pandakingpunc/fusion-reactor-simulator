/**
 * The mixed Bohm/gyro-Bohm model (formula.ts: Erba et al., Plasma Phys. Control. Fusion 39 (1997) 261; Nucl. Fusion 38 (1998) 1013) and the
 * 'bgb' transport model built on it. The reference numbers were evaluated separately from the equations of the NTCC description of the
 * model; the structure tests are the ones that define a Bohm plus gyro-Bohm form.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../../simulation';
import { JET_15D } from '../../../presets';
import { interpCells } from '../../geometry1d';
import { ProfileModel } from '../../model';
import { createTransportModel } from '..';
import { BGB, bgbChi, bohmDiffusivity, nonLocalFactor, rhoStar } from './formula';
import { BohmGyroBohmTransport } from './gyrobohm';

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1e-300, Math.abs(b)));
const AMU = 1.66053906660e-27, KEV = 1.602176634e-16;

/** T_e = 8 keV, B = 5.3 T, a = 2 m: a mid-radius ITER-size point with q = 2 and Λ = 1.3 */
const pt = { TeKeV: 8, B: 5.3, a: 2, invLp: 2.4, invLT: 1.5, q: 2, lambda: 1.3, rhoStar: rhoStar(8 * KEV, 2.5 * AMU, 5.3, 2) };

describe('the mixed Bohm/gyro-Bohm formula', () => {
  it('has the published coefficients: α_Be = 8e-5, α_Bi = 2 α_Be, α_gBe = 3.5e-2, α_gBi = α_gBe/2, the inner radius x = 0.8', () => {
    expect(BGB.alphaBe).toBe(8e-5);
    expect(BGB.alphaBi).toBe(2 * BGB.alphaBe);
    expect(BGB.alphaGBe).toBe(3.5e-2);
    expect(BGB.alphaGBi).toBe(BGB.alphaGBe / 2);
    expect(BGB.xInner).toBe(0.8);
  });

  it('evaluates the Bohm diffusivity T_e/(eB) [T_e in eV over B in T], ρ* = ρ_s/a and the two terms (a separate evaluation)', () => {
    close(bohmDiffusivity(8, 5.3), 1509.433962264151);
    close(pt.rhoStar, 0.0013582461554691237);
    const r = bgbChi(pt);
    close(r.bohm, 18837.735849056604);
    close(r.gyroBohm, 3.075274314269714);
    close(r.chiE, 1.6146534689239684);
    close(r.chiI, 3.067855036348777);
  });

  it('is a sum of a Bohm term ∝ (T_e/eB) (a|∇p_e|/p_e) q² Λ and a gyro-Bohm term ∝ (T_e/eB) (a|∇T_e|/T_e) ρ*', () => {
    const r = bgbChi(pt);
    // the Bohm term: linear in the pressure gradient length, q² and the non-local factor; the gyro-Bohm term knows none of the last two
    const b = (over: Partial<typeof pt>) => bgbChi({ ...pt, ...over });
    close(b({ q: 4 }).bohm / r.bohm, 4); close(b({ q: 4 }).gyroBohm, r.gyroBohm);
    close(b({ lambda: 2.6 }).bohm / r.bohm, 2); close(b({ lambda: 2.6 }).gyroBohm, r.gyroBohm);
    close(b({ invLp: 4.8 }).bohm / r.bohm, 2); close(b({ invLT: 3 }).gyroBohm / r.gyroBohm, 2); close(b({ invLT: 3 }).bohm, r.bohm);
    close(b({ TeKeV: 16 }).bohm / r.bohm, 2);
    close(b({ TeKeV: 16, rhoStar: pt.rhoStar * Math.SQRT2 }).gyroBohm / r.gyroBohm, 2 * Math.SQRT2); // T_e^3/2: (T_e/eB) ρ*
    // the sign of a gradient is not used
    expect(b({ invLp: -2.4, invLT: -1.5 })).toEqual(r);
    // with no gyro-Bohm term the ions carry twice the electron heat flux
    const bohmOnly = b({ invLT: 0 });
    close(bohmOnly.chiI / bohmOnly.chiE, 2);
    const gbOnly = b({ lambda: 0 });
    close(gbOnly.chiI / gbOnly.chiE, 0.5);
    // a negative drop is no transport: Λ is at least 0
    expect(b({ lambda: -3 }).bohm).toBe(0);
  });

  it('the gyro-Bohm term is negligible in a large machine (ρ* of ITER, 10⁻³) and grows as ρ* in a small one', () => {
    const iter = bgbChi(pt);
    expect(BGB.alphaGBe * iter.gyroBohm).toBeLessThan(0.1 * BGB.alphaBe * iter.bohm);
    const small = bgbChi({ ...pt, B: 1, a: 0.3, rhoStar: rhoStar(8 * KEV, 2.5 * AMU, 1, 0.3) });
    expect(small.gyroBohm / small.bohm).toBeGreaterThan(30 * iter.gyroBohm / iter.bohm);
  });

  it('the non-local factor is the temperature drop over T_e(edge), with the edge floored at 20 eV and no negative value', () => {
    close(nonLocalFactor(4, 1), 3);
    close(nonLocalFactor(3, 0.1), 29);
    close(nonLocalFactor(1, 0.01), 49);
    expect(nonLocalFactor(1, 2)).toBe(0);
    expect(nonLocalFactor(0.5, 0)).toBeCloseTo(24, 12);
  });
});

describe("the 'bgb' transport model", () => {
  const setup = (pedestalModel: 'fixed' | 'eped1' = 'fixed') => {
    const sim = new Simulation({ ...JET_15D, t_end: 0.05, profiles: { transportModel: 'bgb', pedestalModel } });
    const m = sim.model as ProfileModel;
    const y = m.initialState();
    m.diagnostics(0, y);
    return { m, y, ctx: m.ctx, tr: m.physics.transport as BohmGyroBohmTransport };
  };

  it('is registered, predictive and made per shot', () => {
    const t = createTransportModel('bgb');
    expect(t.id).toBe('bgb');
    expect(t.predictive).toBe(true);
    expect(t).toBeInstanceOf(BohmGyroBohmTransport);
    expect(createTransportModel('bgb')).not.toBe(t);
  });

  it('holds Λ of the old state: the separatrix is the edge in L-mode, the pedestal top in H-mode', () => {
    const { y, ctx, tr } = setup();
    const st = ctx.view(y);
    const g = ctx.tg;
    ctx.hmode = false;
    tr.prepare(ctx, 0, st);
    const lmode = tr.nonLocal;
    close(lmode, nonLocalFactor(interpCells(g, st.Te, 0.8), ctx.bc.Te));
    expect(lmode).toBeGreaterThan(1);
    ctx.hmode = true;
    tr.prepare(ctx, 0, st);
    const hmode = tr.nonLocal;
    close(hmode, nonLocalFactor(interpCells(g, st.Te, 0.8), interpCells(g, st.Te, 1 - ctx.ps.pedestalWidth)));
    // the H-mode value is the smaller: the temperature at the pedestal top is above the separatrix value
    expect(hmode).toBeLessThan(lmode);
  });

  it('with the EPED1 pedestal the H-mode edge is the pedestal top of that pedestal (1 − its width), not the nominal pedestalWidth', () => {
    const { y, ctx, tr } = setup('eped1');
    const st = ctx.view(y);
    const g = ctx.tg;
    // the first diagnostics evaluated the EPED1 width: well inside the nominal one on JET
    expect(ctx.ped).not.toBeNull();
    expect(ctx.pedWidth).toBeLessThan(0.75 * ctx.ps.pedestalWidth);
    ctx.hmode = true;
    tr.prepare(ctx, 0, st);
    const inner = interpCells(g, st.Te, 0.8);
    close(tr.nonLocal, nonLocalFactor(inner, interpCells(g, st.Te, 1 - ctx.pedWidth)));
    expect(Math.abs(tr.nonLocal - nonLocalFactor(inner, interpCells(g, st.Te, 1 - ctx.ps.pedestalWidth)))).toBeGreaterThan(0.1 * tr.nonLocal);
  });

  it('gives finite χ_e, χ_i of the order of a few m²/s in the confinement zone of a JET-size plasma, twice as large for the ions in the Bohm limit', () => {
    const { y, ctx, tr } = setup();
    const st = ctx.view(y), N = ctx.N;
    const chiE = new Float64Array(N + 1), chiI = new Float64Array(N + 1);
    tr.diffusivities(ctx, st, chiE, chiI);
    expect(chiE.every((x) => Number.isFinite(x) && x > 0)).toBe(true);
    expect(chiI.every((x) => Number.isFinite(x) && x > 0)).toBe(true);
    expect(chiE[0]).toBe(chiE[1]); expect(chiI[0]).toBe(chiI[1]);
    const f = Math.round(0.5 * N);
    expect(chiE[f]).toBeGreaterThan(0.05); expect(chiE[f]).toBeLessThan(30);
    // the ratio lies between the gyro-Bohm limit (1/2) and the Bohm limit (2)
    for (let i = 1; i <= N; i++) { const r = chiI[i] / chiE[i]; expect(r).toBeGreaterThan(0.5 - 1e-9); expect(r).toBeLessThan(2 + 1e-9); }
  });
});

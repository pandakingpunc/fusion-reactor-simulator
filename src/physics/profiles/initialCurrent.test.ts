/**
 * The current profile of the initial state of the 1.5D model (ProfileModel.initialState: ψ from the q profile of the equilibrium).
 *
 * The current equation takes I_p as its boundary condition. The q profile of the Grad–Shafranov tables carries the current of the
 * equilibrium, which is I_p only to the accuracy of the solver's line integrals (1.0006 to 1.0011 I_p on the presets): a ψ built from it
 * has an enclosed current at the last interior face above I_p, and the outermost cell then carries a negative current. On the uniform grid
 * the last cell holds 2 % of the radius and swallows the mismatch; on the edge-packed grid it holds 5e-4 I_p and shows it (the profile
 * frame at t = 0 had a negative current density in the last cell of every 1.5D preset). equilibriumCurrentScale normalises the profile;
 * matchEdgeCurrent takes the edge over from the table's own enclosed current (from ρ̂ = 0.9 to 0.97), which the q-based ψ' misses by up to
 * 1e-3 I_p and which, with the edge-clustered 101-surface table, left the outermost cell 2.4 to 3.7 times its neighbour's.
 */
import { describe, expect, it } from 'vitest';
import { DEMO_15D, DIIID, ITER_15D, JET_15D, SPARC_15D } from '../presets';
import { Simulation } from '../simulation';
import type { MagneticConfig } from '../types';
import { ProfileModel } from './model';
import { lerpTable } from '../numerics/interp';
import { EDGE_CURRENT_RAMP, equilibriumCurrentScale, matchEdgeCurrent } from './qprofile';

const dIIID15 = { ...DIIID, fidelity: '1.5D' } as MagneticConfig;
const sparc30 = { ...SPARC_15D, profiles: { ...SPARC_15D.profiles, nRho: 30 } } as MagneticConfig; // the size of the io fixtures

const PRESETS: [string, MagneticConfig][] = [['ITER15', ITER_15D], ['JET15', JET_15D], ['SPARC15', SPARC_15D], ['DEMO15', DEMO_15D], ['DIIID15', dIIID15], ['SPARC15 (nRho 30)', sparc30]];
const withPacking = (cfg: MagneticConfig, gridPacking: number | undefined): MagneticConfig => ({ ...cfg, profiles: { ...cfg.profiles, ...(gridPacking === undefined ? {} : { gridPacking }) } });

/** the model at t = 0: its diagnostics evaluated, the enclosed current and the current density profile of the frame */
function initial(cfg: MagneticConfig) {
  const m = new ProfileModel(cfg);
  const y = m.initialState();
  m.diagnostics(0, y);
  const ctx = m.ctx, N = ctx.N, Ip = ctx.ipAt(0);
  return { m, N, Ip, I: Array.from(ctx.w.IencF, (x) => x / Ip), j: ctx.lastProf.j as number[] };
}

describe('the current of the initial state', () => {
  describe.each([['the default (edge-packed) grid', undefined], ['the uniform grid (gridPacking 0)', 0]] as const)('%s', (_name, packing) => {
    it.each(PRESETS)('%s: every cell carries a positive current, and the last interior face encloses less than I_p', (_n, cfg) => {
      const { N, I, j } = initial(withPacking(cfg, packing));
      expect(j).toHaveLength(N);
      expect(Math.min(...j)).toBeGreaterThan(0);
      for (let f = 0; f < N; f++) expect(I[f + 1] - I[f]).toBeGreaterThan(0);
      expect(I[N]).toBeCloseTo(1, 12);
      // the outermost cell holds the edge share of the current, small (1.3 % at nRho 30 on the uniform grid, whose last cell is 3.3 % of the
      // radius); on the packed grid of the same size as its neighbours' (a mismatch of the normalisation would show as a step here)
      const edge = I[N] - I[N - 1], prev = I[N - 1] - I[N - 2];
      expect(edge).toBeGreaterThan(0);
      expect(edge).toBeLessThan(0.02);
      if (packing === undefined) {
        expect(edge / prev).toBeGreaterThan(0.5);
        expect(edge / prev).toBeLessThan(2);
      }
    });
  });

  it('the t = 0 profile frame of a Simulation has a positive current density in every cell (the reviewer\'s ITER15 case)', () => {
    const sim = new Simulation({ ...ITER_15D, t_end: 0.5 });
    sim.advance(1e-9);
    const j = sim.history[0].prof!.j;
    expect(sim.history[0].t).toBe(0);
    expect(Math.min(...j)).toBeGreaterThan(0);
  });

  it('the profile is scaled by the factor of the equilibrium, about 1 / 1.001, so the q profile moves by that much only', () => {
    const cfg = withPacking(ITER_15D, 4);
    const m = new ProfileModel(cfg);
    const ctx = m.ctx;
    const Ip = ctx.ipAt(0);
    const I = ctx.eq.prof.Ienc;
    const s = equilibriumCurrentScale(ctx.eq, Ip);
    expect(s).toBe(Ip / I[I.length - 1]);
    expect(s).toBeLessThan(1);
    expect(s).toBeGreaterThan(0.995);
    // q of the state against the q of the equilibrium: the same shape, 1/s higher everywhere the table is resolved
    m.diagnostics(0, m.initialState());
    const g = ctx.tg;
    for (const i of [1, 10, 25, 40]) {
      const qState = 0.5 * (ctx.w.qF[i] + ctx.w.qF[i + 1]);
      expect(qState / g.qEqC[i]).toBeGreaterThan(1 / s - 3e-3);
      expect(qState / g.qEqC[i]).toBeLessThan(1 / s + 3e-3);
    }
  });

  describe('the edge of the profile follows the equilibrium\'s own enclosed current (matchEdgeCurrent)', () => {
    const [rampA, rampB] = EDGE_CURRENT_RAMP;
    describe.each([['the default (edge-packed) grid', undefined], ['the uniform grid (gridPacking 0)', 0]] as const)('%s', (_name, packing) => {
      it.each(PRESETS)('%s: beyond the ramp every face carries the current of the table, inside it the q-based ψ is untouched to the bit', (_n, cfg) => {
        const c = withPacking(cfg, packing);
        const { m, N, Ip, I } = initial(c);
        const ctx = m.ctx, g = ctx.tg, P = ctx.eq.prof;
        const scale = equilibriumCurrentScale(ctx.eq, Ip);
        for (let f = 1; f < N; f++) {
          if (g.rhoF[f] < rampB) continue;
          // the enclosed current is exactly the table's (times the factor) at every face beyond the ramp: linear between the nodes
          expect(Math.abs(I[f] - (scale * lerpTable(P.rhoTor, P.Ienc, g.rhoF[f])) / Ip), `face ${f}`).toBeLessThan(1e-12);
        }
        // inside the ramp start: the ψ of the q profile, as it was built before the correction (same expression as ProfileModel.initialState)
        const y = new ProfileModel(c).initialState();
        const psi = ctx.view(y).psi;
        let acc = 0, checked = 0;
        for (let i = 0; i < N && g.rhoF[i] <= rampA; i++) {
          const r0 = i === 0 ? 0 : g.rhoC[i - 1], r1 = g.rhoC[i];
          const qm = i === 0 ? g.qEqC[0] : 0.5 * (g.qEqC[i - 1] + g.qEqC[i]);
          acc += ((scale * g.PhiB * (0.5 * (r0 + r1))) / (Math.PI * Math.max(qm, 0.3))) * (r1 - r0);
          expect(psi[i], `cell ${i}`).toBe(acc);
          checked++;
        }
        expect(checked).toBeGreaterThan(N / 2);
      });

      // on the packed grid, whose outer cells resolve the edge; the cells of the uniform grid are as wide as the whole falloff of the edge current
      it.each(packing === undefined ? PRESETS : [])('%s: the current density of the outer cells is smooth: no cell holds more than twice or less than half of what the one inside it does', (_n, cfg) => {
        const { N, j, m } = initial(withPacking(cfg, packing));
        const g = m.ctx.tg;
        for (let i = 1; i < N; i++) {
          if (g.rhoC[i] < 0.8) continue;
          const r = j[i] / j[i - 1];
          expect(r, `cell ${i} at rho ${g.rhoC[i].toFixed(3)}`).toBeGreaterThan(0.5);
          expect(r, `cell ${i} at rho ${g.rhoC[i].toFixed(3)}`).toBeLessThan(2);
        }
      });
    });

    it('a table that gives no usable current leaves ψ as it is: a value that is not a number, ρ̂ that does not increase, a table of fewer than four nodes or of another length', () => {
      const build = () => { const m = new ProfileModel(ITER_15D); return { m, psi: Float64Array.from(m.ctx.view(m.initialState()).psi) }; };
      const untouched = (mutate: (P: { rhoTor: Float64Array; Ienc: Float64Array }) => void) => {
        const { m, psi } = build();
        const ctx = m.ctx, Ip = ctx.ipAt(0);
        const P = ctx.eq.prof as unknown as { rhoTor: Float64Array; Ienc: Float64Array };
        const keep = { rhoTor: P.rhoTor, Ienc: P.Ienc };
        mutate(P);
        const copy = Float64Array.from(psi);
        matchEdgeCurrent(ctx, copy, 0.999, Ip);
        Object.assign(P, keep);
        return copy.every((v, i) => v === psi[i]);
      };
      expect(untouched((P) => { P.Ienc = Float64Array.from(P.Ienc); P.Ienc[P.Ienc.length - 3] = NaN; })).toBe(true);
      expect(untouched((P) => { P.rhoTor = Float64Array.from(P.rhoTor); P.rhoTor[P.rhoTor.length - 5] = P.rhoTor[P.rhoTor.length - 4]; })).toBe(true);
      expect(untouched((P) => { P.rhoTor = P.rhoTor.slice(0, 3); P.Ienc = P.Ienc.slice(0, 3); })).toBe(true);
      expect(untouched((P) => { P.Ienc = P.Ienc.slice(0, 20); })).toBe(true);
    });
  });

  it('no factor when the table gives no usable current: not a number, no surface, zero, or more than 10 % from I_p', () => {
    const eq = (Ienc: number[]) => ({ prof: { Ienc: Float64Array.from(Ienc) } }) as unknown as Parameters<typeof equilibriumCurrentScale>[0];
    expect(equilibriumCurrentScale(eq([1e6, 2e6, 15.016e6]), 15e6)).toBeCloseTo(15 / 15.016, 12);
    expect(equilibriumCurrentScale(eq([1e6, NaN]), 15e6)).toBe(1);
    expect(equilibriumCurrentScale(eq([]), 15e6)).toBe(1);
    expect(equilibriumCurrentScale(eq([0]), 15e6)).toBe(1);
    expect(equilibriumCurrentScale(eq([-3e6]), 15e6)).toBe(1);
    expect(equilibriumCurrentScale(eq([20e6]), 15e6)).toBe(1);
    expect(equilibriumCurrentScale(eq([10e6]), 15e6)).toBe(1);
    expect(equilibriumCurrentScale(eq([15e6]), 15e6)).toBe(1);
  });
});

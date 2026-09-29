/**
 * Two-point solution of the outer leg (edge/solve.ts).
 *  [S18]  P. C. Stangeby, Plasma Phys. Control. Fusion 60 (2018) 044022: two-point model with loss factors.
 *  [E13]  T. Eich et al., Nucl. Fusion 53 (2013) 093031: λ_q.
 *  [P19]  R. A. Pitts et al., "Physics basis for the first ITER tungsten divertor", Nucl. Mater. Energy 20 (2019) 100696:
 *         P_SOL = 100 MW at Q_DT = 10; the peak steady-state power flux density of the vertical targets has to stay
 *         near 10 MW/m² (the previously accepted value; the revised criterion of W recrystallisation is about 50 % higher),
 *         which needs a seeding impurity (N or Ne) to dissipate the power.
 * The ITER case uses the ITER preset geometry (R = 6.2 m, a = 2 m, κ95 = 1.7, I_p = 15 MA, B = 5.3 T, q95 = 3) and P_sep = 100 MW.
 */
import { describe, expect, it } from 'vitest';
import { forAll, gen } from '../../testing/prop';
import { divertorHeatFlux } from '../engineering';
import { integrateGL } from '../numerics/quadrature';
import { poloidalField } from '../geometry';
import { LengyelIntegral, lengyelFluxes } from './lengyel';
import { DEFAULT_EDGE_PARAMS, EdgeParams, resolveEdgeParams } from './params';
import { EdgePlasma, solveEdge } from './solve';
import { conductionTemperature, sheathHeatFlux } from './twoPoint';
import { ATTACHED, DETACHED } from './detachment';
import { coolingLoss, momentumLoss } from './losses';

const AMU = 1.66053906660e-27;
const ITER_G = { R: 6.2, a: 2, kappa: 1.7, delta: 0.33 };
const iter: EdgePlasma = {
  P_sep: 100e6, R: 6.2, a: 2, B0: 5.3, B_pol: poloidalField(ITER_G, 15e6), q95: 3, n_sep: 4e19, m_i: 2.5 * AMU, f_x: 5, f_rad_div: 0,
};
const rel = (a: number, b: number) => Math.abs(a / b - 1);

describe('outer-leg solution: structure', () => {
  it('reproduces the conduction chain exactly: T_x, T_u from the two segments, and the sheath equation at the root', () => {
    const r = solveEdge({ ...iter, f_rad_div: 0.9 });
    expect(r.TtFloor).toBe(false);
    // T_x^{7/2} = T_t^{7/2} + (7/2)(q_u/b) L_div/κ0e; T_u^{7/2} = T_x^{7/2} + (7/2) q_u (L − L_div)/κ0e
    const Tx = conductionTemperature(r.T_t, r.q_u / r.b, r.L_div);
    expect(rel(r.T_x, Tx)).toBeLessThan(1e-12);
    expect(rel(r.T_u, conductionTemperature(Tx, r.q_u, r.L_par - r.L_div))).toBeLessThan(1e-12);
    // q_t = γ (1 − f_mom) n_u T_u (T_t/2m_i)^{1/2} = (1 − f_cool)(1 − f_rad,div) q_u / b
    expect(rel(sheathHeatFlux(iter.n_sep, r.T_u, r.T_t, r.f_mom, iter.m_i), r.q_t)).toBeLessThan(1e-9);
    expect(rel(r.q_t, ((1 - r.f_cool) * (1 - 0.9) * r.q_u) / r.b)).toBeLessThan(1e-12);
    expect(r.p_u).toBeCloseTo(iter.n_sep * r.T_u, 3);
  });

  it('T_u follows (q L)^{2/7} when the target is cold: doubling P_sep, or L (q95), multiplies T_u by 2^{2/7}', () => {
    // high recycling (large n_u): T_t ≪ T_u so that the T_t^{7/2} term is negligible
    const base: EdgePlasma = { ...iter, n_sep: 1.2e20, f_rad_div: 0.9 };
    const par = resolveEdgeParams({ spreadingRatio: 1e-9 }); // b = 1 (no broadening): the segments add up to L exactly
    const r0 = solveEdge(base, par);
    expect(r0.T_t).toBeLessThan(0.15 * r0.T_u);
    expect(rel(solveEdge({ ...base, P_sep: 2 * base.P_sep }, par).T_u / r0.T_u, Math.pow(2, 2 / 7))).toBeLessThan(1e-3);
    expect(rel(solveEdge({ ...base, q95: 2 * base.q95 }, par).T_u / r0.T_u, Math.pow(2, 2 / 7))).toBeLessThan(1e-3);
    // in general T_u^{7/2} = T_t^{7/2} + (7/2) q_u L_eff/κ0e with L_eff = L − L_div (1 − 1/b)
    const rb = solveEdge(base);
    const Leff = rb.L_par - rb.L_div * (1 - 1 / rb.b);
    expect(rel(Math.pow(rb.T_u, 3.5), Math.pow(rb.T_t, 3.5) + (3.5 * rb.q_u * Leff) / DEFAULT_EDGE_PARAMS.kappa0e)).toBeLessThan(1e-10);
  });

  it('P_sep B/(2π R_u λ_q B_p) is the parallel heat-flux density; only the outer share f_out of P_sep enters', () => {
    const r = solveEdge(iter);
    const Ru = 8.2, Bt = (5.3 * 6.2) / Ru, Bp = iter.B_pol;
    expect(rel(r.q_u, ((2 / 3) * 100e6 * Math.hypot(Bt, Bp)) / (2 * Math.PI * Ru * r.lambda_q_mm * 1e-3 * Bp))).toBeLessThan(1e-12);
    expect(rel(r.q_u / solveEdge({ ...iter, P_sep: 50e6 }).q_u, 2)).toBeLessThan(1e-12);
    expect(rel(solveEdge(iter, resolveEdgeParams({ outerShare: 0.5 })).q_u / r.q_u, 0.75)).toBeLessThan(1e-12);
    expect(r.L_par).toBeCloseTo(Math.PI * 3 * 6.2, 12);
    expect(r.L_div).toBeCloseTo(0.3 * r.L_par, 12);
  });

  it('T_t ∝ n_u^{−2} in the attached, high-recycling range (T_t ≳ 25 eV, no momentum or power loss)', () => {
    const p: EdgePlasma = { ...iter, f_rad_div: 0.75 };
    const a = solveEdge(p), b = solveEdge({ ...p, n_sep: 2 * p.n_sep });
    expect(a.T_t).toBeGreaterThan(25);
    expect(b.T_t).toBeGreaterThan(25);
    expect(b.T_t / a.T_t).toBeGreaterThan(0.24);
    expect(b.T_t / a.T_t).toBeLessThan(0.26);
    // the sheath-limited limit: at very low n_u the target is as hot as the upstream, T_t → T_u, with n_t = n_u/2
    const dry = solveEdge({ ...iter, n_sep: 3e17, P_sep: 5e6, f_rad_div: 0 });
    expect(dry.T_t / dry.T_u).toBeGreaterThan(0.9);
    expect(dry.n_t / 3e17).toBeCloseTo(0.5, 1);
  });

  it('agrees with the engineering divertor heat flux (S = λ_q, f_out = 2/3, attached): same wetted area and radiated fraction', () => {
    const par = resolveEdgeParams({ spreadingRatio: 1 });
    const r = solveEdge({ ...iter, f_rad_div: 0.7 }, par);
    expect(r.state).toBe(ATTACHED);
    const legacy = divertorHeatFlux(ITER_G, 15e6, 100e6, 0.7, 5);
    expect(rel(r.lambda_q_mm, legacy.lambda_q_mm)).toBeLessThan(1e-12);
    expect(rel(r.A_wet, legacy.A_wet_m2)).toBeLessThan(1e-12);
    expect(rel(r.q_peak, legacy.q_div_MWm2)).toBeLessThan(1e-9);
  });

  it('a fully radiating divertor ends on the temperature floor with no target load; the state is detached', () => {
    const r = solveEdge({ ...iter, f_rad_div: 1 });
    expect(r.TtFloor).toBe(true);
    expect(r.T_t).toBe(DEFAULT_EDGE_PARAMS.TtFloor_eV);
    expect(r.state).toBe(DETACHED);
    expect(r.q_peak).toBe(0);
    expect(r.P_target).toBe(0);
    expect(r.f_rad).toBe(1);
    expect(r.f_pwr).toBe(1);
    const r95 = solveEdge({ ...iter, f_rad_div: 0.95 });
    expect(r95.T_t).toBeLessThan(2);
    expect(r95.f_mom).toBeGreaterThan(0.5);
  });

  it('more radiation, a colder target and a smaller load; the cliff between attachment and detachment is steep', () => {
    forAll(gen.record({ P: gen.logFloat(2e7, 3e8), n: gen.logFloat(2e19, 1e20), f: gen.float(0, 0.9), df: gen.float(0.001, 0.09) }), ({ P, n, f, df }) => {
      const a = solveEdge({ ...iter, P_sep: P, n_sep: n, f_rad_div: f }), b = solveEdge({ ...iter, P_sep: P, n_sep: n, f_rad_div: f + df });
      expect(b.T_t).toBeLessThanOrEqual(a.T_t * (1 + 1e-9));
      expect(b.q_peak).toBeLessThanOrEqual(a.q_peak * (1 + 1e-9));
      expect(b.P_target).toBeLessThanOrEqual(a.P_target * (1 + 1e-9));
    });
    // ITER, Eich λ_q: 90 % radiated fraction leaves T_t near 20 eV, 95 % takes the target to the floor
    expect(solveEdge({ ...iter, f_rad_div: 0.9 }).T_t).toBeGreaterThan(10);
    expect(solveEdge({ ...iter, f_rad_div: 0.95 }).T_t).toBeLessThan(2);
  });
});

/** the power ledger of the outer leg and the radiated power against an independent quadrature */
describe('power closure', () => {
  const gauss = new LengyelIntegral((T) => 1e-34 + 5e-32 * Math.exp(-0.5 * Math.pow(Math.log(T / 30) / 0.9, 2)));
  const smoothPar = (o: Parameters<typeof resolveEdgeParams>[0]): EdgeParams => resolveEdgeParams(o, { Ar: gauss, Ne: gauss, C: gauss, W: gauss, Be: gauss });

  it('closes P_sep = P_rad + P_cool + P_target + P_inner to 1e-8, for every combination of inputs (both radiation models)', () => {
    forAll(
      gen.record({
        P: gen.logFloat(1e5, 5e8), R: gen.float(1.2, 9.5), eps: gen.float(0.25, 0.7), B0: gen.float(1.5, 13), Bp: gen.float(0.15, 2.6), q95: gen.float(2, 8),
        n: gen.logFloat(3e18, 2e20), fx: gen.float(1, 12), fr: gen.float(0, 0.99), c: gen.logFloat(1e-4, 0.1), mode: gen.bool(), sp: gen.int(0, 3),
      }),
      (v) => {
        const species = (['Ne', 'Ar', 'C', 'W'] as const)[v.sp];
        const pl: EdgePlasma = { P_sep: v.P, R: v.R, a: v.R * v.eps, B0: v.B0, B_pol: v.Bp, q95: v.q95, n_sep: v.n, m_i: 2.5 * AMU, f_x: v.fx, f_rad_div: v.fr, seed: { species, c: v.c } };
        for (const par of [smoothPar({ radiation: v.mode ? 'lengyel' : 'prescribed' }), resolveEdgeParams({ radiation: v.mode ? 'lengyel' : 'prescribed' })]) {
          const r = solveEdge(pl, par);
          expect(r.closure).toBeLessThan(1e-8);
          expect(r.closureLengyel).toBeLessThan(1e-8);
          expect(r.P_rad + r.P_cool + r.P_target + r.P_inner).toBeCloseTo(r.P_sep, 3);
          for (const P of [r.P_rad, r.P_cool, r.P_target, r.P_inner]) expect(P).toBeGreaterThanOrEqual(0);
          expect(r.f_pwr).toBeGreaterThanOrEqual(0);
          expect(r.f_pwr).toBeLessThanOrEqual(1);
          expect(Number.isFinite(r.T_t) && Number.isFinite(r.T_u) && Number.isFinite(r.q_peak)).toBe(true);
        }
      },
      { runs: 300 },
    );
  });

  it('the radiated power of the Lengyel model equals the volumetric radiation integrated along the tube (independent quadrature, 1e-8)', () => {
    // n² c_z L_z(T) integrated over the tube: dx = κ0 T^{5/2} dT/q with q(T) from the closed-form Lengyel profile, the
    // lower segment (below the X-point) carrying b times the cross-section. High recycling (n_sep = 1.5e20), where there is a
    // radiating layer between the target and the divertor entrance
    const par = smoothPar({ radiation: 'lengyel', lambdaQ_mm: 2 });
    const base: EdgePlasma = { ...iter, n_sep: 1.5e20 };
    const need = solveEdge({ ...base, seed: { species: 'Ar', c: 0 } }, par).cz_det;
    for (const f of [0.3, 0.6, 0.9]) {
      const c = f * need;
      const pl: EdgePlasma = { ...base, seed: { species: 'Ar', c } };
      const r = solveEdge(pl, par);
      expect(r.f_rad).toBeGreaterThan(0.05);
      expect(r.f_rad).toBeLessThan(0.95);
      expect(r.T_t).toBeLessThan(0.3 * r.T_x);
      const kappa = par.kappa0e, b = r.b, p = pl.n_sep * r.T_u;
      const K = 2 * kappa * p * p * c;
      const qx = Math.sqrt(r.q_u ** 2 - K * gauss.integral(r.T_x, r.T_u));
      const qup = (T: number) => Math.sqrt(r.q_u ** 2 - K * gauss.integral(T, r.T_u));
      const qlow = (T: number) => Math.sqrt((qx / b) ** 2 - K * gauss.integral(T, r.T_x));
      const dens = (T: number, q: (T: number) => number) => (p * p * c * gauss.lz(T) * kappa * Math.pow(T, 0.5)) / q(T); // n² c L κ T^{5/2}/q, n = p/T
      const Ptube = (Ta: number, Tb: number, q: (T: number) => number) => integrateGL((x) => dens(Math.exp(x), q) * Math.exp(x), Math.log(Ta), Math.log(Tb), 64);
      const A_u = r.P_sep * (2 / 3) / r.q_u;
      const Prad = A_u * (Ptube(r.T_x, r.T_u, qup) + b * Ptube(r.T_t, r.T_x, qlow));
      expect(Math.abs(Prad - r.P_rad) / r.P_sep).toBeLessThan(1e-8);
      expect(r.closureLengyel).toBeLessThan(1e-8);
    }
  });

  it('with a partially radiating layer the ledger splits the leg into radiated, recycled and delivered power', () => {
    const r = solveEdge({ ...iter, f_rad_div: 0.8 });
    expect(r.P_leg).toBeCloseTo((2 / 3) * 100e6, 3);
    expect(r.P_inner).toBeCloseTo(100e6 / 3, 3);
    expect(r.P_rad / r.P_leg).toBeCloseTo(0.8, 12);
    expect(r.P_target / r.P_leg).toBeCloseTo((1 - 0.8) * (1 - r.f_cool), 12);
    expect(r.f_pwr).toBeCloseTo(1 - r.P_target / r.P_leg, 12);
  });
});

describe('ITER, P_sep = 100 MW: the need for a seeding impurity and the peak heat flux (Pitts et al. 2019 regime)', () => {
  // a broadened SOL (λ_q,mid = 2 mm, the SOLPS-ITER baseline of the ITER database); the Eich #14 width of this geometry is 0.57 mm
  const wide = { lambdaQ_mm: 2 };
  // synthetic cooling curve (peak 5e-32 W m³ at 30 eV) as a stand-in for the low-temperature neon curve, which the Mavrin fits (T_e ≥ 100 eV)
  // do not contain: it checks the solver in the regime of the SOLPS-ITER database, it is not neon data
  const neonLike = new LengyelIntegral((T) => 1e-34 + 5e-32 * Math.exp(-0.5 * Math.pow(Math.log(T / 30) / 0.9, 2)));
  // the separatrix densities that go with the divertor neutral pressures of the database of Lore et al., Nucl. Fusion 62 (2022) 106017
  // (11–27 Pa, Q_DT = 10, P_SOL = 100 MW, ⟨c_Ne⟩ up to ≈ 6 %; peak energy flux 5 → 3 MW/m²): n_sep = 2.65e19 (p/Pa)^0.31
  const nsepAt = (pdiv: number) => 2.65e19 * Math.pow(pdiv, 0.31);

  it('without seeding the peak load of an ITER divertor is far above the ~10 MW/m² criterion, for the Eich width and for a broadened SOL', () => {
    const narrow = solveEdge(iter);
    expect(narrow.lambda_q_mm).toBeGreaterThan(0.5);
    expect(narrow.lambda_q_mm).toBeLessThan(0.62);
    expect(narrow.q_peak).toBeGreaterThan(30);
    expect(narrow.state).toBe(ATTACHED);
    const broad = solveEdge(iter, resolveEdgeParams(wide));
    expect(broad.q_peak).toBeGreaterThan(10);
    expect(broad.state).toBe(ATTACHED);
    // the same at the separatrix densities of the database
    for (const pdiv of [11, 27]) expect(solveEdge({ ...iter, n_sep: nsepAt(pdiv) }, resolveEdgeParams(wide)).q_peak).toBeGreaterThan(10);
  });

  it('Ne-like seeding in the regime of the SOLPS-ITER database: the requirement is below its 6 %, and above it the peak load is ≤ 10 MW/m² and the target detached', () => {
    const par = resolveEdgeParams({ ...wide, radiation: 'lengyel' }, { Ne: neonLike });
    for (const pdiv of [11, 27]) {
      const base: EdgePlasma = { ...iter, n_sep: nsepAt(pdiv) };
      const need = solveEdge({ ...base, seed: { species: 'Ne', c: 0 } }, par);
      expect(need.p_div).toBeCloseTo(pdiv, 8);
      expect(need.cz_det).toBeGreaterThan(0.003);
      expect(need.cz_det).toBeLessThan(0.06);
      const load = (f: number) => solveEdge({ ...base, seed: { species: 'Ne', c: f * need.cz_det } }, par);
      // the attached branch: colder and less loaded with more neon, still above 10 MW/m² at half the requirement
      expect(load(0.2).q_peak).toBeGreaterThan(10);
      expect(load(0.5).q_peak).toBeGreaterThan(10);
      expect(load(0.5).q_peak).toBeLessThan(load(0.2).q_peak);
      expect(load(0.9).q_peak).toBeLessThan(load(0.5).q_peak);
      if (pdiv > 20) {
        // high recycling: a few MW/m² at the onset (the database: 3–5 MW/m² for 11–27 Pa), a cold partially detached target
        expect(load(0.97).q_peak).toBeGreaterThan(1);
        expect(load(0.97).q_peak).toBeLessThanOrEqual(10);
        expect(load(0.97).T_t).toBeLessThan(0.3 * load(0.5).T_t);
      }
      // well beyond the requirement the target heat flux has collapsed: the target is detached, the load is small
      for (const f of [2, 3]) {
        const r = load(f);
        expect(r.q_peak).toBeLessThanOrEqual(10);
        expect(r.state).toBe(DETACHED);
        expect(r.closure).toBeLessThan(1e-8);
        expect(r.closureLengyel).toBeLessThan(1e-8);
      }
      // the Lengyel state at the requirement has the detachment temperature: the sheath and the radiated heat flux agree there
      const Tdet = par.detachTt_eV, Tx = conductionTemperature(Tdet, need.q_u / need.b, need.L_div), Tu = conductionTemperature(Tx, need.q_u, need.L_par - need.L_div);
      const fl = lengyelFluxes({ q_u: need.q_u, b: need.b, p: base.n_sep * Tu, T_cc: Tdet, T_x: Tx, T_u: Tu, kappa0: par.kappa0e }, need.cz_det, neonLike);
      expect(rel((1 - coolingLoss(Tdet)) * fl.q_cc, sheathHeatFlux(base.n_sep, Tu, Tdet, momentumLoss(Tdet), base.m_i))).toBeLessThan(1e-9);
    }
  });

  it('with the Mavrin cooling function of argon the same chain holds: a finite requirement, and above it the load is ≤ 10 MW/m² with a detached target', () => {
    const par = resolveEdgeParams({ ...wide, radiation: 'lengyel' });
    const base: EdgePlasma = { ...iter, n_sep: nsepAt(27) };
    const need = solveEdge({ ...base, seed: { species: 'Ar', c: 0 } }, par);
    expect(need.cz_species).toBe('Ar');
    expect(need.cz_det).toBeGreaterThan(0);
    expect(need.cz_det).toBeLessThan(0.1);
    expect(need.cz_belowFit).toBeGreaterThan(0);
    expect(need.cz_belowFit).toBeLessThan(0.5);
    for (const f of [1.1, 1.5]) {
      const r = solveEdge({ ...base, seed: { species: 'Ar', c: f * need.cz_det } }, par);
      expect(r.q_peak).toBeLessThanOrEqual(10);
      expect(r.state).toBe(DETACHED);
    }
    expect(solveEdge({ ...base, seed: { species: 'Ar', c: 0.5 * need.cz_det } }, par).q_peak).toBeGreaterThan(10);
  });

  it('LIMITATION (pin): with the coronal Mavrin fits alone (T_e ≥ 100 eV) the neon requirement is several times the 6 % of the SOLPS-ITER database', () => {
    // neon radiates mostly between 20 and 100 eV, below the fits; their floor makes the concentration an upper bound (lengyel.ts).
    // When a low-temperature cooling function is added this test is to be replaced by a check against the database (≲ 6 %).
    const par = resolveEdgeParams({ ...wide, radiation: 'lengyel' });
    const need = solveEdge({ ...iter, n_sep: nsepAt(27), seed: { species: 'Ne', c: 0 } }, par);
    expect(need.cz_species).toBe('Ne');
    expect(need.cz_det).toBeGreaterThan(0.2);
    expect(need.cz_belowFit).toBeGreaterThan(0.2);
  });

  it('a heavy seed saturates: all of the power is radiated and the target sits on the floor', () => {
    const par = resolveEdgeParams({ ...wide, radiation: 'lengyel' });
    const r = solveEdge({ ...iter, seed: { species: 'Ar', c: 0.3 } }, par);
    expect(r.TtFloor).toBe(true);
    expect(r.f_rad).toBe(1);
    expect(r.q_peak).toBe(0);
    expect(r.state).toBe(DETACHED);
  });
});

describe('detachment diagnostics of the solution', () => {
  it('q_det, p_div and P_sep/R: the values of the qualifier for the inputs of the solution', () => {
    const r = solveEdge({ ...iter, seed: { species: 'Ne', c: 0.01 } });
    expect(r.P_sep_R).toBeCloseTo(100 / 6.2, 12);
    expect(r.p_div).toBeCloseTo(Math.pow(4e19 / 2.65e19, 1 / 0.31), 10);
    expect(rel(r.q_det, (1.3 / (1 + 45 * 0.01)) * (100 / 6.2) * (1 / r.p_div) * (5 / r.lambda_int_mm))).toBeLessThan(1e-12);
    expect(r.cz_qdet).toBeGreaterThan(0);
    // a seed with no radiative efficiency (tungsten) cannot be assessed: NaN
    expect(solveEdge({ ...iter, seed: { species: 'W', c: 1e-5 } }).cz_qdet).toBeNaN();
    // without a seed the qualifier refers to neon
    expect(solveEdge(iter).cz_species).toBe('Ne');
  });

  it('the concentration for detachment rises with the parallel heat flux and falls with the upstream density (Lengyel scaling c_z ∝ q^{8/7}/n² for a cold target)', () => {
    const c = (o: Partial<EdgePlasma>) => solveEdge({ ...iter, seed: { species: 'Ar', c: 0 }, ...o }, resolveEdgeParams({ lambdaQ_mm: 2 })).cz_det;
    expect(c({ P_sep: 150e6 })).toBeGreaterThan(c({}));
    expect(c({ n_sep: 8e19 })).toBeLessThan(c({}));
    expect(c({ n_sep: 8e19 }) / c({})).toBeLessThan(0.4);
    expect(c({ n_sep: 8e19 }) / c({})).toBeGreaterThan(0.15);
    // already detached without seeding (very high density, low power): no impurity needed
    expect(c({ P_sep: 5e6, n_sep: 2e20 })).toBe(0);
    // no cooling function → infinite concentration
    const dead = resolveEdgeParams({ lambdaQ_mm: 2 }, { Ar: new LengyelIntegral(() => 0) });
    expect(solveEdge({ ...iter, seed: { species: 'Ar', c: 0 } }, dead).cz_det).toBe(Infinity);
  });

  it('a run of the prescribed divertor radiation that is already at or below the detachment temperature needs no seed: c_z = 0, not the requirement of the unradiated tube', () => {
    // f_rad,div = 0.9: attached (T_t ≈ 19 eV), the requirement is that of a seed that does all of the radiation
    const attached = solveEdge({ ...iter, f_rad_div: 0.9 });
    expect(attached.T_t).toBeGreaterThan(DEFAULT_EDGE_PARAMS.detachTt_eV);
    expect(attached.cz_det).toBeGreaterThan(0);
    expect(attached.cz_det).toBe(solveEdge({ ...iter, f_rad_div: 0 }).cz_det);
    // f_rad,div = 0.95 and beyond: the target is at the temperature floor, detached, and no seed is needed
    for (const f of [0.95, 0.99, 1]) {
      const r = solveEdge({ ...iter, f_rad_div: f });
      expect(r.state).toBe(DETACHED);
      expect(r.T_t).toBeLessThanOrEqual(DEFAULT_EDGE_PARAMS.detachTt_eV);
      expect(r.cz_det).toBe(0);
      expect(r.cz_belowFit).toBe(0);
    }
    // c_z = 0 exactly when T_t is at or below the onset temperature, over the whole range of the prescribed radiation
    for (let k = 0; k <= 20; k++) {
      const r = solveEdge({ ...iter, f_rad_div: k / 20 });
      expect(r.cz_det === 0, `f_rad,div = ${k / 20}, T_t = ${r.T_t}`).toBe(r.T_t <= DEFAULT_EDGE_PARAMS.detachTt_eV);
    }
    // the criterion is the onset temperature of the parameters: raising it to 30 eV takes the 19 eV run into "detached already"
    const at30 = solveEdge({ ...iter, f_rad_div: 0.9 }, resolveEdgeParams({ detachTt_eV: 30 }));
    expect(at30.T_t).toBeCloseTo(attached.T_t, 6);
    expect(at30.cz_det).toBe(0);
  });

  it('with the Lengyel radiation the requirement is the onset concentration of the seed, whatever the state of the run', () => {
    const par = resolveEdgeParams({ radiation: 'lengyel' });
    const p: EdgePlasma = { ...iter, n_sep: 1.2e20, f_rad_div: 0.99, seed: { species: 'Ne', c: 0 } };
    const r = solveEdge(p, par);
    expect(r.cz_det).toBeGreaterThan(0); // an attached, unseeded run of the seed's mode: the concentration that would detach it
    expect(r.T_t).toBeGreaterThan(DEFAULT_EDGE_PARAMS.detachTt_eV);
    // a seed above the onset concentration detaches the run, and the requirement (a property of the SOL) does not change to 0
    const seeded = solveEdge({ ...p, seed: { species: 'Ne', c: 3 * r.cz_det } }, par);
    expect(seeded.T_t).toBeLessThanOrEqual(DEFAULT_EDGE_PARAMS.detachTt_eV);
    expect(seeded.cz_det).toBeGreaterThan(0);
    expect(rel(seeded.cz_det, r.cz_det)).toBeLessThan(0.05);
  });
});

describe('robustness and purity', () => {
  it('stays finite for degenerate inputs (no power, no current, no density, NaN, negative values)', () => {
    const bad: Partial<EdgePlasma>[] = [
      { P_sep: 0 }, { P_sep: -5e6 }, { P_sep: NaN }, { B_pol: 0 }, { B_pol: NaN }, { n_sep: 0 }, { n_sep: NaN }, { q95: 0 }, { q95: NaN },
      { m_i: 0 }, { f_x: 0 }, { f_x: NaN }, { R: NaN }, { a: 0 }, { B0: 0 }, { f_rad_div: NaN }, { f_rad_div: 3 }, { f_rad_div: -1 },
      { seed: { species: 'Ar', c: NaN } }, { seed: { species: 'Ar', c: -1 } }, { R_u: NaN },
    ];
    for (const o of bad) {
      for (const radiation of ['prescribed', 'lengyel'] as const) {
        const r = solveEdge({ ...iter, ...o }, resolveEdgeParams({ radiation }));
        for (const k of ['T_t', 'T_u', 'T_x', 'q_u', 'q_peak', 'f_pwr', 'P_sep_R', 'lambda_q_mm', 'q_det', 'closure'] as const) {
          expect(Number.isFinite(r[k]), `${JSON.stringify(o)} ${radiation}: ${k} = ${r[k]}`).toBe(true);
        }
        expect(r.closure).toBeLessThan(1e-8);
      }
    }
  });

  it('a pressure so low that no sheath solution exists in reach returns the largest temperature tried (still finite)', () => {
    const r = solveEdge({ ...iter, n_sep: 1e15, f_rad_div: 0 });
    expect(Number.isFinite(r.T_t)).toBe(true);
    expect(r.T_t).toBeGreaterThan(r.T_u * 0.99);
    expect(r.state).toBe(ATTACHED);
  });

  it('is a pure function: repeated calls and interleaved calls with other inputs give identical results', () => {
    const a = solveEdge({ ...iter, f_rad_div: 0.9 });
    solveEdge({ ...iter, P_sep: 3e7, seed: { species: 'Ar', c: 0.05 } }, resolveEdgeParams({ radiation: 'lengyel' }));
    solveEdge({ ...iter, n_sep: 1e20 });
    const b = solveEdge({ ...iter, f_rad_div: 0.9 });
    expect(b).toEqual(a);
    // and does not touch its inputs
    const pl = { ...iter, seed: { species: 'Ar' as const, c: 0.01 } };
    const frozen = JSON.stringify(pl);
    Object.freeze(pl); Object.freeze(pl.seed);
    solveEdge(pl);
    expect(JSON.stringify(pl)).toBe(frozen);
  });

  it('the loss fit and the transport coefficients are parameters: another fit set, γ or κ0e change the solution as they should', () => {
    const base = solveEdge({ ...iter, f_rad_div: 0.95 });
    // fit 2 loses at least 10 % of the power in the recycling layer at any T_t: a colder target
    const attached = solveEdge({ ...iter, f_rad_div: 0.85 });
    const fit2 = solveEdge({ ...iter, f_rad_div: 0.85 }, resolveEdgeParams({ lossFit: 'stangeby2' }));
    expect(fit2.T_t).toBeLessThan(0.9 * attached.T_t);
    // a higher sheath transmission takes more power at the same T_t: the target must be colder
    const g = solveEdge({ ...iter, f_rad_div: 0.9 }, resolveEdgeParams({ sheathGamma: 8.6 })), g0 = solveEdge({ ...iter, f_rad_div: 0.9 });
    expect(g.T_t).toBeLessThan(g0.T_t);
    // more conductive SOL, lower upstream temperature
    expect(solveEdge(iter, resolveEdgeParams({ kappa0e: 2390 })).T_u).toBeLessThan(solveEdge(iter).T_u);
    // the momentum loss at the solution is the fit's
    expect(base.f_mom).toBeCloseTo(momentumLoss(base.T_t), 14);
  });
});

describe('parameters', () => {
  it('resolves options, keeps defaults for missing, non-finite or out-of-range values, and shares the default object', () => {
    expect(resolveEdgeParams(undefined)).toBe(DEFAULT_EDGE_PARAMS);
    const p = resolveEdgeParams({ outerShare: 0.5, spreadingRatio: 2, S_mm: 1.5, lambdaQ_mm: 3, divertorLengthFraction: 0.2, kappa0e: 2390, sheathGamma: 8, lossFit: 'stangeby2', radiation: 'lengyel', seedEnrichment: 4, detachTt_eV: 2, targetTilt: 5, strikeRadiusFraction: 0.1 });
    expect(p).toMatchObject({ outerShare: 0.5, spreadingRatio: 2, S_mm: 1.5, lambdaQ_mm: 3, divertorLengthFraction: 0.2, kappa0e: 2390, sheathGamma: 8, radiation: 'lengyel', seedEnrichment: 4, detachTt_eV: 2, targetTilt: 5, strikeRadiusFraction: 0.1 });
    expect(p.fit.name).toBe('stangeby2');
    const junk = resolveEdgeParams({
      outerShare: 3, spreadingRatio: -1, S_mm: NaN, lambdaQ_mm: 0, divertorLengthFraction: 5, kappa0e: Infinity, sheathGamma: 'x' as never, lossFit: 'nope' as never,
      radiation: 'other' as never, seedEnrichment: 0, detachTt_eV: -2, targetTilt: NaN, strikeRadiusFraction: 7,
    });
    expect(junk).toEqual({ ...DEFAULT_EDGE_PARAMS, S_mm: undefined, lambdaQ_mm: undefined, lengyel: undefined });
    expect(resolveEdgeParams({}).radiation).toBe('prescribed');
  });

  it('an absolute S and λ_q override the ratio and the regression; the load follows λ_int', () => {
    const a = solveEdge(iter, resolveEdgeParams({ lambdaQ_mm: 1, S_mm: 2 }));
    expect(a.lambda_q_mm).toBe(1);
    expect(a.S_mm).toBe(2);
    expect(a.lambda_int_mm).toBeCloseTo(1 + 1.64 * 2, 12);
    expect(a.b).toBeCloseTo(4.28, 12);
    const b = solveEdge(iter, resolveEdgeParams({ lambdaQ_mm: 1, S_mm: 4 }));
    expect(b.A_wet / a.A_wet).toBeCloseTo((1 + 1.64 * 4) / (1 + 1.64 * 2), 12);
    const c = solveEdge(iter, resolveEdgeParams({ targetTilt: 6 }));
    expect(c.A_wet / solveEdge(iter).A_wet).toBeCloseTo(2, 12);
  });

  it('the detachment temperature and the divertor length are parameters of the requirement and of the temperature', () => {
    const p = { ...iter, seed: { species: 'Ar' as const, c: 0 } };
    const at5 = solveEdge(p, resolveEdgeParams({ lambdaQ_mm: 2 })).cz_det;
    const at2 = solveEdge(p, resolveEdgeParams({ lambdaQ_mm: 2, detachTt_eV: 2 })).cz_det;
    const at20 = solveEdge(p, resolveEdgeParams({ lambdaQ_mm: 2, detachTt_eV: 20 })).cz_det;
    // the requirement is nearly independent of the temperature that defines the onset (the collapse of the target heat flux is
    // steep: the recycling layer takes the power at T_t of a few eV), and rises towards higher target temperatures
    expect(Math.abs(at2 / at5 - 1)).toBeLessThan(0.1);
    expect(at20).toBeLessThan(at5);
    // a longer divertor leg with the broadened flux tube lowers the upstream temperature
    expect(solveEdge(iter, resolveEdgeParams({ divertorLengthFraction: 0.6 })).T_u).toBeLessThan(solveEdge(iter, resolveEdgeParams({ divertorLengthFraction: 0.1 })).T_u);
  });
});

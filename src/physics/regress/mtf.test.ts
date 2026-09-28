/**
 * Regression tests (lane ws2b, "should" items):
 *  - MagLIF on Z stagnates for ~1–2 ns (Gomez et al., PRL 113 (2014) 155003; PRL 125 (2020) 155002);
 *    the model's compression pulse had a width of 0.3·t_c = 30 ns.
 *  - FRC and mirror: thermal energy 3/2 (n_e + n_i) T V, not 3 n_e T V (n_i ≠ n_e for D-³He, p-¹¹B).
 */
import { describe, expect, it } from 'vitest';
import { FRCModel } from '../confinement/frc';
import { MirrorModel } from '../confinement/mirror';
import { FUEL_SPECIES } from '../reactivity';
import { GF_PISTON, MIRROR, TAE, ZMACHINE } from '../presets';
import { Simulation } from '../simulation';

const KEV = 1.602176634e-16;

/** full width at half maximum of the fusion power pulse [µs] */
function burnFWHM(cfg: typeof ZMACHINE): number {
  const sim = new Simulation(cfg);
  sim.runAll();
  const h = sim.history;
  const pk = Math.max(...h.map((f) => f.d.P_fus));
  const above = h.filter((f) => f.d.P_fus >= pk / 2);
  return above[above.length - 1].t - above[0].t;
}

describe('MagLIF stagnation', () => {
  it('burns for ~2 ns, not tens of ns', () => {
    const w = burnFWHM(ZMACHINE) * 1e3; // ns
    expect(w).toBeGreaterThan(1);
    expect(w).toBeLessThan(3);
  });

  it('slow liner/piston compressions keep their 0.3·t_c stagnation', () => {
    expect(burnFWHM(GF_PISTON) / GF_PISTON.compressionTime_us).toBeGreaterThan(0.2);
  });

  // The dwell time r_min/v_imp of a self-similar implosion scales as t_c/CR: a MagLIF run with the
  // wizard's slow compression times (up to 20 ms) must neither stagnate for Z's 2 ns nor be
  // integrated with a 0.2 ns step over the whole shot (2e7 steps at t_c = 2 ms before the fix).
  it('the stagnation time scales with t_c/CR (self-similar implosion)', () => {
    const zRatio = burnFWHM(ZMACHINE) / ZMACHINE.compressionTime_us;
    for (const tc of [0.01, 20, 2000]) {
      expect(burnFWHM({ ...ZMACHINE, compressionTime_us: tc }) / tc / zRatio).toBeCloseTo(1, 2);
    }
    // half the convergence ratio, twice the dwell time (the burn narrows a little less than σ)
    const r = burnFWHM({ ...ZMACHINE, compressionRatio: 15 }) / burnFWHM(ZMACHINE);
    expect(r).toBeGreaterThan(1.8);
    expect(r).toBeLessThan(2.4);
  });

  it('wizard-range MagLIF shots finish in O(10³) integrator steps', () => {
    const cases = [0.01, 20, 2000, 20000].map((tc) => ({ ...ZMACHINE, compressionTime_us: tc }));
    // the minimal counterexample of ws2a's wizard smoke test (stopped as stalled after 20001 steps)
    cases.push({ ...ZMACHINE, compressionTime_us: 1999.31, current_MA: 37.2337, flowShear: 0.0658, preheat_kJ: 26.7 });
    for (const cfg of cases) {
      const sim = new Simulation(cfg);
      sim.advance(sim.model.outputDt);
      expect(sim.nSteps, `t_c = ${cfg.compressionTime_us} µs, first output step`).toBeLessThan(50);
      sim.runAll();
      expect(sim.nSteps, `t_c = ${cfg.compressionTime_us} µs, whole shot`).toBeLessThan(5000);
      expect(sim.model.terminated?.natural).toBe(true);
      expect(Number.isFinite(sim.history[sim.history.length - 1].d.Efus_MJ)).toBe(true);
    }
  });
});

describe('FRC / mirror thermal energy with n_i ≠ n_e', () => {
  it('W = 3/2 (n_e + n_i) T V', () => {
    for (const fuel of ['DT', 'DHe3', 'pB11'] as const) {
      const fs = FUEL_SPECIES[fuel];
      const frc = new FRCModel({ ...TAE, fuel });
      const ni = TAE.n0, ne = ni * (fs.fracA * fs.a.Z + (1 - fs.fracA) * fs.b.Z);
      const V = frc.geometryInfo().V;
      expect(frc.initialState()[0] / (1.5 * (ne + ni) * TAE.T0_keV * KEV * V)).toBeCloseTo(1, 12);
      expect(frc.diagnostics(0, frc.initialState()).Ti).toBeCloseTo(TAE.T0_keV, 12);
      const mir = new MirrorModel({ ...MIRROR, fuel });
      const Vm = mir.geometryInfo().V;
      expect(mir.initialState()[0] / (1.5 * (ne * MIRROR.n0 / TAE.n0 + MIRROR.n0) * MIRROR.T_keV * KEV * Vm)).toBeCloseTo(1, 12);
      expect(mir.diagnostics(0, mir.initialState()).Ti).toBeCloseTo(MIRROR.T_keV, 12);
    }
  });
});

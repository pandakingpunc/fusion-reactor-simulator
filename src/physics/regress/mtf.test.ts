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

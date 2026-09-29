/**
 * The checks of the fast-ion work against the literature and against the 0D model: the thermal / beam-target split of the JET DTE2 record pulses (Štancar et
 * al., Nucl. Fusion 63 (2023) 126058), the beam-target scaling with the fuel mix (JET fuel with fuelFracA = 0), and the fast-ion pressure of DIII-D with a 500 keV beam
 * (1.5D against 0D).
 *
 * Štancar et al.: the T-rich record pulse #99972 (10:90 D-T, D beams of 110 keV, 29 MW NBI + 3.7 MW ICRH, I_p = 2.5 MA, B_0 = 3.85 T, core T_i 9.8 keV) is beam-target driven
 * with about 7-8 % of the fusion power thermal (section 4); the baseline pulses (50-50 D-T, I_p ≥ 3 MA) sustain a (beam-target + beam-beam)/thermal yield ratio of 1
 * (section 3.1). The model's split is a factor of order 1 from the first (thermal fraction 5 to 11 %, table below) and does not reach the 15 % of the target: the
 * preset is baseline-like (3.5 MA, core n_e 1e20), its fusion power in the T-rich mix is twice the measured one (21 MW against 11.8 MW), the beam density on the axis is 16 %
 * of the ions against ≤ 10 % of the analysis, and the model has no fast-ion transport or loss. The numbers are recorded here as the state of the model, with the
 * bounds of a factor of two around the published thermal fraction (accepting less would be fitting the model).
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../simulation';
import { DIIID, JET_15D } from '../../presets';
import type { MagneticConfig } from '../../types';

/** JET15 with the fuel mix and settings given, run to t_end; the flat-top means from t0 */
function jet(over: Partial<MagneticConfig>, t_end: number, t0: number, prof: NonNullable<MagneticConfig['profiles']> = {}) {
  const sim = new Simulation({ ...JET_15D, ...over, t_end, profiles: { ...JET_15D.profiles, ...prof } } as MagneticConfig);
  sim.runAll();
  const fl = sim.history.filter((f) => f.t >= t0);
  const mean = (k: string) => fl.reduce((s, f) => s + f.d[k], 0) / fl.length;
  return { sim, P_fus: mean('P_fus'), P_bt: mean('P_bt'), Ti0: mean('Ti0'), th: 1 - mean('P_bt') / mean('P_fus') };
}

describe('JET DTE2: the thermal fraction of the fusion power and the fuel mix', () => {
  it('the T-rich mix (10:90 D-T, D beams) is beam-target driven, the thermal fraction within a factor of two of the 7-8 % of Štancar et al. for the pulse-like plasma (2.5 MA, 3.85 T, n̄ = 4.5e19), in the scalar and in the profile fast-ion model', () => {
    const scalar = jet({ fuelFracA: 0.1, Ip_MA: 2.5, B0: 3.85, n_target: 4.5e19 }, 2.6, 1.6);
    const profile = jet({ fuelFracA: 0.1, Ip_MA: 2.5, B0: 3.85, n_target: 4.5e19 }, 2.6, 1.6, { fastIonModel: 'profile' });
    for (const r of [scalar, profile]) {
      expect(r.th).toBeGreaterThan(0.075 / 2);
      expect(r.th).toBeLessThan(0.075 * 2);
      expect(r.P_bt).toBeGreaterThan(8 * (r.P_fus - r.P_bt));
    }
  }, 240000);

  it('the beam-target power scales with the target density of the beam species: with no thermal deuterium (fuelFracA = 0) it is 2 times that of the 50/50 mix (n_T doubles) to 30 %, the thermal power falls by an order of magnitude, and the fusion power rises by half (the JET fuel-mix case: 82 to 122 MJ in 5.5 s is physics, not a bug)', () => {
    const half = jet({ fuelFracA: 0.5 }, 3, 1.5);
    const none = jet({ fuelFracA: 0 }, 3, 1.5);
    expect(none.P_bt / half.P_bt).toBeGreaterThan(1.7);
    expect(none.P_bt / half.P_bt).toBeLessThan(2.6);
    expect((none.P_fus - none.P_bt) / (half.P_fus - half.P_bt)).toBeLessThan(0.15);
    expect(none.P_fus / half.P_fus).toBeGreaterThan(1.3);
    expect(none.P_fus / half.P_fus).toBeLessThan(1.7);
  }, 240000);
});

describe('DIII-D with a 500 keV beam: the fast-ion pressure in 1.5D and in 0D', () => {
  const diiid = (fidelity: '0D' | '1.5D', t_end: number, prof: NonNullable<MagneticConfig['profiles']> = {}) => {
    const sim = new Simulation({ ...DIIID, fidelity, t_end, heating: { ...DIIID.heating, E_NBI_keV: 500 }, profiles: { ...DIIID.profiles, ...prof } } as MagneticConfig);
    sim.runAll();
    const betaMax = Math.max(...sim.history.map((f) => f.d.betaN));
    const wf = (t: number) => sim.history.find((f) => f.t >= t)!.d.W_beam;
    return { sim, betaMax, wf, term: (sim.model as unknown as { terminated: { reason: string } | null }).terminated };
  };

  it('1.5D reaches the Troyon limit (β_N = 3.5, total pressure) before 1 s and disrupts, 0D does not: the fast ions hold 1.5 times more energy in 1.5D because they slow down in the hot core (τ_W ∝ T_e^{3/2}), the 0D pool with the volume-average T_e and n_e', () => {
    const d1 = diiid('1.5D', 1.2);
    const d0 = diiid('0D', 1.2);
    expect(d1.term?.reason).toMatch(/Beta limit/);
    expect(d0.term?.reason ?? '').not.toMatch(/Beta limit/);
    expect(d0.betaMax).toBeLessThan(3.5);
    expect(d1.wf(0.7) / d0.wf(0.7)).toBeGreaterThan(1.4);
    expect(d1.wf(0.7) / d0.wf(0.7)).toBeLessThan(2);
  }, 240000);
});

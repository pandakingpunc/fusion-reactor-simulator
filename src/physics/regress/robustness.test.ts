/**
 * Regression tests (lane ws2b review): numerical robustness of the 0D magnetic model.
 *
 *  - The state components that cannot be negative are clamped after every step. The model passes an
 *    index array as integratorOpts.nonNegative (the smoothed dW/dt is signed), and the integrator of
 *    this branch clamped only for `nonNegative: true` (a dangling else, fixed in the v4 kernel): the
 *    alpha pool of ITER-pB11 went negative. postStep() now clamps those components itself.
 *  - The right-hand side is finite for every finite state. The trial stages of a stiff step (the first
 *    step into a thermal quench, h ≈ 10 τ_TQ) reach W ~ 1e100 J; P_sync ∝ T_e^2 then overflowed, the
 *    error norm became NaN and the Dormand–Prince controller of this branch turned it into a NaN step
 *    size (t = NaN, the shot never ended). The temperatures are now evaluated within [0.01, 1e4] keV.
 *  - ITER with p-¹¹B fuel ends in an orderly radiative-collapse disruption: the density rises towards
 *    its target, the boron-dominated bremsstrahlung and the Be/Ar line radiation exceed the heating
 *    once T_e falls below 2 keV, and the thermal and current quench complete.
 */
import { describe, expect, it } from 'vitest';
import { MagneticModel } from '../confinement/magnetic';
import { ITER } from '../presets';
import { Simulation } from '../simulation';

describe('0D magnetic model: finite rates for any finite state', () => {
  it('rhs() and diagnostics() stay finite for absurdly large stored energies', () => {
    for (const fuel of ['DT', 'pB11'] as const) {
      const m = new MagneticModel({ ...ITER, fuel });
      const y0 = m.initialState();
      for (const W of [1e30, 1e100, 1e200]) {
        const y = Float64Array.from(y0);
        y[0] = W; y[1] = W; y[6] = W; y[14] = W;
        const d = new Float64Array(y.length);
        m.rhs(1, y, d);
        d.forEach((v, i) => { if (!Number.isFinite(v)) expect.fail(`${fuel}, W = ${W} J: dy[${i}]/dt = ${v}`); });
        for (const [k, v] of Object.entries(m.diagnostics(1, y))) if (!Number.isFinite(v)) expect.fail(`${fuel}, W = ${W} J: ${k} = ${v}`);
      }
    }
  });
});

describe('0D magnetic model: non-negative state', () => {
  it('postStep() clamps every component but the signed dW/dt', () => {
    const m = new MagneticModel(ITER);
    const y = m.initialState();
    m.rhs(0.5, y, new Float64Array(y.length));
    const neg = [4, 6, 11, 14]; // n_He, W_alpha, N_Tburn, W_beam
    for (const i of neg) y[i] = -1e-3 * (1 + i);
    y[15] = -5e6; // dW/dt [W]
    m.postStep(0.5, 1e-3, y);
    for (const i of neg) expect(y[i], `y[${i}]`).toBe(0);
    expect(y[15]).toBe(-5e6);
  });

  it('ITER-pB11: every recorded state is non-negative outside dW/dt', () => {
    const sim = new Simulation({ ...ITER, fuel: 'pB11', t_end: 30 });
    sim.runAll();
    for (const f of sim.history) f.y.forEach((v, i) => { if (i !== 15 && v < 0) expect.fail(`t = ${f.t}: y[${i}] = ${v}`); });
  });
});

describe('ITER with p-¹¹B fuel (golden case ITER-pB11)', { timeout: 60_000 }, () => {
  it('ends in a radiative collapse whose thermal and current quench complete', () => {
    const sim = new Simulation({ ...ITER, fuel: 'pB11', t_end: 100 });
    sim.runAll();
    expect(Number.isFinite(sim.t)).toBe(true);
    const term = sim.model.terminated;
    expect(term?.natural).toBe(false);
    expect(term?.reason).toMatch(/radiative collapse/i);
    const kinds = sim.events.map((e) => e.kind);
    expect(kinds).toContain('disruption');
    expect(kinds).toContain('quench');
    expect(kinds[kinds.length - 1]).toBe('end');
    const disr = sim.events.find((e) => e.kind === 'disruption')!;
    const at = sim.history.filter((f) => f.t <= disr.t).at(-1)!.d;
    expect(at.Te).toBeLessThan(2.5);
    expect(at.P_rad).toBeGreaterThan(0.9 * at.P_heat);
  });
});

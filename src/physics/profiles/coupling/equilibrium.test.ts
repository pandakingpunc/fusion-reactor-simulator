/**
 * The Grad–Shafranov update of the coupling (coupling/equilibrium.ts): what it adopts (the acceptance of an outer
 * iteration) and what it builds the transport geometry on (the radial grid of the model).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JET_15D } from '../../presets';
import { Simulation } from '../../simulation';
import { geometryFromEquilibrium } from '../geometry1d';
import type { TransportGeometry } from '../geometry1d';
import { ProfileModel } from '../model';
import { OUTER_ACCEPT, OUTER_LIMIT, OUTER_MAX, OUTER_TOL, outerAdoptable } from './equilibrium';
import * as outer from './outer';

describe('the acceptance of an outer iteration', () => {
  it('the limit is half a transport cell of the default 50, twice the mismatch at which the iteration stops contracting', () => {
    expect(OUTER_TOL).toBeLessThan(OUTER_ACCEPT);
    expect(OUTER_LIMIT).toBe(2 * OUTER_ACCEPT);
    expect(OUTER_LIMIT).toBeCloseTo(0.5 / 50, 12);
    expect(OUTER_MAX).toBeGreaterThan(1);
  });

  it('a converged iteration is adopted; a non-converged one is adopted up to the limit, with a margin around the measured mismatches', () => {
    expect(outerAdoptable({ converged: true, delta: 1e-3 })).toBe(true);
    // JET15 in the ramp-up (t = 0.557 s: 5.2e-3, rejected against a limit of 5e-3) and with 15 % less current (5.7e-3): both are
    // about half the limit, not at its edge
    for (const d of [4.5e-3, OUTER_ACCEPT, 5.2e-3, 5.7e-3, 0.9 * OUTER_LIMIT, OUTER_LIMIT]) expect(outerAdoptable({ converged: false, delta: d }), `${d}`).toBe(true);
    for (const d of [1.05 * OUTER_LIMIT, 1.1e-2, 1.8e-2, 2.9e-2, Infinity]) expect(outerAdoptable({ converged: false, delta: d }), `${d}`).toBe(false);
  });
});

describe('what an update does with the mismatch of the iteration', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  /** One update of a fresh JET15 model from its initial equilibrium, the outer iteration reporting `delta` without convergence */
  const updateWith = (delta: number) => {
    const real = outer.solveConsistent;
    vi.spyOn(outer, 'solveConsistent').mockImplementation((...a) => ({ ...real(...a), converged: false, delta }));
    const m = new ProfileModel({ ...JET_15D, t_end: 0.3 });
    const y = m.initialState();
    m.physics.evaluateWorkArrays(0, m.ctx.view(y));
    const tg0 = m.ctx.tg;
    const ok = m.updateEquilibrium(0.01, y);
    return { ok, retried: m.eqRetried, replaced: m.ctx.tg !== tg0, why: m.eqAttempts[m.eqAttempts.length - 1].rejected };
  };

  it.each([
    ['within OUTER_ACCEPT', 0.8 * OUTER_ACCEPT, true, 0],
    ['between OUTER_ACCEPT and OUTER_LIMIT (adopted, counted as one that needed help)', 1.4 * OUTER_ACCEPT, true, 1],
    ['just within OUTER_LIMIT', 0.99 * OUTER_LIMIT, true, 1],
    ['above OUTER_LIMIT (rejected)', 1.05 * OUTER_LIMIT, false, 0],
  ] as [string, number, boolean, number][])('a mismatch %s', (_what, delta, adopted, retried) => {
    const r = updateWith(delta);
    expect(r.ok).toBe(adopted);
    expect(r.replaced).toBe(adopted);
    expect(r.retried).toBe(retried);
    if (!adopted) expect(r.why).toContain('did not converge');
  });
});

describe('the geometry of an update is built on the radial grid of the model', () => {
  it('a model on a packed (non-uniform) grid keeps it through the update: faces, centres and mean cell width', () => {
    const m = new ProfileModel({ ...JET_15D, t_end: 0.3 });
    const y = m.initialState(), N = m.ctx.N;
    m.physics.evaluateWorkArrays(0, m.ctx.view(y));
    expect(m.updateEquilibrium(0.01, y)).toBe(true);
    // the model is on a grid of cells that are 10 % narrower at the edge than at the axis: its geometry adopted through the
    // same path as the initial one, the work arrays and the solvers evaluated on it
    const faces = Float64Array.from({ length: N + 1 }, (_, i) => i / N - (0.1 * Math.sin((2 * Math.PI * i) / N)) / (2 * Math.PI));
    const centres = Float64Array.from({ length: N }, (_, i) => 0.5 * (faces[i] + faces[i + 1]));
    m.ctx.adoptGeometry({ eq: m.ctx.eq, tg: geometryFromEquilibrium(m.ctx.eq, N, m.ctx.geomB, { rhoC: centres, rhoF: faces, dRho: 1 / N }) });
    const y2 = m.initialState();
    m.physics.evaluateWorkArrays(0, m.ctx.view(y2));
    const before = m.ctx.tg;
    expect(m.updateEquilibrium(0.02, y2)).toBe(true);
    const after = m.ctx.tg;
    expect(after).not.toBe(before); // a new geometry was adopted ...
    expect(Array.from(after.rhoF)).toEqual(Array.from(faces)); // ... on the grid of the one it replaced, not on a uniform one
    expect(Array.from(after.rhoC)).toEqual(Array.from(centres));
    expect(after.dRho).toBe(1 / N);
    expect(after.rhoF[1]).not.toBe(1 / N);
  }, 60000);

  it('every geometry a JET15 shot adopts during its ramp-up (four updates and more) is on the grid of the first one', () => {
    const sim = new Simulation({ ...JET_15D, t_end: 0.7 });
    const m = sim.model as ProfileModel;
    const adopted: TransportGeometry[] = [];
    m.ctx.onGeometry((tg) => { adopted.push(tg); });
    sim.runAll();
    expect(m.eqRejected).toBe(0);
    expect(adopted.length).toBe(m.eqUpdates + 1);
    expect(m.eqUpdates).toBeGreaterThanOrEqual(4);
    const first = adopted[0];
    for (const [k, tg] of adopted.entries()) {
      expect(Array.from(tg.rhoF), `faces after ${k} updates`).toEqual(Array.from(first.rhoF));
      expect(Array.from(tg.rhoC), `centres after ${k} updates`).toEqual(Array.from(first.rhoC));
      expect(tg.dRho).toBe(first.dRho);
    }
  }, 60000);
});

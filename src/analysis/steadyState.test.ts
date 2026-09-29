import { describe, expect, it } from 'vitest';
import { computePopcon } from '../physics/popcon';
import { boundaryShape, plasmaVolume } from '../physics/geometry';
import { DEMO, DIIID, ITER, JET, JT60SA, MASTU, SPARC, W7X } from '../physics/presets';
import type { MagneticConfig } from '../physics/types';
import { FUEL_CHANNELS } from '../physics/reactivity';
import { greenwaldDensity } from '../physics/limits';
import { lineAverageFactor } from '../physics/limits';
import { steadyState } from './steadyState';

const CASES: [string, MagneticConfig][] = [
  ['ITER', ITER], ['JET', JET], ['SPARC', SPARC], ['DEMO', DEMO], ['DIII-D (D-D)', DIIID], ['JT-60SA', JT60SA],
  ['MAST-U (spherical, ST_Valovic)', MASTU], ['W7-X (stellarator, ISS04)', W7X],
  ['p-B11 on the JET geometry', { ...JET, fuel: 'pB11', fuelFracA: 0.5 }], ['D-3He on the JET geometry', { ...JET, fuel: 'DHe3', fuelFracA: 0.5 }],
  // v4.0: the ITPA20 scalings take the areal elongation and the LCFS triangularity, and V and S are those of the boundary shape (ITER, DEMO: the LCFS)
  ['ITER, ITPA20', { ...ITER, scaling: 'ITPA20' }], ['ITER, ITPA20-IL', { ...ITER, scaling: 'ITPA20-IL' }],
  ['DEMO with an edited kappa and delta (LCFS scaled by lcfsRef95)', { ...DEMO, geometry: { ...DEMO.geometry, kappa: 1.75, delta: 0.4 } }],
];

const rel = (a: number, b: number) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(b), 1e-300));

describe('steady-state evaluator = the POPCON fixed point at a single point', () => {
  it.each(CASES)('%s: agrees with computePopcon at every node of a 6 x 6 grid (1e-12)', (_name, cfg) => {
    const grid = computePopcon(cfg, { nx: 6, ny: 6 });
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        const s = steadyState(cfg, grid.n[i], grid.T[j]);
        const k = i * grid.ny + j;
        expect(rel(s.Paux, grid.Paux[k]), `Paux (${i}, ${j})`).toBeLessThan(1e-12);
        expect(rel(s.Pfus, grid.Pfus[k]), `Pfus (${i}, ${j})`).toBeLessThan(1e-12);
        expect(rel(s.betaN, grid.betaN[k]), `betaN (${i}, ${j})`).toBeLessThan(1e-12);
        expect(rel(s.fHe, grid.fHe[k]), `fHe (${i}, ${j})`).toBeLessThan(1e-12);
        expect(s.hmodeAccess ? 1 : 0, `L-H access (${i}, ${j})`).toBe(grid.PLH_ok[k]);
        if (Number.isFinite(grid.Q[k])) expect(rel(s.Q, grid.Q[k]), `Q (${i}, ${j})`).toBeLessThan(1e-12);
        else expect(s.Q).toBe(Infinity);
      }
    }
  });
});

describe('steady-state quantities', () => {
  const s = steadyState(ITER, 0.85e20, 12);

  it('the loss power is what remains of the heating after the core radiation: P_L = P_aux + P_char - P_rad,core', () => {
    expect(rel(s.PL, s.Paux + s.Pchar - s.PradCore)).toBeLessThan(1e-9);
    expect(s.PradCore).toBeLessThan(s.Prad);
    expect(s.PradCore).toBeGreaterThan(0);
  });

  it('Q is the fusion power over the auxiliary power; the D-T charged share is the alpha fraction', () => {
    expect(s.Q).toBeCloseTo(s.Pfus / s.Paux, 12);
    const dt = FUEL_CHANNELS.DT[0];
    expect(s.Pchar / s.Pfus).toBeCloseTo(dt.Echarged_MeV / dt.Etot_MeV, 12);
    expect(s.Pchar / s.Pfus).toBeGreaterThan(0.19);
    expect(s.Pchar / s.Pfus).toBeLessThan(0.21);
  });

  it('density ratio, beta_N, q95, volume and stored energy follow their definitions', () => {
    expect(s.nOverNG).toBeCloseTo((lineAverageFactor(ITER.transport.alpha_n) * s.n) / greenwaldDensity(ITER.Ip_MA, ITER.geometry.a), 12);
    expect(s.nOverNG).toBeGreaterThan(0.6);
    expect(s.nOverNG).toBeLessThan(1);
    expect(s.q95).toBeGreaterThan(2.5); // ITER Uckan formula: about 3 at the baseline
    expect(s.q95).toBeLessThan(3.6);
    // the volume of the boundary (LCFS) shape, kappa 1.85 and delta 0.49 (ITER design: 837 m^3, Shimada et al. 2007); the ellipse formula gave 832.2
    expect(s.V).toBeCloseTo(plasmaVolume(boundaryShape(ITER)), 9);
    expect(s.V).toBeGreaterThan(830);
    expect(s.V).toBeLessThan(850);
    expect(s.tauE).toBeCloseTo(s.W / (s.PL - (s.Prad - s.PradCore)) , 1);
    expect(s.hmodeAccess).toBe(s.PL >= s.PLH);
    expect(s.hmodeAccess).toBe(true);
    expect(s.n).toBe(0.85e20);
    expect(s.T).toBe(12);
  });

  it('a better confinement (H98) needs less auxiliary power and gives a higher Q; a stellarator has no q95 and no beta_N with Ip = 0', () => {
    const lo = steadyState({ ...ITER, H98: 0.9 }, 0.85e20, 12), hi = steadyState({ ...ITER, H98: 1.2 }, 0.85e20, 12);
    expect(hi.Paux).toBeLessThan(lo.Paux);
    expect(hi.Q).toBeGreaterThan(lo.Q);
    const w = steadyState(W7X, 0.5e20, 4);
    expect(w.q95).toBe(0);
    expect(w.betaN).toBe(0);
    expect(w.nOverNG).toBe(0);
  });

  it('a clean, well-confined plasma ignites: the alpha heating alone exceeds the losses, Paux < 0 and Q = Infinity', () => {
    const clean: MagneticConfig = { ...ITER, impurity: { ...ITER.impurity, concentration: 1e-4, seedConcentration: 0, seedSpecies: undefined }, H98: 2 };
    const g = steadyState(clean, 0.6e20, 6);
    expect(g.Paux).toBeLessThan(0);
    expect(g.Q).toBe(Infinity);
    expect(steadyState(clean, 0.6e20, 8).Q).toBeLessThan(Infinity); // a little hotter it needs heating again
  });

  it('the fixed point is deterministic and cheap to call repeatedly', () => {
    const a = steadyState(SPARC, 2e20, 15), b = steadyState(SPARC, 2e20, 15);
    expect(a).toEqual(b);
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) steadyState(SPARC, 2e20, 15 + i * 1e-3);
    expect((performance.now() - t0) / 200).toBeLessThan(5); // ms per point; about 0.1 ms measured, generous margin for a loaded CI machine
  });
});

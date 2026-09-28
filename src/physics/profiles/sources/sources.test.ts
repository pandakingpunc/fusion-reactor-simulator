/**
 * Cached fast paths of the NBI source against their reference implementations: the chord cache
 * (NbiChord) against the direct pencil-beam deposition (nbiDeposition), and the beam-target
 * reactivity table (BeamTargetTable) against the direct slowing-down integral
 * (beamTargetReactivity).
 */
import { describe, expect, it } from 'vitest';
import { ITER_15D, JET_15D } from '../../presets';
import { beamTargetReactivity, FuelType } from '../../reactivity';
import { RNG } from '../../rng';
import { BeamTargetTable } from '../beamtarget';
import { circularGeometry, TransportGeometry } from '../geometry1d';
import { ProfileModel } from '../model';
import { NbiChord, nbiDeposition, volumeIntegral } from './deposition';

describe('NBI deposition: NbiChord (cached chord) against nbiDeposition (direct)', () => {
  const geometries: [string, () => TransportGeometry][] = [
    ['circular', () => circularGeometry(3, 1, 3, 40)],
    ['ITER15 Grad–Shafranov', () => new ProfileModel(ITER_15D).tg],
    ['JET15 Grad–Shafranov', () => new ProfileModel(JET_15D).tg],
  ];
  const densities: [string, (r: number) => number][] = [
    ['peaked', (r) => 1.2e20 * (1 - 0.7 * r * r)],
    ['flat', () => 0.6e20],
    ['hollow', (r) => 0.4e20 * (1 + r * r)],
    ['dense', (r) => 4e20 * (1 - 0.5 * r * r)],
  ];

  it.each(geometries)('%s geometry: same deposition and shine-through for every density, energy and tangency radius', (_name, geom) => {
    const g = geom();
    const Redge = g.RoutF[g.N];
    let chords = 0;
    // R_tan: typical tangential, near-perpendicular (the chord crosses the inboard side), beyond the edge (clamped)
    for (const Rtan of [0.9 * g.R0, 0.5 * g.R0, 1.2 * Redge]) {
      const chord = new NbiChord(g, Rtan);
      chords++;
      for (const [, nf] of densities) {
        const ne = Float64Array.from(g.rhoC, nf);
        for (const E of [1000, 110, 55, 110 / 3]) {
          const ref = nbiDeposition(g, ne, E, 2, Rtan);
          const out = new Float64Array(g.N).fill(NaN);
          const got = chord.deposit(ne, E, 2, out);
          expect(got.dep).toBe(out);
          const peak = Math.max(...ref.dep);
          for (let i = 0; i < g.N; i++) expect(Math.abs(got.dep[i] - ref.dep[i])).toBeLessThanOrEqual(1e-12 * peak);
          expect(Math.abs(got.shine - ref.shine)).toBeLessThan(1e-14);
          // the beam power is either absorbed or shines through
          expect(volumeIntegral(g, got.dep) + got.shine).toBeCloseTo(1, 12);
          expect(volumeIntegral(g, ref.dep) + ref.shine).toBeCloseTo(1, 12);
        }
      }
    }
    expect(chords).toBe(3);
  }, 60000);

  it('shine-through falls with density and rises with beam energy', () => {
    const g = circularGeometry(3, 1, 3, 40);
    const chord = new NbiChord(g, 0.9 * g.R0);
    const shine = (n: number, E: number) => chord.deposit(new Float64Array(g.N).fill(n), E, 2, new Float64Array(g.N)).shine;
    expect(shine(1e17, 1000)).toBeGreaterThan(0.99);
    expect(shine(1e21, 110)).toBeLessThan(1e-6);
    expect(shine(5e19, 1000)).toBeGreaterThan(shine(5e19, 110));
    expect(shine(5e19, 110)).toBeGreaterThan(shine(1e20, 110));
  });
});

describe('beam-target reactivity: BeamTargetTable against the direct slowing-down integral', () => {
  // log E_c ∈ [5, 6000] keV, log T_i ∈ [0.05, 150] keV; the integral drops to zero where the beam
  // energy falls below 1.5 T_i (targets at rest), which the bilinear table smooths over: compare
  // where 1.5 T_i ≤ E0/2
  it.each([
    // 1 MeV negative-ion beams; the full and third energy of a 110 keV positive-ion beam
    ['DT', 1000], ['DT', 110], ['DT', 36.7], ['DD', 80], ['DD', 1000], ['DHe3', 1000],
  ] as [FuelType, number][])('%s, E0 = %s keV: within 2 %% of the integral over the table range', (fuel, E0) => {
    const tab = new BeamTargetTable(fuel, E0);
    const rng = new RNG(17);
    const out = [0, 0];
    let worst = 0, n = 0;
    for (let k = 0; k < 400; k++) {
      const Ec = 5 * Math.pow(6000 / 5, rng.next());
      const Ti = Math.min(0.05 * Math.pow(150 / 0.05, rng.next()), E0 / 3);
      const ref = beamTargetReactivity(fuel, E0, Ec, Ti);
      tab.eval(Ec, Ti, out);
      ref.forEach((v, c) => {
        expect(v).toBeGreaterThan(0);
        worst = Math.max(worst, Math.abs(out[c] / v - 1));
        n++;
      });
    }
    expect(n).toBeGreaterThanOrEqual(400);
    expect(worst).toBeLessThan(2e-2);
  });

  it('holds the edge values outside the table range', () => {
    const tab = new BeamTargetTable('DT', 1000);
    const a = [0], b = [0];
    expect(tab.eval(1, 10, a)[0]).toBe(tab.eval(5, 10, b)[0]);
    expect(tab.eval(1e5, 10, a)[0]).toBe(tab.eval(6000, 10, b)[0]);
    expect(tab.eval(100, 1e-3, a)[0]).toBe(tab.eval(100, 0.05, b)[0]);
    expect(tab.eval(100, 500, a)[0]).toBe(tab.eval(100, 150, b)[0]);
  });
});

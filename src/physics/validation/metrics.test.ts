import { describe, expect, it } from 'vitest';
import { DIIID, ITER, MASTU, NIF, W7X } from '../presets';
import { tauIPB98y2 } from '../transport';
import type { ShotReport } from '../types';
import { type RunOutputs, burnAverages, h98FromRun, readMetric, tauIPB98y2Ref } from './metrics';

const report = {
  Q_sci_max: 1.5, E_fusion_MJ: 3.1, neutronYield: 1e18, Tmax_keV: 7,
  engineering: { 'Gain G': 1.49, Technology: 'HDC', Ignited: true },
} as unknown as ShotReport;

describe('metric paths', () => {
  const run: RunOutputs = { report, flatTop: { Q: 9.5, Te: 1.2, Ti: 0.8 }, burn: { Ti: 3.2 }, cfg: NIF };

  it('reads flat-top averages, report scalars, engineering entries and burn averages', () => {
    expect(readMetric('flatTop.Q', run)).toBe(9.5);
    expect(readMetric('report.Q_sci_max', run)).toBe(1.5);
    expect(readMetric('report.neutronYield', run)).toBe(1e18);
    expect(readMetric('engineering.Gain G', run)).toBe(1.49);
    expect(readMetric('engineering.Ignited', run)).toBe(1);
    expect(readMetric('burn.Ti', run)).toBe(3.2);
    expect(readMetric('derived.Ttot', run)).toBeCloseTo(2.0, 12);
  });

  it('unavailable metrics read as NaN', () => {
    expect(readMetric('flatTop.nope', run)).toBeNaN();
    expect(readMetric('engineering.Technology', run)).toBeNaN();
    expect(readMetric('burn.Ti', { ...run, burn: undefined })).toBeNaN();
    expect(readMetric('derived.H98y2', run)).toBeNaN(); // not a tokamak
    expect(readMetric('derived.H98y2', { ...run, cfg: W7X })).toBeNaN(); // stellarator
    expect(readMetric('nope.x' as never, run)).toBeNaN();
  });
});

describe('IPB98(y,2) reference implementation', () => {
  it('matches a hand evaluation for DIII-D (1.6 MA, 2.2 T, 6e19, 15 MW, D)', () => {
    // 0.0562 · 1.6^0.93 · 2.2^0.15 · 6^0.41 · 15^−0.69 · 1.67^1.97 · 1.8^0.78 · (0.67/1.67)^0.58 · 2^0.19
    const tau = tauIPB98y2Ref({ Ip_MA: 1.6, B_T: 2.2, n19: 6, P_MW: 15, R_m: 1.67, a_m: 0.67, kappa: 1.8, M: 2 });
    expect(tau).toBeCloseTo(0.09194, 4);
  });

  it('agrees with the physics code implementation (transport.ts) to rounding', () => {
    for (const cfg of [ITER, DIIID, MASTU]) {
      const g = { ...cfg.geometry };
      const ref = tauIPB98y2Ref({ Ip_MA: cfg.Ip_MA, B_T: cfg.B0, n19: 8, P_MW: 20, R_m: g.R, a_m: g.a, kappa: g.kappa, M: 2.5 });
      const code = tauIPB98y2(g as never, cfg.Ip_MA, cfg.B0, 8e19, 20e6, 2.5);
      expect(ref / code).toBeCloseTo(1, 12);
    }
  });

  it('H98 of a run: τ_E over the scaling at the flat-top density and heating power; 1.5D uses n̄', () => {
    const tau = tauIPB98y2Ref({ Ip_MA: 15, B_T: 5.3, n19: 10, P_MW: 150, R_m: 6.2, a_m: 2.0, kappa: 1.7, M: 2.5 });
    const run: RunOutputs = { report, flatTop: { ne: 1.0, P_heat: 150, tauE: 2 * tau }, cfg: ITER };
    expect(h98FromRun(run)).toBeCloseTo(2, 12);
    expect(h98FromRun({ ...run, flatTop: { ...run.flatTop, ne: 0.5, nbar: 1.0 } })).toBeCloseTo(2, 12);
    // D-D uses M = 2
    const dd: RunOutputs = { report, flatTop: { ne: 0.6, P_heat: 15, tauE: 0.09194 }, cfg: DIIID };
    const diiid = tauIPB98y2Ref({ Ip_MA: DIIID.Ip_MA, B_T: DIIID.B0, n19: 6, P_MW: 15, R_m: 1.67, a_m: 0.67, kappa: 1.8, M: 2 });
    expect(h98FromRun(dd)).toBeCloseTo(0.09194 / diiid, 12);
  });
});

describe('burn-weighted averages', () => {
  const frame = (t: number, P_fus: number, Ti: number) => ({ t, d: { P_fus, Ti, Te: Ti / 2 } });

  it('weights by fusion power and frame duration', () => {
    // uniform frames: weights ∝ P_fus (half weight at the ends)
    const h = [frame(0, 0, 1), frame(1, 1, 2), frame(2, 3, 4), frame(3, 1, 2), frame(4, 0, 1)];
    const b = burnAverages(h);
    expect(b.Ti).toBeCloseTo((1 * 2 + 3 * 4 + 1 * 2) / 5, 12);
    expect(b.Te).toBeCloseTo(b.Ti / 2, 12);
    // a frame twice as long counts twice
    const u = burnAverages([frame(0, 1, 1), frame(1, 1, 1), frame(3, 1, 3), frame(5, 1, 3)], ['Ti']);
    expect(u.Ti).toBeCloseTo((0.5 * 1 + 1.5 * 1 + 2 * 3 + 1 * 3) / 5, 12);
  });

  it('NaN without fusion power or samples; non-finite samples are skipped', () => {
    expect(burnAverages([frame(0, 0, 1), frame(1, 0, 2)]).Ti).toBeNaN();
    expect(burnAverages([]).Ti).toBeNaN();
    expect(burnAverages([frame(0, 1, 1), frame(1, 1, 2)], ['missing']).missing).toBeNaN();
    expect(burnAverages([frame(0, 1, NaN), frame(1, 1, 2), frame(2, 1, 2)], ['Ti']).Ti).toBe(2);
  });
});

/**
 * Regression tests (lane ws2b, consistency pass): the shot report's T_max and the design score took
 * the maximum over the whole history, so a temperature overshoot during the density/heating ramp
 * (low density, full power) counted as the machine's performance. They now use the frames after
 * the start-up, t ≥ max(n_rampTime, heating.rampTime) (at most half the shot).
 */
import { describe, expect, it } from 'vitest';
import { buildMagneticReport } from '../confinement/magneticReport';
import { checkMagnet } from '../engineering';
import { plasmaVolume } from '../geometry';
import { ITER } from '../presets';
import { Simulation } from '../simulation';
import { HistoryFrame, MagneticConfig } from '../types';

function report(cfg: MagneticConfig, hist: HistoryFrame[]) {
  return buildMagneticReport({
    cfg, method: cfg.method, g: cfg.geometry, V: plasmaVolume(cfg.geometry),
    magnetInfo: checkMagnet(cfg.geometry, cfg.B0, cfg.magnet.tech, cfg.magnet.gap_m, cfg.magnet.coilThickness_m),
    terminated: null, tDisrupt: 0, isStell: false,
  }, hist, []);
}

/** synthetic history: flat 10 keV (axis 20 keV), with an overshoot to 40 keV at t = 5 s */
function history(tEnd: number, spikeAt: number): HistoryFrame[] {
  const h: HistoryFrame[] = [];
  for (let t = 0; t <= tEnd + 1e-9; t += 1) {
    const spike = Math.abs(t - spikeAt) < 1e-9;
    const d: Record<string, number> = {
      Ti0: spike ? 40 : 20, Ti: spike ? 20 : 10, Te: spike ? 22 : 11, Q: spike ? 30 : 5, P_fus: 100, triple: spike ? 1e22 : 1e21,
      P_alpha: 20, P_rad: 10, P_cond: 50, Efus_MJ: t * 100, Ein_MJ: t * 20, P_aux: 20, P_oh: 0, P_neutron: 80, q_div: 5, Nn: 0,
    };
    h.push({ t, y: [], d, internal: {} });
  }
  return h;
}

describe('start-up transient excluded from T_max and the score', () => {
  const cfg: MagneticConfig = { ...ITER, n_rampTime: 30, heating: { ...ITER.heating, rampTime: 10 }, t_end: 100 };

  it('an overshoot during the ramp does not set T_max or the score', () => {
    const r = report(cfg, history(100, 5));
    expect(r.Tmax_keV).toBe(20);
    expect(r.Timax_keV).toBe(10);
    expect(r.Temax_keV).toBe(11);
    const s = (label: string) => r.scoreBreakdown.find((e) => e.label.startsWith(label))!.value;
    expect(s('Temperature')).toBe(20);
    expect(s('Q_scientific')).toBe(5);
    expect(s('Triple')).toBe(1e21);
    // the same overshoot after the start-up counts
    expect(report(cfg, history(100, 60)).Tmax_keV).toBe(40);
  });

  it('a shot shorter than the ramp uses its second half', () => {
    const short: MagneticConfig = { ...cfg, t_end: 20 };
    expect(report(short, history(20, 5)).Tmax_keV).toBe(20);
    expect(report(short, history(20, 12)).Tmax_keV).toBe(40);
  });

  it('ITER: T_max is the maximum axis temperature after the 30 s density ramp', () => {
    const sim = new Simulation({ ...ITER, t_end: 120 });
    const r = sim.runAll();
    const after = sim.history.filter((f) => f.t >= ITER.n_rampTime).map((f) => f.d.Ti0);
    expect(r.Tmax_keV).toBe(Math.max(...after));
  });
});

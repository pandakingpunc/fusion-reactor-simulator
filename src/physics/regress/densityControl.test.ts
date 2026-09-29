/**
 * The 0D density controller in the model (lane ws2d; the command itself is tested in confinement/densityControl.test.ts).
 *
 * Before v4.0-ws2d the density limit was a knife edge in n_target: DIII-D at 0.97e20 survived, at 0.98e20 an NTM dipped the density by
 * 14 % and the recovery of the underdamped fuelling loop overshot the set-point by 4.5 % onto the Greenwald limit (disruption at 1.9 s),
 * and 1.05e20 survived by luck. n_target of the 0D model is the VOLUME average; the Greenwald fraction uses the line average
 * n̄ = f_line <n_e> (f_line = 1.110 at alpha_n = 0.3), so n_G = 1.1345e20 of DIII-D at 2 MA is reached by a set-point of 1.022e20.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { greenwaldDensity, lineAverageFactor } from '../limits';
import { DIIID, ITER } from '../presets';
import type { MagneticConfig } from '../types';

function run(cfg: MagneticConfig) {
  const sim = new Simulation(cfg);
  sim.runAll();
  const disruption = (sim.model.report(sim.history, sim.events) as { termination: { disruption?: { cause: string } } }).termination.disruption;
  let peak = 0;
  for (const f of sim.history) peak = Math.max(peak, (f.d as Record<string, number>).nG_frac);
  return { sim, cause: disruption?.cause, peakFrac: disruption ? Infinity : peak };
}

describe('the density limit in n_target (DIII-D, 2 MA)', { timeout: 60_000 }, () => {
  const nG = greenwaldDensity(DIIID.Ip_MA, DIIID.geometry.a);
  const fLine = lineAverageFactor(DIIID.transport.alpha_n);
  const at = (n1e20: number) => run({ ...DIIID, n_target: n1e20 * 1e20, t_end: 3 });

  it('set-points below n_G survive and stay within 3 % of their own line average', () => {
    for (const n of [0.9, 0.96, 1.0]) {
      const r = at(n);
      const set = (n * 1e20 * fLine) / nG;
      expect(r.cause, `n_target ${n}e20`).toBeUndefined();
      expect(r.peakFrac, `n_target ${n}e20 (n̄/n_G ${set.toFixed(3)})`).toBeLessThan(set * 1.03);
    }
  });

  it('set-points above n_G disrupt on the density limit, all of them: no survivor in the band above the limit', () => {
    for (const n of [1.04, 1.07, 1.1]) expect(at(n).cause, `n_target ${n}e20 (n̄/n_G ${((n * 1e20 * fLine) / nG).toFixed(3)})`).toBe('density_limit');
  });
});

describe('the density of the flat top', { timeout: 60_000 }, () => {
  it('ITER (0D): the volume-average density reaches n_target to 1 % (2 % below it before the feed-forward of the present losses) and the Greenwald fraction the 0.85 of the design', () => {
    const { sim } = run({ ...ITER, t_end: 45 });
    const tail = sim.history.filter((f) => f.t > 38).map((f) => f.d as Record<string, number>);
    const mean = (k: string) => tail.reduce((s, d) => s + d[k], 0) / tail.length;
    expect(Math.abs((mean('ne') * 1e20) / ITER.n_target - 1)).toBeLessThan(0.01);
    expect(Math.abs(mean('nG_frac') / 0.85 - 1)).toBeLessThan(0.015);
  });

  it('every fuelling method holds the target through a heated H-mode run: gas, pellets, beams and the mix (DIII-D, 3 s)', () => {
    for (const method of ['gas', 'pellet', 'nbi', 'mixed'] as const) {
      const cfg: MagneticConfig = { ...DIIID, fueling: { ...DIIID.fueling, method }, t_end: 3 };
      const { sim, cause } = run(cfg);
      expect(cause, method).toBeUndefined();
      const late = sim.history.filter((f) => f.t > 2).map((f) => (f.d as Record<string, number>).ne * 1e20 / cfg.n_target);
      const mean = late.reduce((s, x) => s + x, 0) / late.length;
      expect(Math.abs(mean - 1), method).toBeLessThan(0.015);
      expect(Math.max(...late), method).toBeLessThan(1.03);
    }
  });
});

/**
 * Regression test (lane ws2b, D2): heating.autoOff ("Ignition test: Q ≥ 5 → turn off heating" in the
 * wizard) was read nowhere. With it set, external heating must ramp off once Q ≥ 5, with an event.
 */
import { describe, expect, it } from 'vitest';
import { MagneticModel } from '../confinement/magnetic';
import { ITER } from '../presets';
import { Simulation } from '../simulation';
import { MagneticConfig, SimEvent } from '../types';

function runWithEventDiag(cfg: MagneticConfig) {
  const sim = new Simulation(cfg);
  const model = sim.model as MagneticModel;
  const orig = model.postStep.bind(model);
  const atIgnition: Record<string, number>[] = [];
  model.postStep = (t, dt, y) => {
    const ev = orig(t, dt, y);
    if (ev.some((e) => e.kind === 'ignition')) atIgnition.push(model.diagnostics(t, y));
    return ev;
  };
  const report = sim.runAll();
  return { sim, report, atIgnition };
}

describe('heating.autoOff (ignition test)', { timeout: 60_000 }, () => {
  const cfg: MagneticConfig = { ...ITER, heating: { ...ITER.heating, autoOff: true }, t_end: 150 };
  const { sim, report, atIgnition } = runWithEventDiag(cfg);

  it('logs an event when Q reaches 5 and ramps the external heating to zero', () => {
    const off = sim.events.filter((e: SimEvent) => e.kind === 'info' && /heating/i.test(e.msg));
    expect(off.length).toBe(1);
    const tOff = off[0].t;
    const qAt = sim.history.find((f) => f.t >= tOff)!.d.Q;
    expect(qAt).toBeGreaterThanOrEqual(5);
    // before: full power; after the ramp-off time (= heating.rampTime): nothing
    const before = sim.history.filter((f) => f.t > cfg.heating.rampTime && f.t < tOff);
    expect(before.length).toBeGreaterThan(0);
    for (const f of before) expect(f.d.P_aux).toBeCloseTo(cfg.heating.P_NBI_MW + cfg.heating.P_ICRH_MW + cfg.heating.P_ECRH_MW, 9);
    const after = sim.history.filter((f) => f.t > tOff + cfg.heating.rampTime);
    expect(after.length).toBeGreaterThan(0);
    for (const f of after) expect(f.d.P_aux).toBe(0);
    // no more auxiliary energy is injected: E_in grows by the ohmic energy only (until a disruption)
    const tEnd = sim.events.find((e) => e.kind === 'disruption')?.t ?? Infinity;
    const win = after.filter((f) => f.t < tEnd);
    expect(win.length).toBeGreaterThan(10);
    const dEin = win[win.length - 1].d.Ein_MJ - win[0].d.Ein_MJ;
    const ohmic = win.reduce((s, f, i) => (i ? s + 0.5 * (f.d.P_oh + win[i - 1].d.P_oh) * (f.t - win[i - 1].t) : s), 0);
    expect(ohmic).toBeGreaterThan(0);
    expect(Math.abs(dEin - ohmic)).toBeLessThan(0.05 * ohmic);
  });

  it('ITER at H98 = 1 cannot sustain itself once the heating is off: no ignition, it cools down', () => {
    expect(atIgnition).toEqual([]);
    expect(report.ignitionTime_s).toBe(0);
  });

  it('ITER at H98 = 1.4 ignites after the heating is off; IGNITION only when P_alpha ≥ P_rad + P_cond', () => {
    // (NTMs off: a sawtooth-seeded NTM would end the burn early; He ash ends it after ~1 min anyway)
    const r = runWithEventDiag({ ...cfg, H98: 1.4, events: { ...cfg.events, ntm: false } });
    expect(r.atIgnition.length).toBeGreaterThan(0);
    for (const d of r.atIgnition) expect(d.P_alpha).toBeGreaterThanOrEqual(d.P_rad + d.P_cond);
    expect(r.report.ignitionTime_s).toBeGreaterThan(20);
  });

  it('without autoOff nothing is switched off', () => {
    const m = new MagneticModel({ ...ITER, t_end: 30 });
    const s = new Simulation({ ...ITER, t_end: 30 });
    s.runAll();
    expect(s.events.some((e) => e.kind === 'info' && /heating/i.test(e.msg))).toBe(false);
    expect(m.getControls().P_NBI_MW).toBe(ITER.heating.P_NBI_MW);
  });
});

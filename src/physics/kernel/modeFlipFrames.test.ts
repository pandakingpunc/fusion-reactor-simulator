/**
 * Frames recorded at a flip of the confinement mode (L-H, H-L) or of the NTM flag.
 *
 * A flip changes no state variable, only the flags that the confinement time and the ELM share of the
 * loss power depend on. The 0D model's diagnostics() reads those flags live, but used to return the
 * cache of the step's last rhs() evaluation, which was made before the flip: the frame showed the
 * post-flip H_mode next to the pre-flip τ_E, P_cond and P_ELM (DIII-D 3 s, L-H at 0.11 s when the fix was
 * made: τ_E 0.1345 s against 0.1875 s from the frame's own state). MagneticModel.postStep now refreshes the
 * cache at a flip. The invariant tested here: a frame's diagnostics are those of a fresh evaluation from the
 * frame's own state and flags (SimModel.diagnostics contract).
 *
 * The tests locate the flips in the run's event list and assume no flip time and no event sequence: the
 * L-H time and the NTM history of a configuration belong to the model and move whenever the loss power, the
 * threshold scalings or the beta limits change. Where a test needs a kind of flip to occur, the run is steered
 * by the events it produces (a control patch once the NTM has started), not by literals.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import type { HistoryFrame, ReactorConfig, SimEvent } from '../types';
import { presetCfg } from './testkit';

const FLIPS = new Set(['LH', 'HL', 'NTM_onset', 'NTM_gone']);

/** Diagnostics of a fresh evaluation from the frame's own state and model flags (frame i of sim; later frames are dropped) */
function evaluateFromOwnState(sim: Simulation, i: number): Record<string, number> {
  const f = sim.history[i];
  sim.rewindTo(i);
  return sim.model.diagnostics(f.t, Float64Array.from(f.y));
}

function relDiff(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(1e-300, Math.abs(a), Math.abs(b));
}

/** The keys of frame diagnostics that differ from the re-evaluation by more than 1e-12 (relative), as `key: frame vs fresh` */
function inconsistentKeys(frame: Record<string, number>, fresh: Record<string, number>): string[] {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(frame), ...Object.keys(fresh)])) {
    const a = frame[k] ?? NaN, b = fresh[k] ?? NaN;
    if (Number.isNaN(a) && Number.isNaN(b)) continue;
    if (!(relDiff(a, b) <= 1e-12) && !(a === 0 && b === 0)) out.push(`${k}: ${a} vs ${b}`);
  }
  return out;
}

/** [event, index of the frame at the event's time] of every mode flip that has a frame at its own time */
function flipFrames(sim: Simulation): { ev: SimEvent; i: number }[] {
  const out: { ev: SimEvent; i: number }[] = [];
  for (const ev of sim.events) {
    if (!FLIPS.has(ev.kind)) continue;
    const i = sim.history.findIndex((f) => Math.abs(f.t - ev.t) < 1e-12);
    if (i >= 0) out.push({ ev, i });
  }
  return out;
}

function run(cfg: ReactorConfig, patchAt?: { t: number; patch: Record<string, number> }): Simulation {
  const sim = new Simulation(cfg);
  if (patchAt) {
    while (!sim.done && sim.t < patchAt.t - 1e-9) sim.advance(patchAt.t - sim.t); // (a step ends within 1e-12 of the target)
    sim.applyControl(patchAt.patch);
  }
  sim.runAll();
  return sim;
}

/**
 * JET at H98 = 1.4: a sawtooth crash seeds an NTM once the thermal beta_N is above 0.7 of its limit, and the NTM decays
 * below 0.5 of it. The run is stepped until the NTM has started and the auxiliary heating is then switched off, so that the
 * NTM decays (whatever the time of the onset) and the confinement mode flips back and forth on the way (H-L, L-H frames).
 */
function ntmCycleRun(): Simulation {
  const sim = new Simulation({ ...presetCfg('JET'), H98: 1.4 } as ReactorConfig);
  let heatingOff = false;
  while (!sim.done) {
    sim.advance(0.002);
    if (!heatingOff && sim.events.some((e) => e.kind === 'NTM_onset')) { sim.applyControl({ P_NBI_MW: 0, P_ICRH_MW: 0 }); heatingOff = true; }
  }
  expect(sim.events.some((e) => e.kind === 'NTM_onset'), 'JET at H98 = 1.4 seeds an NTM').toBe(true);
  expect(sim.events.some((e) => e.kind === 'NTM_gone'), 'the NTM decays once the heating is off').toBe(true);
  return sim;
}

/** Checks the frame of every flip event, and that each of the `required` kinds occurs (latest first: rewinding drops the later frames) */
function expectFlipFramesSelfConsistent(sim: Simulation, required: string[]): void {
  const flips = flipFrames(sim);
  // a flip is recorded by the step that ends at its own time, so every flip event has a frame
  expect(flips.length).toBe(sim.events.filter((e) => FLIPS.has(e.kind)).length);
  for (const k of required) expect(flips.some((x) => x.ev.kind === k), `the run has a ${k} flip`).toBe(true);
  const before = new Map<number, HistoryFrame>(flips.map((x) => [x.i, sim.history[x.i]]));
  const prev = new Map<number, HistoryFrame>(flips.map((x) => [x.i, sim.history[x.i - 1]]));
  for (const { ev, i } of [...flips].sort((a, b) => b.i - a.i)) {
    const fresh = evaluateFromOwnState(sim, i);
    expect(inconsistentKeys(before.get(i)!.d, fresh), `${ev.kind} at t = ${ev.t}`).toEqual([]);
    // the flip is visible in the frame: the mode flag and the confinement time that goes with it
    const f = before.get(i)!, p = prev.get(i)!;
    if (ev.kind === 'LH') { expect(f.d.H_mode).toBe(1); expect(p.d.H_mode).toBe(0); expect(f.d.tauE).toBeGreaterThan(p.d.tauE); }
    if (ev.kind === 'HL') { expect(f.d.H_mode).toBe(0); expect(p.d.H_mode).toBe(1); expect(f.d.tauE).toBeLessThan(p.d.tauE); }
    if (ev.kind === 'NTM_onset') { expect(f.d.NTM).toBe(1); expect(p.d.NTM).toBe(0); }
    if (ev.kind === 'NTM_gone') { expect(f.d.NTM).toBe(0); expect(p.d.NTM).toBe(1); }
  }
}

/** H_mode of every 0D frame is the mode after all L-H / H-L events up to and including its own time */
function expectModeFollowsEvents(sim: Simulation, strict: boolean): void {
  const flips = sim.events.filter((e) => e.kind === 'LH' || e.kind === 'HL');
  for (const f of sim.history) {
    let mode = 0;
    for (const e of flips) if (strict ? e.t < f.t - 1e-12 : e.t <= f.t + 1e-12) mode = e.kind === 'LH' ? 1 : 0;
    expect(f.d.H_mode, `frame at t = ${f.t}`).toBe(mode);
  }
}

describe('0D: a frame at a mode flip describes its own state (was: pre-flip diagnostics, live post-flip flags)', () => {
  it('DIII-D, 3 s: the L-H frame has the H-mode tau_E and ELM share', () => {
    const sim = run(presetCfg('DIIID', 3));
    const [flip] = flipFrames(sim);
    expect(flip.ev.kind).toBe('LH');
    const f = sim.history[flip.i], p = sim.history[flip.i - 1];
    // the ELM share of the loss power switches on together with H-mode (0.3 of W/tau_E)
    expect(p.d.P_ELM).toBe(0);
    expect(f.d.P_ELM).toBeCloseTo(0.3 * f.d.P_transport, 12);
    expect(f.d.P_cond + f.d.P_ELM).toBeCloseTo(f.d.P_transport, 12);
    expectFlipFramesSelfConsistent(sim, ['LH']);
  }, 120000);

  it('JET at n = 3e20 m^-3 (disrupts later): the L-H frame is self-consistent', () => {
    const sim = run({ ...presetCfg('JET'), n_target: 3e20 } as ReactorConfig);
    expectFlipFramesSelfConsistent(sim, ['LH']);
  }, 120000);

  it('ITER, 30 s: the L-H frame is self-consistent, and H_mode of every frame follows the events', () => {
    const sim = run(presetCfg('ITER', 30));
    expectFlipFramesSelfConsistent(sim, ['LH']);
  }, 120000);

  it('H-mode ends when the heating is switched off (live control patch): the H-L frame is self-consistent', () => {
    const sim = run(presetCfg('ITER', 30), { t: 20, patch: { P_NBI_MW: 0, P_ICRH_MW: 0 } });
    expect(sim.events.some((e) => e.kind === 'HL')).toBe(true);
    expectFlipFramesSelfConsistent(sim, ['LH', 'HL']);
  }, 120000);

  it('JET with H98 = 1.4: the NTM onset (seeded by a sawtooth) and its decay have self-consistent frames', () => {
    const sim = ntmCycleRun();
    expectFlipFramesSelfConsistent(sim, ['LH', 'NTM_onset', 'NTM_gone']);
  }, 120000);

  it('H_mode and NTM of every frame agree with the event list', () => {
    const sim = ntmCycleRun();
    expectModeFollowsEvents(sim, false);
    const ntm = sim.events.filter((e) => e.kind === 'NTM_onset' || e.kind === 'NTM_gone');
    expect(ntm.length).toBeGreaterThanOrEqual(2);
    for (const f of sim.history) {
      let on = 0;
      for (const e of ntm) if (e.t <= f.t + 1e-12) on = e.kind === 'NTM_onset' ? 1 : 0;
      expect(f.d.NTM, `frame at t = ${f.t}`).toBe(on);
    }
  }, 120000);
});

describe('1.5D: the frame of a flip step shows the step\'s own mode; the next frame shows the new one', () => {
  // ProfileModel frames carry the diagnostics that the step wrote with its own H_mode, so a flip (which changes no state and takes
  // effect with the next step) shows one frame later; nothing refreshes here (events/lh.ts).
  it('JET15, 1 s: the L-H flip', () => {
    const cfg = { ...presetCfg('JET15'), t_end: 1 } as ReactorConfig;
    const sim = run(cfg);
    const flips = flipFrames(sim).filter((x) => x.ev.kind === 'LH' || x.ev.kind === 'HL');
    expect(flips.some((x) => x.ev.kind === 'LH'), 'the run has an L-H transition').toBe(true);
    for (const { ev, i } of flips) {
      const before = ev.kind === 'LH' ? 0 : 1;
      expect(sim.history[i].d.H_mode, `${ev.kind} at t = ${ev.t}: the flip step's own frame`).toBe(before);
      expect(sim.history[i + 1].d.H_mode, `${ev.kind} at t = ${ev.t}: the next frame`).toBe(1 - before);
    }
    expectModeFollowsEvents(sim, true);
  }, 120000);
});

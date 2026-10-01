/**
 * The playback loop stops inside a step (host.ts, Simulation.advance `yieldWhen`): what the page sees of a run whose slices end
 * in the middle of 1.5D steps (with Grad-Shafranov updates), and what the requests it makes do to such a step.
 *
 * Wall time is fake: every reading of the clock costs 1 ms, so a slice of 3 ms ends at its third check, which is a yield of the
 * step in progress, and the scheduler is manual, so a message can be handled between two slices as a real worker does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Simulation } from '../physics/simulation';
import { PRESETS } from '../physics/presets';
import type { MagneticConfig } from '../physics/types';
import { createSimHost } from './host';
import { FromWorker, PROTOCOL_VERSION, UiFrame, toUiFrame } from './protocol';

const base = PRESETS.find((p) => p.id === 'ITER15')!.cfg as MagneticConfig;
/** a short shot with an equilibrium update every 0.08 s */
const cfg: MagneticConfig = { ...base, t_end: 0.3, profiles: { ...base.profiles, eqUpdateInterval: 0.08 } };
const SPEED = 1000;

afterEach(() => { vi.restoreAllMocks(); });

let refFrames: UiFrame[] | null = null;
/** the frames of the uninterrupted run, as the page gets them */
function reference(): UiFrame[] {
  if (!refFrames) { const s = new Simulation(cfg); s.runAll(); refFrames = s.history.map(toUiFrame); }
  return refFrames;
}

function rig() {
  let clock = 0;
  let sim: Simulation | null = null;
  const real = Simulation.prototype.advance;
  vi.spyOn(Simulation.prototype, 'advance').mockImplementation(function (this: Simulation, ...a: Parameters<Simulation['advance']>) {
    sim = this;
    return real.apply(this, a);
  });
  const queue: { fn: () => void; cancelled: boolean }[] = [];
  const out: FromWorker[] = [];
  /** the frames as the page keeps them: the first one from `ready`, then what `frames` messages bring, cut back by `rewound` */
  const page: UiFrame[] = [];
  let done = false;
  const host = createSimHost((m) => {
    out.push(m);
    if (m.type === 'ready') page.push(m.frame);
    else if (m.type === 'frames') page.push(...m.frames);
    else if (m.type === 'rewound') page.length = m.index + 1;
    else if (m.type === 'done') done = true;
  }, {
    sliceMs: 3,
    now: () => (clock += 1),
    schedule: (fn) => { const e = { fn, cancelled: false }; queue.push(e); return () => { e.cancelled = true; }; },
  });
  const r = {
    host, out, page,
    sim: () => sim!,
    get done() { return done; },
    /** runs the next scheduled slice after an idle tick; false when nothing is scheduled */
    tick(): boolean {
      while (queue.length) {
        const e = queue.shift()!;
        if (e.cancelled) continue;
        clock += 33;
        e.fn();
        return true;
      }
      return false;
    },
    /** slices until `until()` holds (checked after each) or the shot is done */
    run(until: () => boolean = () => false): void {
      let guard = 0;
      while (!done && guard++ < 100000 && r.tick()) if (until()) return;
    },
    /** slices until one has ended inside a step, after t = 0.1 s */
    runToSuspended(): void {
      r.run(() => sim!.stepInProgress && sim!.t > 0.1);
      expect(sim!.stepInProgress, 'the shot ended before a slice stopped inside a step').toBe(true);
    },
    init() { host.handle({ type: 'init', protocolVersion: PROTOCOL_VERSION, id: 3, cfg, autoPlay: true, speed: SPEED }); },
  };
  return r;
}

describe('a run played in slices that end inside steps', () => {
  it('gives the page the frames of the uninterrupted run, and many slices did end inside a step', () => {
    const r = rig();
    r.init();
    let suspendedSlices = 0, slices = 0;
    r.run(() => { slices++; if (r.sim().stepInProgress) suspendedSlices++; return false; });
    expect(r.done).toBe(true);
    expect(suspendedSlices).toBeGreaterThan(0.5 * slices);
    expect(r.page).toEqual(reference());
    expect(r.out.filter((m) => m.type === 'done')).toHaveLength(1);
  }, 120000);

  it('a control that arrives while a step is suspended settles it first and posts what it completed: page and run stay the same, and the log replays the run', () => {
    const r = rig();
    r.init();
    r.runToSuspended();
    const sim = r.sim(), steps = sim.nSteps, posted = r.out.length;
    r.host.handle({ type: 'control', patch: { P_NBI_MW: 20 } });
    expect(sim.stepInProgress).toBe(false);
    expect(sim.nSteps).toBe(steps + 1);
    expect(sim.actuatorLog).toEqual([{ t: sim.t, step: steps + 1, patch: { P_NBI_MW: 20 } }]);
    const msgs = r.out.slice(posted);
    expect(msgs.filter((m) => m.type === 'frames')).toHaveLength(1); // the settled step is posted at once
    expect(r.page).toHaveLength(sim.history.length);
    r.run();
    expect(r.done).toBe(true);
    expect(r.page).toEqual(sim.history.map(toUiFrame));
    expect(r.page).not.toEqual(reference()); // the control changed the run
    expect(r.page).toEqual(Simulation.replay(cfg, sim.actuatorLog).history.map(toUiFrame));
  }, 120000);

  it('a rewind while a step is suspended drops the step; the branch that follows is the uninterrupted run', () => {
    const r = rig();
    r.init();
    r.runToSuspended();
    const sim = r.sim(), n = sim.history.length;
    r.host.handle({ type: 'rewind', index: n - 3, branchId: 1 });
    expect(sim.stepInProgress).toBe(false);
    expect(sim.history).toHaveLength(n - 2);
    expect(r.out.some((m) => m.type === 'rewound' && m.index === n - 3)).toBe(true);
    expect(r.page).toHaveLength(n - 2);
    r.host.handle({ type: 'play', speed: SPEED });
    r.run();
    expect(r.done).toBe(true);
    expect(r.page).toEqual(reference());
  }, 120000);

  it('a pause leaves the suspended step suspended and posts nothing more; play and step go on with it, and the run is the uninterrupted one', () => {
    const r = rig();
    r.init();
    r.runToSuspended();
    const sim = r.sim();
    r.host.handle({ type: 'pause' });
    expect(sim.stepInProgress).toBe(true);
    const posted = r.out.length, t = sim.t, frames = sim.history.length;
    expect(r.tick()).toBe(false); // no slice is scheduled any more
    expect(r.out).toHaveLength(posted);
    expect(sim.t).toBe(t);
    expect(sim.history).toHaveLength(frames);
    expect(r.page).toHaveLength(frames);
    r.host.handle({ type: 'step', simDt: 0.001 }); // an explicit step continues the suspended one to its end, unsliced
    expect(sim.stepInProgress).toBe(false);
    expect(sim.t).toBeGreaterThan(t);
    expect(r.page).toHaveLength(sim.history.length);
    r.host.handle({ type: 'play', speed: SPEED });
    r.run();
    expect(r.done).toBe(true);
    expect(r.page).toEqual(reference());
  }, 120000);
});

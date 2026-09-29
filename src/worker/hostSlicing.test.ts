import { afterEach, describe, expect, it, vi } from 'vitest';
import { Simulation } from '../physics/simulation';
import { ITER, MIRROR, NIF, TAE } from '../physics/presets';
import { ReactorConfig } from '../physics/types';
import { SLICE_MS, SimHostOptions, createSimHost, defaultSchedule } from './host';
import { FromWorker, PROTOCOL_VERSION, toUiFrame } from './protocol';

/**
 * Time slicing of the playback loop (host.ts). Wall time is fake: every kernel call costs the milliseconds the
 * test says, so the number of steps per slice is exact, and the scheduler is manual, so a message from the page
 * can be handled between two slices exactly as a real worker would.
 */
function rig(cost: number | ((call: number) => number), opts: SimHostOptions = {}) {
  const clock = { t: 1000 };
  let calls = 0;
  const real = Simulation.prototype.advance;
  const spy = vi.spyOn(Simulation.prototype, 'advance').mockImplementation(function (this: Simulation, dt: number) {
    const r = real.call(this, dt);
    clock.t += typeof cost === 'number' ? cost : cost(calls);
    calls++;
    return r;
  });
  const queue: { fn: () => void; delay: number; cancelled: boolean }[] = [];
  const out: FromWorker[] = [];
  const host = createSimHost((m) => out.push(m), {
    now: () => clock.t,
    schedule: (fn, delay) => { const e = { fn, delay, cancelled: false }; queue.push(e); return () => { e.cancelled = true; }; },
    ...opts,
  });
  return {
    host, out, clock, spy,
    get calls() { return calls; },
    /** the next scheduled tick, if it is still live */
    live: () => queue.filter((e) => !e.cancelled),
    /** run the next scheduled tick after `wall` ms of idle time; false when nothing is scheduled */
    tick(wall = 0): boolean {
      while (queue.length) {
        const e = queue.shift()!;
        if (e.cancelled) continue;
        clock.t += wall;
        e.fn();
        return true;
      }
      return false;
    },
    init(cfg: ReactorConfig, speed: number, id = 3) {
      host.handle({ type: 'init', protocolVersion: PROTOCOL_VERSION, id, cfg, autoPlay: true, speed });
    },
    take() { return out.splice(0, out.length); },
  };
}
const ofType = <K extends FromWorker['type']>(ms: FromWorker[], type: K) => ms.filter((m): m is Extract<FromWorker, { type: K }> => m.type === type);

afterEach(() => { vi.restoreAllMocks(); });

describe('time-sliced playback', () => {
  it('yields once the slice budget is used, not once the owed simulated time is done', () => {
    const r = rig(1, { sliceMs: 5 });
    r.init(ITER, 1e6); // owes the 5 % cap at every tick: hundreds of steps
    r.take();
    expect(r.live()).toHaveLength(1);
    const before = r.calls;
    r.tick(33);
    expect(r.calls - before).toBe(5); // 1 ms per kernel call, 5 ms budget
    expect(r.live()).toHaveLength(1); // more is owed: the next slice is scheduled at once ...
    expect(r.live()[0].delay).toBe(0); // ... behind whatever messages are queued
  });

  it('a step already started always finishes: a slow step ends its slice, and every slice takes at least one step', () => {
    const r = rig((i) => (i % 4 === 3 ? 50 : 0.2), { sliceMs: 5 }); // every 4th call is a 50 ms step
    r.init(ITER, 1e6);
    r.take();
    for (let k = 0; k < 6; k++) {
      const before = r.calls;
      r.tick(33);
      const n = r.calls - before;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(4); // a heavy step closes the slice (it never chains two heavy steps)
    }
    const r0 = rig(1, { sliceMs: 0 });
    r0.init(ITER, 1e6);
    const before = r0.calls;
    r0.tick(33);
    expect(r0.calls - before).toBe(1);
  });

  it('the longest task is one slice plus the step in progress: that is what a pause request waits for', () => {
    // steps cost 0.4 ms, except every 7th (a Grad-Shafranov update in the 1.5D model) at 45 ms
    const r = rig((i) => (i % 7 === 6 ? 45 : 0.4));
    r.init(ITER, 1e6);
    r.take();
    let longest = 0, ticks = 0;
    for (; ticks < 100; ticks++) {
      const idle = ticks === 0 ? 33 : 0; // the first tick lets 33 ms of wall time pass, so simulated time is owed
      const before = r.clock.t + idle;
      if (!r.tick(idle)) break;
      longest = Math.max(longest, r.clock.t - before);
    }
    expect(ticks).toBe(100);
    expect(longest).toBeGreaterThan(45 - 1e-9); // the heavy step is not split (it is one kernel step) ...
    expect(longest).toBeLessThan(SLICE_MS + 45); // ... and nothing but it and the light steps before it in the slice is in the task
  });

  it('a pause handled between two slices stops the loop and posts the frames computed so far, once', () => {
    const r = rig(1, { sliceMs: 5 });
    r.init(ITER, 1e6);
    r.tick(33);
    r.tick(0);
    r.tick(0);
    const received = ofType(r.take(), 'frames').flatMap((m) => m.frames).length + 1; // + the ready frame
    const calls = r.calls;
    r.host.handle({ type: 'pause' });
    expect(r.live()).toHaveLength(0); // the scheduled slice was cancelled
    const flushed = r.take();
    expect(flushed.map((m) => m.type)).toEqual(['frames']); // what the held-back slices computed reaches the page ...
    expect(r.tick(33)).toBe(false); // ... and nothing more is computed
    expect(r.calls).toBe(calls);
    expect(r.take()).toEqual([]);
    // the page now has the worker's whole history: rewinding to "the last frame" lands on the last frame the page has
    const total = received + (flushed[0] as Extract<FromWorker, { type: 'frames' }>).frames.length;
    r.host.handle({ type: 'rewind', index: 1e9, branchId: 1 });
    expect(r.take()[0]).toMatchObject({ type: 'rewound', index: total - 1 });
    // a later play picks up where it stopped
    r.host.handle({ type: 'play', speed: 1e6 });
    expect(r.live()).toHaveLength(1);
    r.tick(33);
    expect(r.calls).toBeGreaterThan(calls);
  });

  it('a control change handled between slices applies at the next step and is echoed in the frames', () => {
    const r = rig(1, { sliceMs: 5 });
    r.init(ITER, 1e6);
    r.tick(33);
    r.take();
    r.host.handle({ type: 'control', patch: { P_NBI_MW: 12.5 } });
    r.tick(33);
    const posted = ofType(r.take(), 'frames');
    expect(posted.length).toBeGreaterThan(0);
    expect(posted[posted.length - 1].controls.P_NBI_MW).toBe(12.5);
  });

  it('a rewind handled between slices abandons the owed time, the scheduled slice and the frames not yet posted', () => {
    const r = rig(1, { sliceMs: 5 });
    r.init(ITER, 1e6);
    for (let k = 0; k < 5; k++) r.tick(k === 0 ? 33 : 0);
    r.take();
    r.host.handle({ type: 'rewind', index: 0, branchId: 1 });
    expect(r.live()).toHaveLength(0);
    const ms = r.take();
    expect(ms.map((m) => m.type)).toEqual(['rewound']); // no frame of the abandoned branch follows
    expect(ms[0]).toMatchObject({ type: 'rewound', index: 0, branchId: 1 });
    r.host.handle({ type: 'play', speed: 1e6 });
    r.tick(33);
    r.tick(33);
    const after = ofType(r.take(), 'frames');
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((m) => m.branchId === 1)).toBe(true);
  });

  it('a busy loop posts about one message per tick, not one per slice, and loses no frame', () => {
    const r = rig(1, { sliceMs: 5 });
    r.init(ITER, 1e6);
    r.take();
    r.tick(33);
    let slices = 1;
    for (let k = 0; k < 60; k++, slices++) r.tick(0); // 60 slices of 5 ms
    const ms = ofType(r.take(), 'frames');
    const spanMs = slices * 5;
    expect(ms.length).toBeLessThanOrEqual(Math.ceil(spanMs / 33) + 1);
    expect(ms.length).toBeGreaterThan(1);
    // frames arrive in order and without gaps: the last message's history is contiguous in time
    const ts = ms.flatMap((m) => m.frames.map((f) => f.t));
    expect(ts.every((t, i) => i === 0 || t > ts[i - 1])).toBe(true);
    // the message's t and wallMs describe the whole batch
    expect(ms.every((m) => m.wallMs > 0)).toBe(true);
  });

  it('the explicit step message is one unsliced kernel call', () => {
    const r = rig(1, { sliceMs: 5 });
    r.host.handle({ type: 'init', protocolVersion: PROTOCOL_VERSION, id: 1, cfg: ITER });
    r.take();
    const before = r.calls;
    r.host.handle({ type: 'step', simDt: 30 });
    expect(r.calls - before).toBe(1);
    const [f] = ofType(r.take(), 'frames');
    expect(f.t).toBeGreaterThanOrEqual(30);
  });

  it('the default budget is a few milliseconds', () => {
    expect(SLICE_MS).toBeGreaterThan(0);
    expect(SLICE_MS).toBeLessThanOrEqual(10);
  });
});

describe('a sliced run is the uninterrupted run', () => {
  // The kernel is chunk invariant; slicing must not lose, duplicate or reorder a frame or event, and the report must match.
  for (const [name, cfg] of [['TAE (FRC, s)', TAE], ['MIRROR (s)', MIRROR], ['NIF (ns)', NIF]] as const) {
    it(`${name}: same frames, events and report as Simulation.runAll`, () => {
      const r = rig(1, { sliceMs: 5 });
      r.init(cfg, 1e9);
      let guard = 0;
      while (r.live().length && guard++ < 100000) r.tick(33);
      const ms = r.take();
      const ref = new Simulation(cfg);
      const report = ref.runAll();
      const frames = ofType(ms, 'frames').flatMap((m) => m.frames);
      // the first history frame is the `ready` message's, the rest come in `frames`
      const ready = ofType(ms, 'ready')[0];
      expect([ready.frame, ...frames]).toEqual(ref.history.map(toUiFrame));
      expect(ofType(ms, 'frames').flatMap((m) => m.events)).toEqual(ref.events);
      expect(ofType(ms, 'done')).toHaveLength(1);
      expect(ofType(ms, 'done')[0].report).toEqual(report);
      expect(ofType(ms, 'frames').at(-1)?.done).toBe(true);
      expect(guard).toBeLessThan(100000);
    });
  }
});

describe('defaultSchedule', () => {
  it('runs a zero-delay task later, in order, and a cancelled one never', async () => {
    const order: string[] = [];
    defaultSchedule(() => order.push('a'), 0);
    const cancel = defaultSchedule(() => order.push('b'), 0);
    defaultSchedule(() => order.push('c'), 0);
    cancel();
    expect(order).toEqual([]);
    await new Promise((res) => setTimeout(res, 20));
    expect(order).toEqual(['a', 'c']);
  });

  it('a positive delay is a timer that can be cancelled', () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const cancel = defaultSchedule(fn, 33);
      vi.advanceTimersByTime(20);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(20);
      expect(fn).toHaveBeenCalledTimes(1);
      const fn2 = vi.fn();
      defaultSchedule(fn2, 33)();
      vi.advanceTimersByTime(100);
      expect(fn2).not.toHaveBeenCalled();
      cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the real host plays and pauses with the default scheduler and clock', async () => {
    const out: FromWorker[] = [];
    const host = createSimHost((m) => out.push(m));
    host.handle({ type: 'init', protocolVersion: PROTOCOL_VERSION, id: 1, cfg: MIRROR, autoPlay: true, speed: 100 });
    await new Promise((res) => setTimeout(res, 150));
    host.handle({ type: 'pause' });
    const n = out.length;
    expect(ofType(out, 'frames').length).toBeGreaterThan(0);
    await new Promise((res) => setTimeout(res, 100));
    expect(out.length).toBe(n); // nothing after the pause
    host.dispose();
  });
});

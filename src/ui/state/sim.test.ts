import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIRROR, TAE } from '../../physics/presets';
import { FakeWorker, fakeWorkerFactory, manualScheduler } from '../../worker/fakeWorker';
import { FromWorker, PROTOCOL_VERSION } from '../../worker/protocol';
import { SimController, completedShotKey, initialSimState, reduceSim, scheduleFrame } from './sim';

/** controller wired to fake workers and a hand-cranked frame scheduler */
function setup() {
  const factory = fakeWorkerFactory();
  const sched = manualScheduler();
  const ctrl = new SimController(factory.create, sched.schedule);
  ctrl.attach();
  const w = factory.workers[0];
  let renders = 0;
  ctrl.store.subscribe(() => { renders++; });
  const tick = () => sched.run();
  /** worker handles everything posted so far and its replies reach the page (not yet applied) */
  const roundTrip = () => { w.process(); w.deliver(); };
  return { ctrl, w, factory, sched, tick, roundTrip, renders: () => renders, s: () => ctrl.store.getState() };
}

function loaded(autoPlay = false) {
  const h = setup();
  h.ctrl.load(TAE, autoPlay);
  h.roundTrip();
  h.tick();
  return h;
}

describe('SimController', () => {
  it('loads through a versioned init and starts playing on ready when autoPlay is set', () => {
    const h = setup();
    h.ctrl.load(TAE, true);
    expect(h.s()).toMatchObject({ status: 'loading', runId: 1, autoPlay: true });
    expect(h.w.last('init')).toMatchObject({ protocolVersion: PROTOCOL_VERSION, id: 1, autoPlay: true, speed: 1 });
    h.roundTrip();
    expect(h.s().status).toBe('loading'); // nothing is applied before the frame flush
    h.tick();
    expect(h.s().status).toBe('running');
    expect(h.s().meta?.controls).toEqual({ P_NBI_MW: 13, kappa_conf: 10 });
    expect(h.s().frames).toHaveLength(1);
  });

  it('applies a burst of worker messages in a single store update per frame', () => {
    const h = loaded();
    const before = h.renders();
    for (let i = 0; i < 5; i++) h.w.advance(TAE.t_end / 50);
    h.w.deliver();
    expect(h.sched.pending()).toBe(1);
    expect(h.renders()).toBe(before);
    h.tick();
    expect(h.renders()).toBe(before + 1);
    expect(h.s().t).toBeCloseTo(TAE.t_end / 10, 12);
    expect(h.s().frames.length).toBeGreaterThan(5);
  });

  it('drops frames of a branch abandoned by a rewind, then follows the new branch', () => {
    const h = loaded();
    h.w.advance(TAE.t_end / 5);
    h.w.deliver();
    h.tick();
    const n = h.s().frames.length;

    // frames produced before the worker sees the rewind are still in flight …
    h.w.advance(TAE.t_end / 5);
    h.ctrl.rewind(3);
    expect(h.s().branchId).toBe(1);
    expect(h.w.last('rewind')).toEqual({ type: 'rewind', index: 3, branchId: 1 });
    h.w.deliver(); // … and arrive after the page switched branch
    h.tick();
    expect(h.s().frames).toHaveLength(n);

    h.roundTrip(); // the worker rewinds
    h.tick();
    expect(h.s()).toMatchObject({ status: 'paused', branchId: 1 });
    expect(h.s().frames).toHaveLength(4);

    h.w.advance(TAE.t_end / 5);
    h.w.deliver();
    h.tick();
    expect(h.s().frames.length).toBeGreaterThan(4);
    expect(h.s().frames[3].t).toBeLessThan(h.s().frames[4].t);
  });

  it('ignores messages of a previous run after a restart', () => {
    const h = loaded();
    h.w.advance(TAE.t_end / 5);
    const stale = h.w.outbox.slice();
    h.ctrl.restart();
    expect(h.s()).toMatchObject({ status: 'loading', runId: 2, frames: [] });
    for (const m of stale) h.w.emit(m);
    h.w.outbox.length = 0;
    h.tick();
    expect(h.s()).toMatchObject({ status: 'loading', frames: [] });
    h.roundTrip();
    h.tick();
    expect(h.s()).toMatchObject({ status: 'ready', runId: 2 });
    expect(h.s().frames).toHaveLength(1);
  });

  it('reports a mid-run error of the current branch but not one from an abandoned branch', () => {
    const h = loaded();
    h.ctrl.play();
    h.w.emit({ type: 'error', id: 1, branchId: 0, msg: 'old branch failed' });
    h.ctrl.rewind(0);
    h.tick();
    expect(h.s().status).toBe('running');
    h.w.emit({ type: 'error', id: 1, branchId: 1, msg: 'NaN in the state vector' });
    h.tick();
    expect(h.s()).toMatchObject({ status: 'error', error: 'NaN in the state vector' });
    h.w.crash('worker script died');
    h.tick();
    expect(h.s().error).toBe('worker script died');
  });

  it('shows why the worker refused a configuration, before any frame', () => {
    const h = setup();
    h.ctrl.load({ ...TAE, t_end: undefined as unknown as number }, true);
    h.roundTrip();
    h.tick();
    expect(h.s()).toMatchObject({ status: 'error', meta: null, frames: [] });
    expect(h.s().error).toMatch(/^Invalid shot duration/);
  });

  it('refuses a worker that speaks another protocol version', () => {
    const h = setup();
    h.ctrl.load(TAE);
    h.w.process();
    const ready = h.w.outbox.find((m) => m.type === 'ready') as Extract<FromWorker, { type: 'ready' }>;
    h.w.emit({ ...ready, protocolVersion: 1 });
    h.tick();
    expect(h.s().status).toBe('error');
    expect(h.s().error).toMatch(/protocol mismatch/i);
  });

  it('keeps setState updaters pure: commands post exactly one message each', () => {
    const h = loaded();
    const posted = () => h.w.sent.length;
    const n0 = posted();
    h.ctrl.play();
    h.ctrl.play(); // already running: no second play
    h.ctrl.pause();
    h.ctrl.setSpeed(5);
    h.ctrl.control({ kappa_conf: 20 });
    expect(h.w.sent.slice(n0).map((m) => m.type)).toEqual(['play', 'pause', 'setSpeed', 'control']);
    expect(h.s()).toMatchObject({ status: 'paused', speed: 5, controls: { kappa_conf: 20 } });
    h.ctrl.restart();
    expect(h.w.last('init')).toMatchObject({ id: 2, speed: 5, autoPlay: false });
  });

  it('counts the live interventions of a run, and a new run starts at none', () => {
    const h = loaded();
    expect(h.s().interventions).toBe(0);
    h.ctrl.control({ kappa_conf: 20 });
    h.ctrl.control({ P_NBI_MW: 5 });
    expect(h.s().interventions).toBe(2);
    h.ctrl.rewind(0);
    expect(h.s().interventions).toBe(2); // a rewind does not forget them: the count is what the run may have been given
    h.ctrl.restart();
    expect(h.s().interventions).toBe(0);
  });

  it('runs background full runs in their own worker with progress', async () => {
    const h = setup();
    const progress: number[] = [];
    const p = h.ctrl.runAll(MIRROR, false, (x) => progress.push(x.t / x.tEnd));
    const bg = h.factory.workers[1] as FakeWorker;
    expect(bg).toBeDefined();
    expect(h.w.sent).toHaveLength(0); // the live worker is untouched
    bg.process();
    bg.deliver();
    const res = await p;
    expect(res.report.method).toBe('mirror');
    expect(progress.length).toBeGreaterThan(0);
    expect(bg.terminated).toBe(true);
  });
});

describe('completedShotKey', () => {
  it('names each completed branch once and nothing before completion', () => {
    let s = { ...initialSimState, runId: 4 };
    expect(completedShotKey(s)).toBeNull();
    s = { ...s, status: 'done', cfg: TAE, meta: {} as never, report: {} as never };
    expect(completedShotKey(s)).toBe('4:0');
    expect(completedShotKey({ ...s, branchId: 2 })).toBe('4:2');
    expect(completedShotKey({ ...s, report: null })).toBeNull();
  });

  it('a rewind from a completed run clears the report, so the old completion gets no new key', () => {
    const h = loaded();
    h.w.advance(TAE.t_end);
    h.w.deliver();
    h.tick();
    expect(completedShotKey(h.s())).toBe('1:0');
    h.ctrl.rewind(0);
    expect(h.s().report).toBeNull();
    expect(completedShotKey(h.s())).toBeNull();
    h.roundTrip();
    h.tick();
    h.w.advance(TAE.t_end);
    h.w.deliver();
    h.tick();
    expect(completedShotKey(h.s())).toBe('1:1');
  });

  it('rewinding a finished run to its final frame keeps its branch and its report', () => {
    const h = loaded();
    h.w.advance(TAE.t_end);
    h.w.deliver();
    h.tick();
    const done = h.s();
    const sent = h.w.sent.length;
    h.ctrl.rewind(done.frames.length - 1); // scrubber released at the end
    h.ctrl.rewind(done.frames.length + 10); // chart clicked past the last frame
    expect(h.w.sent.length).toBe(sent);
    expect(h.s()).toBe(done);
    expect(completedShotKey(h.s())).toBe('1:0');
    h.ctrl.rewind(done.frames.length - 2); // one frame earlier is a real rewind
    expect(h.w.last('rewind')).toEqual({ type: 'rewind', index: done.frames.length - 2, branchId: 1 });
  });

  it('a stale done from an abandoned branch cannot complete the new branch', () => {
    const s = { ...initialSimState, status: 'paused' as const, runId: 1, branchId: 1, cfg: TAE, meta: {} as never };
    const after = reduceSim(s, { type: 'done', id: 1, branchId: 0, report: {} as never });
    expect(after).toBe(s);
  });
});

describe('scheduleFrame', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('flushes once, on the animation frame when there is one', () => {
    vi.useFakeTimers();
    const frames: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { frames.push(cb); return frames.length; });
    const flush = vi.fn();
    scheduleFrame(flush);
    expect(flush).not.toHaveBeenCalled();
    frames.forEach((f) => f());
    vi.advanceTimersByTime(1000);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('still flushes within 100 ms when animation frames are throttled or absent', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', () => 0); // a frame that never comes (occluded window)
    const flush = vi.fn();
    scheduleFrame(flush);
    vi.advanceTimersByTime(99);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});

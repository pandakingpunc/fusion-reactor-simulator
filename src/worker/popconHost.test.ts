import { describe, expect, it, vi } from 'vitest';
import { PopconGrid, computePopcon } from '../physics/popcon';
import { DEMO, ITER, MASTU, PRESETS, SPARC, W7X } from '../physics/presets';
import { Simulation } from '../physics/simulation';
import { MagneticConfig } from '../physics/types';
import { FakePopconWorker } from './fakePopconWorker';
import { createPopconHost, deviceTmax, fuelOptimumT, gridBuffers, popconAxes, uniformTemperature } from './popconHost';
import { DEFAULT_POPCON_STAGES, FromPopcon, POPCON_FINE_SIZE, POPCON_IDLE_MS, POPCON_PREVIEW_SIZE } from './popconProtocol';

const grids = (ms: FromPopcon[]) => ms.filter((m): m is Extract<FromPopcon, { type: 'grid' }> => m.type === 'grid');
/** a model that costs nothing: a grid of the requested size with zero fields */
const stub = (_cfg: MagneticConfig, o: NonNullable<Parameters<typeof computePopcon>[1]> = {}): PopconGrid => {
  const nx = o.nx ?? 44, ny = o.ny ?? 44, N = nx * ny;
  return {
    n: Array.from({ length: nx }, (_, i) => (i + 0.5) * 1e19), T: Array.from({ length: ny }, (_, j) => (j + 0.5) * ((o.Tmax ?? 40) / ny)), nx, ny,
    Paux: new Float64Array(N), Pfus: new Float64Array(N), Q: new Float64Array(N), betaN: new Float64Array(N), PLH_ok: new Uint8Array(N), fHe: new Float64Array(N), nG: 1e20,
  };
};
const withH = (cfg: MagneticConfig, H98: number): MagneticConfig => ({ ...cfg, H98 });

describe('fuelOptimumT', () => {
  it('is the temperature of the best power density per (nT)²: about 14 keV for D-T, a few times more for the others', () => {
    // literature: the ignition optimum of D-T ⟨σv⟩/T² is 13-14 keV (Wesson, Tokamaks, sect. 1.4); p-11B needs a few hundred keV
    expect(fuelOptimumT('DT')).toBeGreaterThan(11);
    expect(fuelOptimumT('DT')).toBeLessThan(17);
    expect(fuelOptimumT('DD')).toBeGreaterThan(fuelOptimumT('DT'));
    expect(fuelOptimumT('DHe3')).toBeGreaterThan(fuelOptimumT('DD'));
    expect(fuelOptimumT('pB11')).toBeGreaterThan(100);
    expect(fuelOptimumT('DT')).toBe(fuelOptimumT('DT')); // cached
  });
});

describe('deviceTmax: the T axis follows the device', () => {
  const LADDER = [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200, 300];
  /** a rung of the ladder, or below the first rung a multiple of 0.25 keV */
  const onScale = (T: number) => LADDER.includes(T) || (T < 3 && T >= 0.25 && Number.isInteger(T / 0.25));
  const presets = { ITER, SPARC, DEMO, MASTU, W7X } as const;

  it('is a rung of the ladder from 3 to 300 keV (a multiple of 0.25 keV below it) for every magnetic preset', () => {
    for (const [name, cfg] of Object.entries(presets)) {
      const T = deviceTmax(cfg);
      expect(onScale(T), `${name}: ${T}`).toBe(true);
    }
  });

  it('W-7X and MAST-U, whose heating alone holds under a keV, get a short axis on fine steps (they had 2.5 keV, a third of it used)', () => {
    expect(deviceTmax(W7X)).toBe(1.75);
    expect(deviceTmax(MASTU)).toBe(1.75); // both burn D-D: the floor is 0.1 of its optimum (17 keV)
    // the axes of the large devices did not move
    expect([ITER, SPARC, DEMO].map(deviceTmax)).toEqual([20, 20, 20]);
    expect(deviceTmax(PRESETS.find((p) => p.id === 'DIIID')!.cfg as MagneticConfig)).toBe(4);
  });

  it('the temperature grid is uniform on a map of a few keV and the model\'s own on a large one', () => {
    expect(uniformTemperature(deviceTmax(W7X))).toBe(true);
    expect(uniformTemperature(deviceTmax(MASTU))).toBe(true);
    expect(uniformTemperature(deviceTmax(ITER))).toBe(false);
    expect(uniformTemperature(4)).toBe(true);
    expect(uniformTemperature(5)).toBe(false);
  });

  it('a small low-field device gets a short axis, a large or high-field one a long axis', () => {
    expect(deviceTmax(MASTU)).toBeLessThanOrEqual(4);
    expect(deviceTmax(W7X)).toBeLessThanOrEqual(4);
    expect(deviceTmax(ITER)).toBeGreaterThanOrEqual(12);
    expect(deviceTmax(ITER)).toBeLessThanOrEqual(25);
    expect(deviceTmax(DEMO)).toBeGreaterThanOrEqual(deviceTmax(ITER));
    expect(deviceTmax(SPARC)).toBeGreaterThan(deviceTmax(MASTU));
  });

  it('grows with the field and the current, and with the beta limit (pressure the device can hold)', () => {
    const base = deviceTmax(ITER);
    expect(deviceTmax({ ...ITER, B0: ITER.B0 * 1.5, Ip_MA: ITER.Ip_MA * 1.5 })).toBeGreaterThanOrEqual(base);
    expect(deviceTmax({ ...ITER, B0: ITER.B0 * 0.4, Ip_MA: ITER.Ip_MA * 0.4 })).toBeLessThan(base);
    expect(deviceTmax({ ...ITER, limits: { ...ITER.limits, betaN_limit: 1.5 } })).toBeLessThan(base);
  });

  it('a fuel that burns only hot widens the axis; a stellarator (no plasma current) is scaled by its field and density', () => {
    expect(deviceTmax({ ...MASTU, fuel: 'pB11' })).toBeGreaterThan(deviceTmax(MASTU) * 4);
    expect(deviceTmax({ ...W7X, B0: 5 })).toBeGreaterThan(deviceTmax(W7X));
    expect(deviceTmax({ ...W7X, n_target: W7X.n_target / 20 })).toBeGreaterThan(deviceTmax(W7X));
  });

  it('does not fail on a degenerate configuration', () => {
    expect(deviceTmax({ ...ITER, B0: NaN })).toBe(40);
    expect(onScale(deviceTmax({ ...ITER, Ip_MA: 0 }))).toBe(true);
    expect(deviceTmax({ ...ITER, geometry: { ...ITER.geometry, a: 0 } })).toBeGreaterThanOrEqual(2);
  });

  it('follows the installed heating: more power widens the axis, none leaves the fuel floor', () => {
    const heat = (k: number) => ({ ...ITER, heating: { ...ITER.heating, P_NBI_MW: ITER.heating.P_NBI_MW * k, P_ICRH_MW: ITER.heating.P_ICRH_MW * k, P_ECRH_MW: ITER.heating.P_ECRH_MW * k } });
    expect(deviceTmax(heat(3))).toBeGreaterThanOrEqual(deviceTmax(ITER));
    expect(deviceTmax(heat(0.2))).toBeLessThan(deviceTmax(ITER));
    expect(onScale(deviceTmax(heat(0)))).toBe(true);
    expect(deviceTmax(heat(0))).toBeGreaterThanOrEqual(0.1 * fuelOptimumT('DT'));
  });
});

// the axis is a view of where the device operates: the run of every 0D magnetic preset has to sit in the middle of the
// map, not in its bottom fifth (v4.0 review finding: 50 keV for ITER, 80 for DEMO, the shots at 10 and 15 keV)
describe('deviceTmax: the operating region fills the axis', () => {
  const ids = ['ITER', 'JET', 'SPARC', 'DIIID', 'JT60SA', 'MASTU', 'W7X', 'DEMO'];
  it.each(ids)('%s: the peak T_i of the shot lies between 40 % and 95 % of the axis', (id) => {
    const cfg = PRESETS.find((p) => p.id === id)!.cfg as MagneticConfig;
    // the peak T_i is reached in the first seconds of the burn (DEMO: 15.38 keV at 60 s, 15.32 over the whole 2000 s)
    const sim = new Simulation({ ...cfg, t_end: Math.min(cfg.t_end, 60) });
    sim.runAll();
    let peak = 0;
    for (const f of sim.history) peak = Math.max(peak, f.d.Ti ?? 0);
    const Tmax = deviceTmax(cfg);
    expect(peak).toBeGreaterThan(0.5);
    expect(peak / Tmax, `${id}: peak ${peak.toFixed(2)} keV of ${Tmax}`).toBeGreaterThanOrEqual(0.4); // W-7X and MAST-U were at 0.34 before the fine axis
    expect(peak / Tmax, `${id}: peak ${peak.toFixed(2)} keV of ${Tmax}`).toBeLessThanOrEqual(0.95);
  }, 60_000);
});

describe('popconAxes / gridBuffers', () => {
  it('the density axis ends where the last uniform cell ends; the buffers are the grid arrays', () => {
    const g = computePopcon(ITER, { nx: 8, ny: 6, Tmax: 50 });
    const a = popconAxes(g, 50);
    expect(a.Tmax).toBe(50);
    expect(a.nMax / (g.n[7] + (g.n[1] - g.n[0]) / 2)).toBeCloseTo(1, 12); // the last centre plus half a cell
    const bufs = gridBuffers(g);
    expect(bufs).toHaveLength(6);
    expect(new Set(bufs).size).toBe(6);
    expect(bufs).toContain(g.Paux.buffer);
  });
});

describe('POPCON host: stages and stale jobs', () => {
  const compute = vi.fn(stub);
  const worker = () => { compute.mockClear(); return new FakePopconWorker({ compute }); };
  const start = (w: FakePopconWorker, job: number, cfg: MagneticConfig = ITER, stages = DEFAULT_POPCON_STAGES) => w.postMessage({ type: 'compute', job, cfg, stages });

  it('the default plan is a preview first, the fine grid once the controls have rested', () => {
    expect(DEFAULT_POPCON_STAGES.map((s) => [s.nx, s.ny, s.delayMs ?? 0])).toEqual([[16, 16, 0], [44, 44, POPCON_IDLE_MS]]);
    expect(POPCON_PREVIEW_SIZE).toBe(16);
    expect(POPCON_FINE_SIZE).toBe(44);
  });

  it('computes the preview at once and the fine grid after the idle time, posting each', () => {
    const w = worker();
    start(w, 1);
    w.elapse(0);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(grids(w.deliver()).map((m) => [m.job, m.stage, m.stages, m.grid.nx])).toEqual([[1, 0, 2, 16]]);
    w.elapse(POPCON_IDLE_MS - 1);
    expect(compute).toHaveBeenCalledTimes(1); // still waiting for the controls to rest
    w.elapse(1);
    expect(compute).toHaveBeenCalledTimes(2);
    expect(grids(w.deliver()).map((m) => [m.job, m.stage, m.grid.nx])).toEqual([[1, 1, 44]]);
    expect(w.pending()).toBe(0); // the job is over
  });

  it('both stages use the same temperature axis (no jump when the fine grid arrives) and report their axes', () => {
    const w = new FakePopconWorker();
    start(w, 1, SPARC);
    w.flush();
    const [a, b] = grids(w.deliver());
    expect(a.axes).toMatchObject({ Tmax: deviceTmax(SPARC) });
    expect(b.axes).toEqual({ ...a.axes });
    expect(a.grid.T[a.grid.ny - 1]).toBeLessThan(a.axes.Tmax);
    expect(b.grid.n[b.grid.nx - 1]).toBeLessThan(b.axes.nMax);
    expect(computePopcon(SPARC, { nx: 16, ny: 16, Tmax: deviceTmax(SPARC) }).Paux).toEqual(a.grid.Paux); // the model's own numbers
    expect(a.ms).toBeGreaterThanOrEqual(0);
  });

  it('a newer job replaces one that has not started: its preview is never computed', () => {
    const w = worker();
    start(w, 1, withH(ITER, 0.9));
    start(w, 2, withH(ITER, 1.0));
    start(w, 3, withH(ITER, 1.1));
    w.elapse(0);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(compute.mock.calls[0][0].H98).toBe(1.1);
    expect(grids(w.deliver()).map((m) => m.job)).toEqual([3]);
  });

  it('while the controls move, the fine grid is never computed: a newer job cancels the wait', () => {
    const w = worker();
    for (let drag = 1; drag <= 6; drag++) {
      start(w, drag, withH(ITER, 0.8 + 0.05 * drag));
      w.elapse(POPCON_IDLE_MS - 20); // the next change arrives before the controls rest
    }
    expect(compute.mock.calls.every(([, o]) => o?.nx === 16)).toBe(true);
    expect(compute).toHaveBeenCalledTimes(6);
    w.elapse(POPCON_IDLE_MS); // released: the newest job refines
    expect(compute).toHaveBeenCalledTimes(7);
    expect(compute.mock.calls[6][0].H98).toBeCloseTo(0.8 + 0.05 * 6, 12);
    expect(compute.mock.calls[6][1]?.nx).toBe(44);
    expect(grids(w.deliver()).map((m) => [m.job, m.stage])).toEqual([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [6, 1]]);
  });

  it('cancel stops the job in progress, dispose too', () => {
    const w = worker();
    start(w, 1);
    w.elapse(0);
    w.postMessage({ type: 'cancel' });
    w.elapse(1000);
    expect(compute).toHaveBeenCalledTimes(1);
    start(w, 2);
    w.process();
    w.terminate();
    expect(w.pending()).toBe(0);
    expect(() => w.postMessage({ type: 'cancel' })).toThrow();
  });

  it('a plan of several stages and delays runs in order', () => {
    const w = worker();
    start(w, 4, ITER, [{ nx: 4, ny: 4 }, { nx: 8, ny: 8, delayMs: 10 }, { nx: 12, ny: 12, delayMs: 100 }]);
    w.elapse(0);
    w.elapse(10);
    expect(compute).toHaveBeenCalledTimes(2);
    w.elapse(99);
    expect(compute).toHaveBeenCalledTimes(2);
    w.elapse(1);
    expect(grids(w.deliver()).map((m) => [m.stage, m.stages, m.grid.nx])).toEqual([[0, 3, 4], [1, 3, 8], [2, 3, 12]]);
  });

  it('refuses an empty or malformed plan with an error for that job', () => {
    const w = worker();
    start(w, 5, ITER, []);
    start(w, 6, ITER, [{ nx: 1, ny: 16 }]);
    start(w, 7, ITER, [{ nx: 16.5, ny: 16 }]);
    start(w, 8, ITER, [{ nx: 16, ny: 16, delayMs: -1 }]);
    start(w, 9, ITER, [{ nx: 1000, ny: 16 }]);
    w.flush();
    const out = w.deliver();
    expect(out.map((m) => [m.type, m.job])).toEqual([['error', 5], ['error', 6], ['error', 7], ['error', 8], ['error', 9]]);
    expect(compute).not.toHaveBeenCalled();
  });

  it('a failing model is reported for its job, and the next job works', () => {
    const boom = vi.fn((cfg: MagneticConfig, o?: Parameters<typeof computePopcon>[1]) => { if (cfg.H98 < 0) throw new Error('no such plasma'); return stub(cfg, o); });
    const w = new FakePopconWorker({ compute: boom });
    start(w, 1, withH(ITER, -1));
    w.flush();
    start(w, 2);
    w.flush();
    const out = w.deliver();
    expect(out[0]).toEqual({ type: 'error', job: 1, msg: 'no such plasma' });
    expect(grids(out).map((m) => m.job)).toEqual([2, 2]);
  });
});

describe('POPCON host: the edge maps and the temperature grid of a short axis', () => {
  const compute = vi.fn(stub);
  const start = (w: FakePopconWorker, cfg: MagneticConfig, edge?: boolean) => w.postMessage({ type: 'compute', job: 1, cfg, stages: [{ nx: 16, ny: 16 }], ...(edge === undefined ? {} : { edge }) });

  it('asks the model for the edge maps only when the job says so (an old page sends no flag and gets the map it always got)', () => {
    const w = new FakePopconWorker({ compute });
    compute.mockClear();
    start(w, ITER);
    w.flush();
    start(w, ITER, false);
    w.flush();
    start(w, ITER, true);
    w.flush();
    expect(compute.mock.calls.map(([, o]) => o?.edge)).toEqual([undefined, undefined, true]);
  });

  it('a short axis is computed on a uniform temperature grid, a long one on the model\'s own', () => {
    const w = new FakePopconWorker({ compute });
    compute.mockClear();
    start(w, W7X);
    w.flush();
    start(w, ITER);
    w.flush();
    expect(compute.mock.calls.map(([, o]) => [o?.Tmax, o?.uniformT])).toEqual([[1.75, true], [20, false]]);
  });

  it('with the real model a tokamak grid carries P_sep/R, q_peak and T_t of every cell, and a stellarator grid none', () => {
    const w = new FakePopconWorker();
    start(w, ITER, true);
    w.flush();
    const [g] = grids(w.deliver());
    expect(g.grid.PsepR).toBeInstanceOf(Float64Array);
    expect(g.grid.qPeak).toHaveLength(16 * 16);
    expect(g.grid.Tt).toHaveLength(16 * 16);
    expect([...g.grid.qPeak!].every(Number.isFinite)).toBe(true);
    // the same numbers as the model's own map, and the map without the edge is not changed by asking
    const own = computePopcon(ITER, { nx: 16, ny: 16, Tmax: g.axes.Tmax, edge: true });
    expect(g.grid.qPeak).toEqual(own.qPeak);
    expect(g.grid.Paux).toEqual(computePopcon(ITER, { nx: 16, ny: 16, Tmax: g.axes.Tmax }).Paux);
    start(w, W7X, true);
    w.flush();
    const [s] = grids(w.deliver());
    expect(s.grid.qPeak).toBeUndefined();
  });
});

describe('POPCON host with the real model and the real scheduler', () => {
  it('posts the preview and then the fine map of a job, and nothing of a job replaced in the meantime', async () => {
    const out: FromPopcon[] = [];
    const host = createPopconHost((m) => out.push(m));
    host.handle({ type: 'compute', job: 1, cfg: ITER, stages: [{ nx: 6, ny: 6 }, { nx: 10, ny: 10, delayMs: 60 }] });
    host.handle({ type: 'compute', job: 2, cfg: DEMO, stages: [{ nx: 6, ny: 6 }, { nx: 10, ny: 10, delayMs: 30 }] });
    await new Promise((r) => setTimeout(r, 200));
    expect(out.map((m) => m.type === 'grid' ? [m.job, m.stage] : [m.type, m.job])).toEqual([[2, 0], [2, 1]]);
    host.dispose();
  });

  it('dispose drops a job that is waiting', async () => {
    const out: FromPopcon[] = [];
    const host = createPopconHost((m) => out.push(m));
    host.handle({ type: 'compute', job: 1, cfg: ITER, stages: [{ nx: 6, ny: 6 }, { nx: 10, ny: 10, delayMs: 40 }] });
    await new Promise((r) => setTimeout(r, 15));
    expect(out).toHaveLength(1);
    host.dispose();
    await new Promise((r) => setTimeout(r, 80));
    expect(out).toHaveLength(1);
  });
});

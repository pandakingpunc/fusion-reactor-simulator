// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ITER, W7X } from '../../physics/presets';
import { MagneticConfig } from '../../physics/types';
import { FakePopconWorker, fakePopconFactory } from '../../worker/fakePopconWorker';
import { POPCON_IDLE_MS } from '../../worker/popconProtocol';
import { popconCfg, steerPatch, usePopcon } from './usePopcon';

afterEach(cleanup);

describe('steerPatch', () => {
  const controls = { P_NBI_MW: 30, P_ICRH_MW: 10, P_ECRH_MW: 0, n_target_1e20: 1, H98: 1 };

  it('sets the density and spreads the required heating over the heating controls as they are now', () => {
    expect(steerPatch({ n: 0.8e20, Paux_MW: 60 }, controls)).toEqual({ n_target_1e20: 0.8, P_NBI_MW: 45, P_ICRH_MW: 15, P_ECRH_MW: 0 });
  });

  it('puts all the power on the first heating control when none is in use, and only patches controls that exist', () => {
    expect(steerPatch({ n: 1.5e20, Paux_MW: 25 }, { P_NBI_MW: 0, P_ICRH_MW: 0, P_ECRH_MW: 0, n_target_1e20: 2 })).toEqual({ n_target_1e20: 1.5, P_NBI_MW: 25, P_ICRH_MW: 0, P_ECRH_MW: 0 });
    expect(steerPatch({ n: 1e20, Paux_MW: 25 }, { P_ICRH_MW: 0, P_ECRH_MW: 0 })).toEqual({ P_ICRH_MW: 25, P_ECRH_MW: 0 }); // no density control (a device without one), no NBI
    expect(steerPatch({ n: 1e20, Paux_MW: 25 }, { H98: 1 })).toEqual({});
    expect(steerPatch({ n: 1e20, Paux_MW: 25 }, {})).toEqual({});
  });

  it('keeps every control within its slider range: what one control cannot take goes to the others', () => {
    const p = steerPatch({ n: 1e20, Paux_MW: 250 }, { P_NBI_MW: 10, P_ICRH_MW: 190, P_ECRH_MW: 0, n_target_1e20: 1 });
    expect(p.P_NBI_MW).toBe(150); // range of the NBI slider
    expect(p.P_ICRH_MW).toBe(100); // range of the ICRH slider
    expect(p.P_NBI_MW + p.P_ICRH_MW + p.P_ECRH_MW).toBe(250);
    // more than all the sliders can carry: they are all at their maximum, nothing exceeds it
    const all = steerPatch({ n: 1e20, Paux_MW: 900 }, controls);
    expect(all).toMatchObject({ P_NBI_MW: 150, P_ICRH_MW: 100, P_ECRH_MW: 100 });
    // the density stays inside its slider range
    expect(steerPatch({ n: 100e20, Paux_MW: 1 }, controls).n_target_1e20).toBe(15);
    expect(steerPatch({ n: 1e17, Paux_MW: 1 }, controls).n_target_1e20).toBe(0.01);
  });

  it('a point that heats itself (or has no value) sets the heating to zero; powers are rounded to 0.1 MW', () => {
    expect(steerPatch({ n: 1e20, Paux_MW: -40 }, controls)).toMatchObject({ P_NBI_MW: 0, P_ICRH_MW: 0, P_ECRH_MW: 0 });
    expect(steerPatch({ n: 1e20, Paux_MW: NaN }, controls)).toMatchObject({ P_NBI_MW: 0, P_ICRH_MW: 0, P_ECRH_MW: 0 });
    const p = steerPatch({ n: 1.23456789e20, Paux_MW: 33.3333 }, { P_NBI_MW: 1, P_ICRH_MW: 2, n_target_1e20: 1 });
    expect(p.P_NBI_MW).toBe(11.1);
    expect(p.P_ICRH_MW).toBe(22.2);
    expect(p.n_target_1e20).toBe(1.235);
  });
});

describe('usePopcon: the edge option', () => {
  it('posts the job with edge: true only when asked, and asks again when the option changes', () => {
    const f = fakePopconFactory();
    const { rerender } = renderHook(({ edge }) => usePopcon(ITER, { createWorker: f.create, edge }), { initialProps: { edge: false } });
    const w: FakePopconWorker = f.workers[0];
    expect(w.last('compute')).toMatchObject({ job: 1 });
    expect(w.last('compute')!.edge).toBeUndefined();
    rerender({ edge: true });
    expect(w.last('compute')).toMatchObject({ job: 2, edge: true });
    rerender({ edge: true });
    expect(w.sent.filter((m) => m.type === 'compute')).toHaveLength(2); // nothing changed: no new job
    rerender({ edge: false });
    expect(w.last('compute')).toMatchObject({ job: 3 });
    expect(w.last('compute')!.edge).toBeUndefined();
  });
});

describe('popconCfg', () => {
  it('is the configuration itself while the controls equal its values, so an unchanged map is not recomputed', () => {
    expect(popconCfg(ITER)).toBe(ITER);
    expect(popconCfg(ITER, {})).toBe(ITER);
    expect(popconCfg(ITER, { H98: ITER.H98, cZ: ITER.impurity.concentration, P_NBI_MW: 999, n_target_1e20: 3 })).toBe(ITER);
  });

  it('applies the confinement multiplier and the impurity fraction, and nothing else', () => {
    const c = popconCfg(ITER, { H98: 1.3, cZ: 0.02, P_NBI_MW: 1, n_target_1e20: 9 });
    expect(c).not.toBe(ITER);
    expect(c.H98).toBe(1.3);
    expect(c.impurity).toEqual({ ...ITER.impurity, concentration: 0.02 });
    expect(c.heating).toBe(ITER.heating);
    expect(c.n_target).toBe(ITER.n_target);
    expect(ITER.H98).not.toBe(1.3); // the preset is not touched
    expect(popconCfg(ITER, { H98: undefined } as unknown as Record<string, number>)).toBe(ITER);
  });

  it('a stellarator takes its own multiplier', () => {
    const c = popconCfg(W7X, { H_ISS04: 1.4 });
    expect(c.stellarator.H_ISS04).toBe(1.4);
    expect(c.H98).toBe(W7X.H98);
  });
});

describe('usePopcon', () => {
  const stages = [{ nx: 6, ny: 6 }, { nx: 10, ny: 10, delayMs: POPCON_IDLE_MS }] as const;
  const withH = (H98: number): MagneticConfig => ({ ...ITER, H98 });
  const round = (w: FakePopconWorker) => act(() => { w.elapse(0); w.deliver(); });

  it('starts a job for the configuration and shows the preview, then the refined grid', () => {
    const f = fakePopconFactory();
    const { result } = renderHook(() => usePopcon(ITER, { createWorker: f.create, stages }));
    const w = f.workers[0];
    expect(f.workers).toHaveLength(1);
    expect(w.last('compute')).toMatchObject({ job: 1, stages });
    expect(result.current).toMatchObject({ grid: null, pending: true, error: null, available: true });
    round(w);
    expect(result.current.grid?.nx).toBe(6);
    expect(result.current).toMatchObject({ stage: 0, stages: 2, pending: true });
    expect(result.current.axes?.Tmax).toBeGreaterThan(0);
    act(() => { w.elapse(POPCON_IDLE_MS); w.deliver(); });
    expect(result.current.grid?.nx).toBe(10);
    expect(result.current).toMatchObject({ stage: 1, stages: 2, pending: false });
    expect(result.current.ms).toBeGreaterThanOrEqual(0);
  });

  it('the default plan is a 16 × 16 preview and a 44 × 44 map', () => {
    const f = fakePopconFactory();
    const { result } = renderHook(() => usePopcon(ITER, { createWorker: f.create }));
    const w = f.workers[0];
    round(w);
    expect(result.current.grid?.nx).toBe(16);
    act(() => { w.elapse(POPCON_IDLE_MS); w.deliver(); });
    expect(result.current.grid?.nx).toBe(44);
  });

  it('a new configuration starts a new job, keeps the old grid on screen until the new preview arrives, and drops what the old job still delivers', () => {
    const f = fakePopconFactory();
    const { result, rerender } = renderHook(({ cfg }) => usePopcon(cfg, { createWorker: f.create, stages }), { initialProps: { cfg: withH(1.0) } });
    const w = f.workers[0];
    round(w);
    const first = result.current.grid;
    expect(first).not.toBeNull();
    // the old job's fine grid is computed and waiting in the outbox when the controls move
    act(() => { w.elapse(POPCON_IDLE_MS); });
    rerender({ cfg: withH(1.2) });
    expect(w.last('compute')).toMatchObject({ job: 2 });
    expect(result.current.grid).toBe(first);
    expect(result.current.pending).toBe(true);
    act(() => { w.deliver((m) => m.type === 'grid' && m.job === 1); }); // the late grid of job 1
    expect(result.current.grid).toBe(first); // ignored
    round(w);
    expect(result.current.grid).not.toBe(first);
    expect(w.computed.at(-1)?.cfg.H98).toBe(1.2);
  });

  it('a stale error is ignored, a current one is shown, and a worker crash too', () => {
    const f = fakePopconFactory();
    const { result, rerender } = renderHook(({ cfg }) => usePopcon(cfg, { createWorker: f.create, stages }), { initialProps: { cfg: withH(1.0) } });
    const w = f.workers[0];
    rerender({ cfg: withH(1.1) });
    act(() => { w.emit({ type: 'error', job: 1, msg: 'old' }); });
    expect(result.current.error).toBeNull();
    act(() => { w.emit({ type: 'error', job: 2, msg: 'no such plasma' }); });
    expect(result.current).toMatchObject({ error: 'no such plasma', pending: false });
    // the next job clears it
    rerender({ cfg: withH(1.3) });
    round(w);
    expect(result.current.error).toBeNull();
    act(() => { w.crash('worker died'); });
    expect(result.current.error).toBe('worker died');
  });

  it('terminates the worker on unmount, and swaps it (with the job) when the factory changes', () => {
    const f = fakePopconFactory();
    const g = fakePopconFactory();
    const { rerender, unmount } = renderHook(({ make }) => usePopcon(ITER, { createWorker: make, stages }), { initialProps: { make: f.create } });
    expect(f.workers[0].terminated).toBe(false);
    rerender({ make: g.create });
    expect(f.workers[0].terminated).toBe(true);
    expect(g.workers[0].last('compute')).toMatchObject({ job: 2 });
    unmount();
    expect(g.workers[0].terminated).toBe(true);
  });

  it('starts no job without a configuration, and reports that no worker is available', () => {
    const f = fakePopconFactory();
    const { result } = renderHook(() => usePopcon(null, { createWorker: f.create, stages }));
    expect(f.workers[0].sent).toEqual([]);
    expect(result.current.pending).toBe(false);
    const noWorker = () => null;
    const none = renderHook(() => usePopcon(ITER, { createWorker: noWorker, stages }));
    expect(none.result.current).toMatchObject({ available: false, grid: null, pending: false });
  });

  it('with no Worker in the environment (this DOM) the default factory gives none', () => {
    const { result } = renderHook(() => usePopcon(ITER));
    expect(result.current.available).toBe(false);
  });
});

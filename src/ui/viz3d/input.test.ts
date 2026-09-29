import { describe, expect, it } from 'vitest';
import { ITER, ITER_15D } from '../../physics/presets';
import type { MagneticConfig, SimEvent } from '../../physics/types';
import type { SimMeta, UiFrame } from '../../worker/protocol';
import { Viz3DSource, toViewerInput } from './input';

const meta = (cfg: MagneticConfig, extra: Record<string, number> = {}, method: string = cfg.method): SimMeta => ({
  method: method as SimMeta['method'], kind: 'magnetic', timeUnit: 's', tEnd: 100, diagSpecs: [],
  geometry: {
    R: cfg.geometry.R, a: cfg.geometry.a, kappa: cfg.geometry.kappa, delta: cfg.geometry.delta,
    gap: cfg.magnet.gap_m, coilThickness: cfg.magnet.coilThickness_m, ...extra,
  },
  controls: {},
});
const frame = (t: number, d: Record<string, number>, more: Partial<UiFrame> = {}): UiFrame => ({ t, d, ...more });
const src = (over: Partial<Viz3DSource> = {}): Viz3DSource => ({
  meta: meta(ITER), cfg: ITER, last: frame(50, { Ti0: 18, H_mode: 1 }), events: [], disrupted: false, eqFrame: null, profFrame: null, ...over,
});

describe('toViewerInput', () => {
  it('maps the geometry, the central temperature and H-mode of a 0D run', () => {
    const v = toViewerInput(src());
    expect(v.shape).toMatchObject({ R: ITER.geometry.R, a: ITER.geometry.a, method: 'tokamak', eq: null });
    expect(v.temp.T0_keV).toBe(18);
    expect(v.hmode).toBe(true);
    expect(v.disrupted).toBe(false);
    expect(v.temp.prof).toBeNull();
  });
  it('falls back to Ti when Ti0 is missing, and to zero without either', () => {
    expect(toViewerInput(src({ last: frame(1, { Ti: 7 }) })).temp.T0_keV).toBe(7);
    expect(toViewerInput(src({ last: frame(1, {}) })).temp.T0_keV).toBe(0);
    expect(toViewerInput(src({ last: frame(1, {}) })).hmode).toBe(false);
  });
  it('uses the equilibrium and the Te profile only for a 1.5D run', () => {
    const eq = { marker: 1 } as never;
    const prof = { rho: [0, 1], Te: [20, 1] } as never;
    const flat = toViewerInput(src({ eqFrame: frame(1, {}, { eq }), profFrame: frame(1, {}, { prof }) }));
    expect(flat.shape.eq).toBeNull();
    expect(flat.temp.prof).toBeNull();
    const c15 = ITER_15D as MagneticConfig;
    const v = toViewerInput(src({ meta: meta(c15, { profiles: 32 }), cfg: c15, eqFrame: frame(1, {}, { eq }), profFrame: frame(1, {}, { prof }) }));
    expect(v.shape.eq).toBe(eq);
    expect(v.temp.prof).toEqual({ rho: [0, 1], Te: [20, 1] });
  });
  it('never hands an equilibrium to a stellarator, and treats an unknown method as a tokamak', () => {
    const eq = { marker: 1 } as never;
    const st = toViewerInput(src({ meta: meta(ITER, { profiles: 32 }, 'stellarator'), eqFrame: frame(1, {}, { eq }) }));
    expect(st.shape.method).toBe('stellarator');
    expect(st.shape.eq).toBeNull();
    expect(toViewerInput(src({ meta: meta(ITER, {}, 'mystery') })).shape.method).toBe('tokamak');
  });
  it('reads the ELM flash from the event log and passes the disruption flag through', () => {
    const events = [{ t: 49.9, kind: 'ELM' }] as unknown as SimEvent[];
    const v = toViewerInput(src({ events, disrupted: true }));
    expect(v.elmFlash).toBeGreaterThan(0.5);
    expect(v.disrupted).toBe(true);
    expect(toViewerInput(src()).elmFlash).toBe(0);
  });
});

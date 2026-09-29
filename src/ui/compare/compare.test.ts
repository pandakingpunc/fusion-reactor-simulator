import { describe, expect, it } from 'vitest';
import { ITER, SPARC } from '../../physics/presets';
import { ShotReport } from '../../physics/types';
import { SavedShot } from '../state/types';
import { diffConfigs, flattenConfig } from './diffConfigs';
import { LOG_DECADES, RADAR_AXES, radarPoints, radarValues } from './radar';
import { commonChannels, extent, overlayTraces, tickValues, timeAxisAllowed } from './overlay';

describe('configuration diff', () => {
  it('flattens nested objects and arrays to dotted paths and skips undefined leaves', () => {
    const m = flattenConfig({ a: 1, b: { c: 'x', d: [true, { e: 2 }] }, u: undefined, n: null });
    expect([...m.entries()]).toEqual([['a', 1], ['b.c', 'x'], ['b.d[0]', true], ['b.d[1].e', 2], ['n', null]]);
  });

  it('lists only the fields that differ, with the relative change of numbers, grouped by section', () => {
    const b = { ...ITER, H98: 1.2, heating: { ...ITER.heating, P_NBI_MW: 16.5 }, limits: { ...ITER.limits, betaN_limit: 3.5 } };
    const rows = diffConfigs(ITER, b);
    expect(rows.map((r) => r.path)).toEqual(['H98', 'heating.P_NBI_MW']);
    expect(rows[0]).toMatchObject({ group: 'general', a: 1, b: 1.2, kind: 'changed' });
    expect(rows[0].change).toBeCloseTo(0.2, 12);
    expect(rows[1]).toMatchObject({ group: 'heating', a: 33, b: 16.5 });
    expect(rows[1].change).toBeCloseTo(-0.5, 12);
  });

  it('two identical configurations, or numbers equal to 12 digits, differ nowhere', () => {
    expect(diffConfigs(ITER, { ...ITER })).toEqual([]);
    expect(diffConfigs({ n: 1e20 }, { n: 1e20 * (1 + 1e-14) })).toEqual([]);
    expect(diffConfigs({ n: NaN }, { n: NaN })).toEqual([]);
    expect(diffConfigs({ n: 1e20 }, { n: 1.0001e20 })).toHaveLength(1);
  });

  it('a field on one side only is added or removed; a change from zero has no relative change', () => {
    const rows = diffConfigs({ p: { x: 1 }, z: 0, only: 'a' }, { p: { x: 1, y: 2 }, z: 5 });
    expect(rows.map((r) => [r.path, r.kind])).toEqual([['only', 'removed'], ['z', 'changed'], ['p.y', 'added']]);
    expect(rows.find((r) => r.path === 'z')!.change).toBeUndefined();
  });

  it('shows a real method change as many differences and sorts general fields first', () => {
    const rows = diffConfigs(ITER, SPARC);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows[0].group).toBe('general');
    const groups = rows.map((r) => r.group);
    const firstOther = groups.findIndex((g) => g !== 'general');
    expect(groups.slice(firstOther).includes('general')).toBe(false);
  });
});

const report = (over: Partial<ShotReport> = {}): ShotReport => ({
  Q_sci_max: 10, Q_eng: 1, Timax_keV: 20, E_fusion_MJ: 1000, burnTime_s: 300, lawson_ratio: 1, tripleProduct_max: 3e21, score: 80, ...over,
}) as ShotReport;

describe('radar chart scaling', () => {
  it('scales each axis to the best shot: 1 for the best, the ratio for the others (linear)', () => {
    const v = radarValues([report(), report({ Q_sci_max: 2.5, E_fusion_MJ: 500 })], 'lin');
    expect(v[0].every((x) => x === 1)).toBe(true);
    expect(v[1][RADAR_AXES.findIndex((a) => a.id === 'qsci')]).toBeCloseTo(0.25, 12);
    expect(v[1][RADAR_AXES.findIndex((a) => a.id === 'efus')]).toBeCloseTo(0.5, 12);
  });

  it('puts zero, negative and non-finite values at the centre, and an axis nobody scores on at zero', () => {
    const v = radarValues([report({ Q_eng: 0, Timax_keV: -1, lawson_ratio: NaN, score: Infinity }), report({ Q_eng: 0 })], 'lin');
    const at = (id: string) => RADAR_AXES.findIndex((a) => a.id === id);
    expect(v[0][at('qeng')]).toBe(0);
    expect(v[1][at('qeng')]).toBe(0);
    expect(v[0][at('ti')]).toBe(0);
    expect(v[0][at('lawson')]).toBe(0);
    expect(v[0][at('score')]).toBe(0);
    expect(v[1][at('score')]).toBe(1);
  });

  it('the log scale spans LOG_DECADES decades below the best value', () => {
    const v = radarValues([report(), report({ Q_sci_max: 10 ** (1 - LOG_DECADES / 2) }), report({ Q_sci_max: 1e-9 })], 'log');
    const i = RADAR_AXES.findIndex((a) => a.id === 'qsci');
    expect(v[0][i]).toBe(1);
    expect(v[1][i]).toBeCloseTo(0.5, 9);
    expect(v[2][i]).toBe(0); // below the reach: at the centre
    expect(radarValues([], 'lin')).toEqual([]);
  });

  it('places axis i at 360°/n steps, the first straight up', () => {
    const p = radarPoints([1, 1, 1, 1], 100, 100, 50);
    expect(p[0].x).toBeCloseTo(100, 9); expect(p[0].y).toBeCloseTo(50, 9);
    expect(p[1].x).toBeCloseTo(150, 9); expect(p[1].y).toBeCloseTo(100, 9);
    expect(p[2].y).toBeCloseTo(150, 9);
    expect(radarPoints([0.5, 0, 0, 0], 100, 100, 50)[0].y).toBeCloseTo(75, 9);
  });
});

function shot(id: number, unit: 's' | 'ns', keys: string[], tEnd: number, n = 11): SavedShot {
  const frames = Array.from({ length: n }, (_, i) => ({ t: (tEnd * i) / (n - 1), d: Object.fromEntries(keys.map((k) => [k, i + id])) }));
  return {
    id, name: `shot ${id}`, cfg: ITER, report: report(), events: [], frames,
    meta: { method: 'tokamak', kind: 'magnetic', timeUnit: unit, tEnd, diagSpecs: keys.map((key) => ({ key, label: key, unit: '', group: 'g' })), geometry: {}, controls: {} },
  };
}

describe('overlay of runs', () => {
  it('offers only the channels that every shot has, in the first shot\'s order', () => {
    const a = shot(1, 's', ['Ti', 'Q', 'x'], 10), b = shot(2, 's', ['Q', 'Ti', 'y'], 10);
    expect(commonChannels([a, b]).map((c) => c.key)).toEqual(['Ti', 'Q']);
    expect(commonChannels([a]).map((c) => c.key)).toEqual(['Ti', 'Q', 'x']);
    expect(commonChannels([])).toEqual([]);
  });

  it('absolute time needs one time unit for all shots', () => {
    expect(timeAxisAllowed([shot(1, 's', ['Q'], 1), shot(2, 's', ['Q'], 5)])).toBe(true);
    expect(timeAxisAllowed([shot(1, 's', ['Q'], 1), shot(2, 'ns', ['Q'], 5)])).toBe(false);
  });

  it('samples a trace in absolute time or as a fraction of the shot, thinned but ending on the last frame', () => {
    const a = shot(1, 's', ['Q'], 10, 1001);
    const abs = overlayTraces([a], 'Q', 'abs', 100)[0].points;
    expect(abs.length).toBeLessThanOrEqual(102);
    expect(abs[abs.length - 1]).toEqual({ x: 10, y: 1001 });
    const norm = overlayTraces([a], 'Q', 'norm', 100)[0].points;
    expect(norm[0].x).toBe(0);
    expect(norm[norm.length - 1].x).toBeCloseTo(1, 12);
    // shots of different length share the normalised axis
    const b = shot(2, 's', ['Q'], 2, 11);
    expect(overlayTraces([a, b], 'Q', 'norm').map((t) => t.points[t.points.length - 1].x)).toEqual([1, 1]);
  });

  it('skips frames where the channel is missing or not finite', () => {
    const a = shot(1, 's', ['Q'], 4, 5);
    a.frames[1].d.Q = NaN; delete a.frames[2].d.Q;
    expect(overlayTraces([a], 'Q', 'abs')[0].points.map((p) => p.x)).toEqual([0, 3, 4]);
    expect(overlayTraces([a], 'nope', 'abs')[0].points).toEqual([]);
  });

  it('finds the bounds of the traces, ignoring non-positive values on a log axis', () => {
    const t = [{ shotId: 1, points: [{ x: 0, y: -1 }, { x: 1, y: 10 }, { x: 2, y: 1000 }] }];
    expect(extent(t, false)).toEqual({ x0: 0, x1: 2, y0: -1, y1: 1000 });
    expect(extent(t, true)).toEqual({ x0: 1, x1: 2, y0: 10, y1: 1000 });
    expect(extent([], false)).toBeUndefined();
    expect(extent([{ shotId: 1, points: [{ x: 0, y: -2 }] }], true)).toBeUndefined();
  });

  it('chooses tick values inside the range: nice steps on a linear axis, decades on a log one', () => {
    expect(tickValues(0, 10, false, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(tickValues(0.13, 0.87, false, 4)).toEqual([0.2, 0.4, 0.6, 0.8]);
    expect(tickValues(1, 1e6, true)).toEqual([1, 10, 100, 1000, 1e4, 1e5, 1e6]);
    expect(tickValues(1, 20, true)).toEqual([1, 2, 5, 10, 20]);
    expect(tickValues(3, 3, false)).toEqual([3]);
  });
});

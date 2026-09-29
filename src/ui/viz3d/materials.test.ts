import { describe, expect, it } from 'vitest';
import { ITER } from '../../physics/presets';
import { IDLE_STATE, SceneState, applyDeform, planDraws } from './materials';
import { NO_DISRUPTION, disruptionLook } from './palette';
import { Scene3D, SceneShape, buildScene } from './scene';

const shape: SceneShape = {
  R: ITER.geometry.R, a: ITER.geometry.a, kappa: ITER.geometry.kappa, delta: ITER.geometry.delta,
  gap: ITER.magnet.gap_m, coilThickness: ITER.magnet.coilThickness_m, method: 'tokamak',
};
const scene: Scene3D = buildScene(shape, { cutaway: true, coils: true, quality: 'minimal' });
const st = (over: Partial<SceneState> = {}): SceneState => ({ ...IDLE_STATE, temp: { T0_keV: 15, alphaT: 1 }, ...over });
const labels = (s: SceneState) => planDraws(scene, s).map((c) => c.label);

describe('frame plan', () => {
  it('draws opaque items first, then the vessel, the plasma surfaces and the effects', () => {
    const plan = planDraws(scene, st({ hmode: true, elmFlash: 0.5 }));
    const order = ['opaque', 'alpha', 'additive'];
    const ranks = plan.map((c) => order.indexOf(c.blend));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(plan.length).toBeGreaterThan(scene.items.length);
  });
  it('every scene item is planned once in an idle state', () => {
    const plan = planDraws(scene, st());
    for (const it of scene.items) expect(plan.filter((c) => c.item === it)).toHaveLength(1);
    expect(plan).toHaveLength(scene.items.length);
  });
  it('adds the pedestal in H-mode and the ELM shell only while flashing', () => {
    expect(labels(st())).not.toContain('pedestal');
    expect(labels(st({ hmode: true }))).toContain('pedestal');
    expect(labels(st())).not.toContain('elm');
    const elm = planDraws(scene, st({ elmFlash: 0.8 })).find((c) => c.label === 'elm')!;
    expect(elm.alpha).toBeCloseTo(0.6, 12);
    expect(elm.deform!.squash).toBeCloseTo(1.048, 12);
  });
  it('a disruption greys the plasma, drops the pedestal and adds the red rim', () => {
    const calm = planDraws(scene, st({ hmode: true }));
    const dis = planDraws(scene, st({ hmode: true, disruption: disruptionLook(Infinity) }));
    expect(dis.map((c) => c.label)).not.toContain('pedestal');
    expect(dis.map((c) => c.label)).toContain('disruption rim');
    const pick = (p: typeof calm) => p.find((c) => c.label === 'surface 0')!;
    const spread = (c: number[]) => Math.max(...c) - Math.min(...c);
    expect(spread(pick(dis).color)).toBeLessThan(spread(pick(calm).color));
    expect(pick(dis).deform).not.toBeNull();
    expect(pick(calm).deform).toBeNull();
  });
  it('the flash of the thermal quench raises the glow', () => {
    const glow = (d: number) => planDraws(scene, st({ disruption: disruptionLook(d) })).find((c) => c.label === 'surface 0')!.glow;
    expect(glow(120)).toBeGreaterThan(glow(Infinity));
    expect(glow(Infinity)).toBe(1);
  });
  it('colours each surface by its temperature: the core is hotter than the edge', () => {
    const shells = planDraws(scene, st()).filter((c) => c.label.startsWith('surface'));
    expect(shells.length).toBeGreaterThanOrEqual(2);
    expect(shells[0].color).not.toEqual(shells[shells.length - 1].color);
  });
  it('an idle state has no deformation at all', () => {
    expect(planDraws(scene, st({ disruption: NO_DISRUPTION })).every((c) => c.deform === null)).toBe(true);
  });
});

describe('applyDeform (mirrors the vertex shader)', () => {
  it('is the identity for squash 1 and no shift, keeps the toroidal angle, and scales (R, Z) about the axis', () => {
    const d = { axisR: 6, axisZ: 0, squash: 1, dR: 0, dZ: 0 };
    expect(applyDeform(6, 0, 1, d)).toEqual([6, 0, 1]);
    const q = applyDeform(0, 7, 2, { axisR: 6, axisZ: 0, squash: 0.5, dR: 0.25, dZ: -1 });
    expect(q[0]).toBeCloseTo(0, 12);
    expect(q[1]).toBeCloseTo(6 + 0.5 * 1 + 0.25, 12); // R = 7 -> 6 + 0.5 * (7 - 6) + 0.25
    expect(q[2]).toBeCloseTo(0.5 * 2 - 1, 12);
  });
  it('keeps points on the axis of revolution finite', () => {
    const q = applyDeform(0, 0, 3, { axisR: 6, axisZ: 0, squash: 0.6, dR: 0, dZ: 0 });
    expect(q.every(Number.isFinite)).toBe(true);
  });
});

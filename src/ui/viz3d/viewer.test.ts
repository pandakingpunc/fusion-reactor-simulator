import { describe, expect, it } from 'vitest';
import { ITER } from '../../physics/presets';
import { FRAGMENT_SHADER, VERTEX_SHADER, Viz3DUnavailable, createGlRenderer } from './gl';
import { IDLE_STATE, planDraws } from './materials';
import { DISRUPTION_MS } from './palette';
import { Ctx2D, drawScene2D } from './raster2d';
import { fitCamera } from './camera';
import { buildScene, DEFAULT_CUT_CENTRE, SceneShape } from './scene';
import { CanvasLike, MIN_REBUILD_MS, Viewer3D, ViewerDeps, ViewerInput } from './viewer';

const shape: SceneShape = {
  R: ITER.geometry.R, a: ITER.geometry.a, kappa: ITER.geometry.kappa, delta: ITER.geometry.delta,
  gap: ITER.magnet.gap_m, coilThickness: ITER.magnet.coilThickness_m, method: 'tokamak',
};
const input = (over: Partial<ViewerInput> = {}): ViewerInput => ({
  shape, temp: { T0_keV: 15, alphaT: 1 }, hmode: false, elmFlash: 0, disrupted: false, ...over,
});

/** a 2D context that only counts what it is asked to paint */
class Ctx implements Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  fills = 0; rects = 0; transforms: number[][] = [];
  fillRect() { this.rects++; }
  beginPath() { /* noop */ }
  moveTo() { /* noop */ }
  lineTo() { /* noop */ }
  closePath() { /* noop */ }
  fill() { this.fills++; }
  setTransform(...m: number[]) { this.transforms.push(m); }
}
class FakeCanvas implements CanvasLike {
  width = 0; height = 0;
  ctx = new Ctx();
  listeners = new Map<string, ((e: Event) => void)[]>();
  gl: unknown = null;
  getContext(type: string) { return type === '2d' ? this.ctx : type === 'webgl2' ? this.gl : null; }
  addEventListener(t: string, l: (e: Event) => void) { this.listeners.set(t, [...(this.listeners.get(t) ?? []), l]); }
  removeEventListener(t: string, l: (e: Event) => void) { this.listeners.set(t, (this.listeners.get(t) ?? []).filter((x) => x !== l)); }
}

/** a manual clock and animation-frame queue */
function clock(reducedMotion = false) {
  let now = 0, id = 0;
  const queue = new Map<number, (t: number) => void>();
  const deps: ViewerDeps = {
    now: () => now, raf: (cb) => { queue.set(++id, cb); return id; }, caf: (i) => { queue.delete(i); }, reducedMotion,
  };
  const tick = (dtMs = 16) => {
    now += dtMs;
    const cbs = [...queue.values()]; queue.clear();
    for (const cb of cbs) cb(now);
    return cbs.length;
  };
  return { deps, tick, pending: () => queue.size, advance: (ms: number) => { now += ms; } };
}

describe('Viewer3D on the 2D fallback', () => {
  const make = (reduced = false) => {
    const cv = new FakeCanvas(), c = clock(reduced);
    const v = new Viewer3D(cv, '2d', c.deps);
    v.resize(400, 300, 2);
    return { cv, c, v };
  };

  it('sizes the canvas in device pixels (dpr capped at 2) and paints a scene on the first frame', () => {
    const { cv, c, v } = make();
    expect(cv.width).toBe(800);
    expect(cv.height).toBe(600);
    v.setInput(input());
    c.tick();
    expect(v.currentScene?.source).toBe('miller');
    expect(cv.ctx.fills).toBeGreaterThan(100);
    expect(cv.ctx.transforms.at(-1)).toEqual([2, 0, 0, 2, 0, 0]);
    expect(v.stats.triangles).toBe(cv.ctx.fills);
    v.resize(400, 300, 5);
    expect(cv.width).toBe(800);
  });

  it('is on demand: an idle view schedules nothing after its frame', () => {
    const { c, v } = make();
    v.setInput(input());
    expect(c.pending()).toBe(1);
    c.tick();
    expect(c.pending()).toBe(0);
    v.setInput(input({ hmode: true }));
    v.setInput(input({ hmode: true, elmFlash: 0.3 }));
    expect(c.pending()).toBe(1); // coalesced into one frame
  });

  it('draws nothing before there is an input, and nothing after dispose', () => {
    const { cv, c, v } = make();
    v.requestRender();
    c.tick();
    expect(cv.ctx.fills).toBe(0);
    v.setInput(input());
    v.dispose();
    expect(c.pending()).toBe(0);
    v.requestRender();
    expect(c.pending()).toBe(0);
  });

  it('fits the camera to the scene, and orbit, zoom, pan and reset move and restore it', () => {
    const { c, v } = make();
    v.setInput(input());
    c.tick();
    const home = v.camera!;
    v.orbitBy(50, 20);
    expect(v.camera!.azimuth).not.toBe(home.azimuth);
    v.zoomBy(0.5);
    expect(v.camera!.distance).toBeLessThan(home.distance);
    v.panBy(30, 10);
    expect(v.camera!.target).not.toEqual(home.target);
    v.zoomBy(1e-6);
    expect(v.camera!.distance).toBeGreaterThan(0.3 * v.currentScene!.radius);
    v.resetView();
    expect(v.camera).toEqual(home);
    expect(v.camera).toEqual(fitCamera(v.currentScene!.center, v.currentScene!.radius, DEFAULT_CUT_CENTRE));
  });

  it('ignores camera moves before a scene exists', () => {
    const { v } = make();
    v.orbitBy(1, 1); v.zoomBy(2); v.panBy(1, 1); v.resetView();
    expect(v.camera).toBeNull();
  });

  it('rebuilds the scene at once for a shape or toggle change, and reports it', () => {
    const { c, v } = make();
    const built: string[] = [];
    v.onSceneBuilt = (s) => built.push(s.source);
    v.setInput(input());
    c.tick();
    const first = v.currentScene;
    v.setInput(input({ shape: { ...shape, kappa: shape.kappa + 0.2 } }));
    c.tick();
    expect(v.currentScene).not.toBe(first);
    const second = v.currentScene;
    v.setToggles({ cutaway: false, coils: true, autoRotate: false });
    c.tick();
    expect(v.currentScene).not.toBe(second);
    expect(built).toHaveLength(3);
    // a temperature or H-mode change is only a different plan: no rebuild
    const third = v.currentScene;
    v.setInput(input({ shape: { ...shape, kappa: shape.kappa + 0.2 }, hmode: true }));
    c.tick();
    expect(v.currentScene).toBe(third);
  });

  it('throttles rebuilds caused by a changing equilibrium alone, and comes back for the pending one', () => {
    const { c, v } = make();
    const eqA = { a: 1 } as never, eqB = { b: 2 } as never;
    v.setInput(input());
    c.tick();
    const built: unknown[] = [];
    v.onSceneBuilt = (s) => built.push(s);
    // an unusable snapshot falls back to Miller surfaces, but the input still counts as a new equilibrium
    v.setInput(input({ shape: { ...shape, eq: eqA } }));
    c.tick(10);
    expect(built).toHaveLength(0); // too soon after the first build: throttled
    expect(c.pending()).toBe(1); // ...and it asks for another frame
    c.advance(MIN_REBUILD_MS);
    c.tick(10);
    expect(built).toHaveLength(1);
    v.setInput(input({ shape: { ...shape, eq: eqB } }));
    c.tick(10);
    expect(built).toHaveLength(1);
  });

  it('animates the auto-rotation while it is on, and stops when it is off or motion is reduced', () => {
    const { c, v } = make();
    v.setInput(input());
    c.tick();
    v.setToggles({ cutaway: true, coils: true, autoRotate: true });
    c.tick(); c.tick(100);
    const az = v.camera!.azimuth;
    expect(c.pending()).toBe(1);
    c.tick(100);
    expect(v.camera!.azimuth).not.toBe(az);
    v.setToggles({ cutaway: true, coils: true, autoRotate: false });
    c.tick();
    expect(c.pending()).toBe(0);

    const r = make(true);
    r.v.setInput(input());
    r.v.setToggles({ cutaway: true, coils: true, autoRotate: true });
    r.c.tick();
    expect(r.c.pending()).toBe(0);
  });

  it('animates a disruption for DISRUPTION_MS of wall-clock time, unless it was already over or motion is reduced', () => {
    const { c, v } = make();
    v.setInput(input());
    c.tick();
    v.setInput(input({ disrupted: true }));
    let frames = 0;
    while (c.pending() && frames < 500) { c.tick(50); frames++; }
    expect(frames).toBeGreaterThan(Math.floor(DISRUPTION_MS / 50) - 2);
    expect(frames).toBeLessThan(Math.ceil(DISRUPTION_MS / 50) + 4);

    // a shot that is already disrupted when the view opens shows the settled end state at once
    const late = make();
    late.v.setInput(input({ disrupted: true }));
    late.c.tick();
    expect(late.c.pending()).toBe(0);

    const r = make(true);
    r.v.setInput(input());
    r.c.tick();
    r.v.setInput(input({ disrupted: true }));
    r.c.tick();
    expect(r.c.pending()).toBe(0);
  });

  it('a new run (disruption cleared) rests again', () => {
    const { c, v } = make();
    v.setInput(input({ disrupted: true }));
    c.tick();
    v.setInput(input({ disrupted: false }));
    c.tick();
    expect(c.pending()).toBe(0);
  });
});

describe('Viewer3D backends', () => {
  it('needs WebGL2 in webgl2 mode: without a context it throws Viz3DUnavailable', () => {
    const cv = new FakeCanvas();
    expect(() => new Viewer3D(cv, 'webgl2', clock().deps)).toThrow(Viz3DUnavailable);
  });
  it('without a 2D context the fallback fails as well', () => {
    const cv = new FakeCanvas();
    cv.getContext = () => null;
    expect(() => new Viewer3D(cv, '2d', clock().deps)).toThrow(Viz3DUnavailable);
  });
  it('a program that does not build is Viz3DUnavailable, the context is given back, and no listener is left', () => {
    const gl = mockGl({ compileOk: false });
    const cv = new FakeCanvas();
    cv.gl = gl;
    expect(() => new Viewer3D(cv, 'webgl2', clock().deps)).toThrow(/shader compile failed/);
    expect(gl.lost).toBe(1);
    expect(cv.listeners.get('webglcontextlost') ?? []).toHaveLength(0);
  });
  it('a lost context reports through onContextLost, dispose releases the GPU objects and the listener', () => {
    const gl = mockGl({});
    const cv = new FakeCanvas();
    cv.gl = gl;
    const c = clock();
    const v = new Viewer3D(cv, 'webgl2', c.deps);
    let lost = 0, prevented = 0;
    v.onContextLost = () => { lost++; };
    for (const l of cv.listeners.get('webglcontextlost')!) l({ preventDefault: () => { prevented++; } } as unknown as Event);
    expect(lost).toBe(1);
    expect(prevented).toBe(1);
    v.resize(320, 240, 1);
    v.setInput(input());
    c.tick();
    expect(gl.calls.drawElements).toBeGreaterThan(5);
    expect(gl.calls.createBuffer).toBe(3 * gl.calls.createVertexArray);
    v.dispose();
    expect(gl.calls.deleteBuffer).toBe(gl.calls.createBuffer);
    expect(gl.calls.deleteVertexArray).toBe(gl.calls.createVertexArray);
    expect(gl.lost).toBe(1);
    expect(cv.listeners.get('webglcontextlost')).toHaveLength(0);
  });
  it('the GL frame executes the plan: one draw per call, in order, with the deformation uniform on during a disruption', () => {
    const gl = mockGl({});
    const cv = new FakeCanvas();
    cv.gl = gl;
    const c = clock(true);
    const v = new Viewer3D(cv, 'webgl2', c.deps);
    v.resize(320, 240, 1);
    v.setInput(input({ disrupted: true }));
    c.tick();
    const scene = v.currentScene!;
    const plan = planDraws(scene, { ...IDLE_STATE });
    expect(gl.calls.drawElements).toBeGreaterThanOrEqual(plan.length);
    expect(v.stats.drawCalls).toBe(gl.calls.drawElements);
    expect(gl.def4.some((u: number[]) => u[3] === 1)).toBe(true);
    expect(gl.viewports.at(-1)).toEqual([0, 0, 320, 240]);
  });
});

describe('shaders and 2D painter', () => {
  it('the shaders declare what the renderer sets', () => {
    for (const name of ['u_vp', 'u_def', 'u_shift']) expect(VERTEX_SHADER).toContain(name);
    for (const name of ['u_eye', 'u_color', 'u_alpha', 'u_glow', 'u_mode']) expect(FRAGMENT_SHADER).toContain(name);
    expect(VERTEX_SHADER.startsWith('#version 300 es')).toBe(true);
    expect(FRAGMENT_SHADER.startsWith('#version 300 es')).toBe(true);
  });
  it('drawScene2D culls back faces of a closed shell (about half the triangles)', () => {
    const scene = buildScene(shape, { cutaway: false, coils: false, quality: 'minimal' });
    const cam = fitCamera(scene.center, scene.radius, 0);
    const outer = scene.items.filter((i) => i.kind === 'shell').at(-1)!;
    const call = { item: outer, label: 'x', blend: 'opaque' as const, shading: 'flat' as const, color: [1, 1, 1] as [number, number, number], alpha: 1, glow: 1, cull: true, deform: null };
    const total = outer.mesh.indices.length / 3;
    const ctx = new Ctx();
    const painted = drawScene2D(ctx, 400, 300, scene, [call], cam);
    expect(painted).toBeGreaterThan(0.3 * total);
    expect(painted).toBeLessThan(0.7 * total);
    const both = drawScene2D(new Ctx(), 400, 300, scene, [{ ...call, cull: false }], cam);
    expect(both).toBeGreaterThan(painted);
    expect(ctx.globalAlpha).toBe(1);
  });
  it('createGlRenderer rejects a context that cannot create a shader', () => {
    const gl = mockGl({ noShader: true });
    expect(() => createGlRenderer(gl as unknown as WebGL2RenderingContext)).toThrow(Viz3DUnavailable);
  });
  it('createGlRenderer rejects a program that does not link', () => {
    const gl = mockGl({ linkOk: false });
    expect(() => createGlRenderer(gl as unknown as WebGL2RenderingContext)).toThrow(/link failed/);
  });
});

interface MockOpts { compileOk?: boolean; linkOk?: boolean; noShader?: boolean }
/** a WebGL2 context that records what the renderer does with it */
function mockGl(o: MockOpts) {
  const calls: Record<string, number> = {
    drawElements: 0, createBuffer: 0, deleteBuffer: 0, createVertexArray: 0, deleteVertexArray: 0,
  };
  const uniform4f: number[][] = [];
  const viewports: number[][] = [];
  let lost = 0;
  const noop = () => undefined;
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6, STATIC_DRAW: 7,
    FLOAT: 8, TRIANGLES: 9, UNSIGNED_INT: 10, DEPTH_TEST: 11, BLEND: 12, CULL_FACE: 13, BACK: 14, LEQUAL: 15, SRC_ALPHA: 16, ONE: 17,
    ONE_MINUS_SRC_ALPHA: 18, COLOR_BUFFER_BIT: 19, DEPTH_BUFFER_BIT: 20,
    calls, def4: uniform4f, viewports,
    get lost() { return lost; },
    createShader: () => (o.noShader ? null : {}),
    shaderSource: noop, compileShader: noop, deleteShader: noop, attachShader: noop, linkProgram: noop, deleteProgram: noop, useProgram: noop,
    getShaderParameter: () => o.compileOk !== false,
    getShaderInfoLog: () => 'boom',
    createProgram: () => ({}),
    getProgramParameter: () => o.linkOk !== false,
    getProgramInfoLog: () => 'nolink',
    getUniformLocation: (_p: unknown, n: string) => n,
    createVertexArray: () => { calls.createVertexArray++; return {}; },
    deleteVertexArray: () => { calls.deleteVertexArray++; },
    createBuffer: () => { calls.createBuffer++; return {}; },
    deleteBuffer: () => { calls.deleteBuffer++; },
    bindVertexArray: noop, bindBuffer: noop, bufferData: noop, enableVertexAttribArray: noop, vertexAttribPointer: noop,
    viewport: (...a: number[]) => { viewports.push(a); },
    clearColor: noop, clearDepth: noop, clear: noop, depthMask: noop, enable: noop, disable: noop, depthFunc: noop, cullFace: noop, blendFunc: noop,
    uniformMatrix4fv: noop, uniform3f: noop, uniform1f: noop, uniform1i: noop,
    uniform4f: (...a: unknown[]) => { uniform4f.push(a.slice(1) as number[]); },
    uniform2f: noop,
    drawElements: () => { calls.drawElements++; },
    getExtension: (n: string) => (n === 'WEBGL_lose_context' ? { loseContext: () => { lost++; } } : null),
  };
  return gl;
}

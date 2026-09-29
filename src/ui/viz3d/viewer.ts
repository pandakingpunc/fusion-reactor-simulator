/**
 * The controller of the 3D view: it owns the camera, builds the scene when the shape changes, plans and draws frames (WebGL2, or
 * the canvas 2D fallback), and animates the disruption and the auto-rotation. No React here, no timers of its own: the clock and the
 * animation-frame scheduler are injected, so the whole thing runs in Node against a fake canvas.
 *
 * Drawing is on demand: a frame is scheduled when something changed (new input, camera, size) and keeps itself going only while an
 * animation runs, so an idle 3D view costs no CPU or GPU.
 */
import { OrbitCamera, fitCamera, orbit, pan, worldPerPixel, zoom } from './camera';
import { GlRenderer, Viz3DUnavailable, createGlRenderer } from './gl';
import { IDLE_STATE, SceneState, planDraws } from './materials';
import { DISRUPTION_MS, TempModel, disruptionLook } from './palette';
import { Ctx2D, drawScene2D } from './raster2d';
import { DEFAULT_CUT_CENTRE, Quality, Scene3D, SceneShape, buildScene } from './scene';

export type ViewerMode = 'webgl2' | '2d';

export interface ViewerInput {
  shape: SceneShape;
  temp: TempModel;
  hmode: boolean;
  /** ELM flash 0..1 */
  elmFlash: number;
  /** the shot ended in a disruption */
  disrupted: boolean;
}

export interface ViewerToggles { cutaway: boolean; coils: boolean; autoRotate: boolean }

export interface ViewerDeps {
  /** milliseconds */
  now(): number;
  raf(cb: (t: number) => void): number;
  caf(id: number): void;
  /** jump to end states instead of animating (prefers-reduced-motion) */
  reducedMotion: boolean;
}

export function browserDeps(): ViewerDeps {
  let reduced = false;
  try { reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* no matchMedia */ }
  return { now: () => performance.now(), raf: (cb) => requestAnimationFrame(cb), caf: (id) => cancelAnimationFrame(id), reducedMotion: reduced };
}

/** the part of an HTMLCanvasElement the viewer uses */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: string, options?: unknown): unknown;
  addEventListener(type: string, listener: (e: Event) => void): void;
  removeEventListener(type: string, listener: (e: Event) => void): void;
}

interface Backend {
  readonly mode: ViewerMode;
  quality: Quality;
  setScene(scene: Scene3D): void;
  draw(scene: Scene3D, state: SceneState, camera: OrbitCamera, cssW: number, cssH: number, dpr: number): void;
  readonly stats: { drawCalls: number; triangles: number };
  dispose(): void;
}

class GlBackend implements Backend {
  readonly mode = 'webgl2' as const;
  quality: Quality = 'high';
  private readonly r: GlRenderer;
  private readonly onLostEvent: (e: Event) => void;
  constructor(private readonly canvas: CanvasLike, onLost: () => void) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'default' }) as WebGL2RenderingContext | null;
    if (!gl) throw new Viz3DUnavailable('WebGL2 is not available', 'no-webgl2');
    try { this.r = createGlRenderer(gl); } catch (e) { gl.getExtension?.('WEBGL_lose_context')?.loseContext(); throw e; }
    this.onLostEvent = (e) => { e.preventDefault(); onLost(); };
    canvas.addEventListener('webglcontextlost', this.onLostEvent);
  }
  get stats() { return this.r.stats; }
  setScene(scene: Scene3D) { this.r.setScene(scene); }
  draw(scene: Scene3D, state: SceneState, camera: OrbitCamera, cssW: number, cssH: number, dpr: number) {
    this.r.render(planDraws(scene, state), camera, Math.round(cssW * dpr), Math.round(cssH * dpr));
  }
  dispose() { this.canvas.removeEventListener('webglcontextlost', this.onLostEvent); this.r.dispose(); }
}

class CanvasBackend implements Backend {
  readonly mode = '2d' as const;
  quality: Quality = 'minimal';
  readonly stats = { drawCalls: 0, triangles: 0 };
  private readonly ctx: Ctx2D & { setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void };
  constructor(canvas: CanvasLike) {
    const ctx = canvas.getContext('2d') as (Ctx2D & { setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void }) | null;
    if (!ctx) throw new Viz3DUnavailable('no canvas 2D context', 'no-webgl2');
    this.ctx = ctx;
  }
  setScene() { /* nothing to upload */ }
  draw(scene: Scene3D, state: SceneState, camera: OrbitCamera, cssW: number, cssH: number, dpr: number) {
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const plan = planDraws(scene, state);
    this.stats.triangles = drawScene2D(this.ctx, cssW, cssH, scene, plan, camera);
    this.stats.drawCalls = plan.length;
  }
  dispose() { /* the canvas belongs to the caller */ }
}

/** radians per pixel of a drag */
const ORBIT_RAD_PER_PX = 0.008;
/** auto-rotation speed [rad/s] */
const SPIN_RAD_PER_S = 0.25;
/** flux surfaces of an equilibrium arrive with every Grad-Shafranov update; rebuild the meshes at most this often [ms] */
export const MIN_REBUILD_MS = 250;

const shapeKey = (s: SceneShape) => `${s.method}|${s.R}|${s.a}|${s.kappa}|${s.delta}|${s.gap}|${s.coilThickness}`;

export class Viewer3D {
  readonly mode: ViewerMode;
  /** called when the graphics context is lost (WebGL2 only); the owner should switch to the 2D fallback */
  onContextLost: (() => void) | null = null;
  /** called after the meshes were (re)built, with the new scene */
  onSceneBuilt: ((scene: Scene3D) => void) | null = null;

  private readonly backend: Backend;
  private readonly deps: ViewerDeps;
  private input: ViewerInput | null = null;
  private toggles: ViewerToggles = { cutaway: true, coils: true, autoRotate: false };
  private scene: Scene3D | null = null;
  private builtFor: { eq: unknown; key: string; cutaway: boolean; coils: boolean } | null = null;
  private lastBuild = -Infinity;
  private cam: OrbitCamera | null = null;
  private fitKey = '';
  private cssW = 300;
  private cssH = 300;
  private dpr = 1;
  private raf = 0;
  private lastTs = 0;
  private disruptStart: number | null = null; // null: not disrupted, -Infinity: settled, else wall-clock start
  private disposed = false;

  /** @throws Viz3DUnavailable when `mode` is 'webgl2' and the context cannot draw */
  constructor(private readonly canvas: CanvasLike, mode: ViewerMode, deps: ViewerDeps = browserDeps()) {
    this.deps = deps;
    this.mode = mode;
    this.backend = mode === 'webgl2' ? new GlBackend(canvas, () => this.onContextLost?.()) : new CanvasBackend(canvas);
  }

  get camera(): OrbitCamera | null { return this.cam; }
  get currentScene(): Scene3D | null { return this.scene; }
  get stats(): { drawCalls: number; triangles: number } { return this.backend.stats; }

  setInput(input: ViewerInput): void {
    const wasDisrupted = this.input?.disrupted ?? false;
    if (input.disrupted && !wasDisrupted) this.disruptStart = this.input === null || this.deps.reducedMotion ? -Infinity : this.deps.now();
    else if (!input.disrupted) this.disruptStart = null;
    this.input = input;
    this.requestRender();
  }

  setToggles(t: ViewerToggles): void {
    this.toggles = t;
    this.requestRender();
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = Math.max(1, cssW); this.cssH = Math.max(1, cssH); this.dpr = Math.max(1, Math.min(2, dpr));
    this.canvas.width = Math.round(this.cssW * this.dpr); this.canvas.height = Math.round(this.cssH * this.dpr);
    this.requestRender();
  }

  resetView(): void {
    if (this.scene) this.cam = fitCamera(this.scene.center, this.scene.radius, DEFAULT_CUT_CENTRE);
    this.requestRender();
  }

  orbitBy(dxPx: number, dyPx: number): void {
    if (!this.cam) return;
    this.cam = orbit(this.cam, -dxPx * ORBIT_RAD_PER_PX, dyPx * ORBIT_RAD_PER_PX);
    this.requestRender();
  }

  zoomBy(factor: number): void {
    if (!this.cam || !this.scene) return;
    this.cam = zoom(this.cam, factor, 0.35 * this.scene.radius, 8 * this.scene.radius);
    this.requestRender();
  }

  panBy(dxPx: number, dyPx: number): void {
    if (!this.cam || !this.scene) return;
    this.cam = pan(this.cam, dxPx, dyPx, worldPerPixel(this.cam, this.cssH), this.scene.center, this.scene.radius);
    this.requestRender();
  }

  requestRender(): void {
    if (this.disposed || this.raf) return;
    this.raf = this.deps.raf(this.frame);
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf) this.deps.caf(this.raf);
    this.raf = 0;
    this.backend.dispose();
  }

  /** Build the scene now if the shape, the equilibrium or a toggle changed (and, for an equilibrium alone, not too recently). */
  private ensureScene(now: number): boolean {
    const inp = this.input;
    if (!inp) return false;
    const key = shapeKey(inp.shape), eq = inp.shape.eq ?? null;
    const b = this.builtFor;
    const same = !!b && b.key === key && b.cutaway === this.toggles.cutaway && b.coils === this.toggles.coils;
    if (this.scene && same && b!.eq === eq) return true;
    // the flux surfaces alone changed (an equilibrium update): throttle; anything else rebuilds at once
    if (this.scene && same && now - this.lastBuild < MIN_REBUILD_MS) return true;
    this.scene = buildScene(inp.shape, { cutaway: this.toggles.cutaway, coils: this.toggles.coils, quality: this.backend.quality });
    this.backend.setScene(this.scene);
    this.builtFor = { eq, key, cutaway: this.toggles.cutaway, coils: this.toggles.coils };
    this.lastBuild = now;
    this.onSceneBuilt?.(this.scene);
    if (!this.cam || this.fitKey !== key) { this.cam = fitCamera(this.scene.center, this.scene.radius, DEFAULT_CUT_CENTRE); this.fitKey = key; }
    return true;
  }

  private readonly frame = (ts: number): void => {
    this.raf = 0;
    if (this.disposed || !this.input) return;
    const now = this.deps.now();
    if (!this.ensureScene(now) || !this.scene || !this.cam) return;
    const inp = this.input;
    const dt = this.lastTs ? Math.min(0.1, Math.max(0, (ts - this.lastTs) / 1000)) : 0;
    this.lastTs = ts;
    let animating = false;
    if (this.toggles.autoRotate && !this.deps.reducedMotion) { this.cam = orbit(this.cam, dt * SPIN_RAD_PER_S, 0); animating = true; }
    let elapsed: number | null = null;
    if (this.disruptStart !== null) {
      elapsed = this.disruptStart === -Infinity ? Infinity : now - this.disruptStart;
      if (elapsed < DISRUPTION_MS) animating = true;
    }
    const state: SceneState = { ...IDLE_STATE, temp: inp.temp, hmode: inp.hmode, elmFlash: inp.elmFlash, disruption: disruptionLook(elapsed) };
    this.backend.draw(this.scene, state, this.cam, this.cssW, this.cssH, this.dpr);
    // a throttled equilibrium rebuild is still pending: come back for it
    const pending = !!this.builtFor && this.builtFor.eq !== (inp.shape.eq ?? null);
    if (animating || pending) this.requestRender();
    else this.lastTs = 0;
  };
}

/**
 * The 2D fallback of the 3D view, for browsers without WebGL2 (or after the graphics context is lost): the same scene, frame plan
 * and camera, projected and painted with the canvas 2D API. Triangles are sorted far to near (painter's algorithm) and
 * shaded flat, so it is a coarse picture of the same thing, built from a low-detail scene ('minimal' quality).
 */
import { OrbitCamera, transformPoint, viewProjection } from './camera';
import { DrawCall, applyDeform } from './materials';
import type { Scene3D } from './scene';

/** the part of CanvasRenderingContext2D the fallback uses (so that tests can pass a recorder) */
export interface Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
}

interface Tri { depth: number; x: number[]; y: number[]; style: string; alpha: number; op: GlobalCompositeOperation }

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

/** The light of a lit surface: the fixed key direction of the fragment shader (the fallback has no per-pixel eye vector). */
const KEY: readonly [number, number, number] = (() => { const l = Math.hypot(0.45, -0.55, 0.7); return [0.45 / l, -0.55 / l, 0.7 / l]; })();

/**
 * Paint the plan into the canvas of width x height CSS pixels (the caller sets the transform for the device pixel ratio).
 * Returns the number of polygons painted.
 */
export function drawScene2D(ctx: Ctx2D, width: number, height: number, scene: Scene3D, plan: readonly DrawCall[], camera: OrbitCamera, background = '#0b0e14'): number {
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  const vp = viewProjection(camera, width / Math.max(1, height), scene.radius);
  const tris: Tri[] = [];

  for (const call of plan) {
    const { positions: P, indices: I } = call.item.mesh;
    const nv = P.length / 3;
    const sx = new Float32Array(nv), sy = new Float32Array(nv), sz = new Float32Array(nv), ok = new Uint8Array(nv);
    const wx = new Float32Array(nv), wy = new Float32Array(nv), wz = new Float32Array(nv);
    for (let v = 0; v < nv; v++) {
      let x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
      if (call.deform) [x, y, z] = applyDeform(x, y, z, call.deform);
      wx[v] = x; wy[v] = y; wz[v] = z;
      const c = transformPoint(vp, [x, y, z]);
      if (c[3] <= 1e-6) continue; // behind the camera
      sx[v] = (0.5 + 0.5 * c[0] / c[3]) * width;
      sy[v] = (0.5 - 0.5 * c[1] / c[3]) * height;
      sz[v] = c[2] / c[3];
      ok[v] = 1;
    }
    const op: GlobalCompositeOperation = call.blend === 'additive' ? 'lighter' : 'source-over';
    const alpha = call.blend === 'opaque' ? 1 : Math.min(1, call.alpha * (call.blend === 'additive' ? 1.6 : 1));
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      if (!ok[a] || !ok[b] || !ok[c]) continue;
      // screen-space winding: y points down, so an outward (counter-clockwise on screen) face has a negative signed area here
      const area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a]);
      if (call.cull && area >= 0) continue;
      let shade = 1;
      if (call.shading === 'lit') {
        const ux = wx[b] - wx[a], uy = wy[b] - wy[a], uz = wz[b] - wz[a], vx = wx[c] - wx[a], vy = wy[c] - wy[a], vz = wz[c] - wz[a];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        shade = 0.35 + 0.65 * Math.abs(nx * KEY[0] + ny * KEY[1] + nz * KEY[2]);
      }
      const k = call.shading === 'lit' ? shade : call.glow;
      tris.push({
        depth: (sz[a] + sz[b] + sz[c]) / 3,
        x: [sx[a], sx[b], sx[c]], y: [sy[a], sy[b], sy[c]],
        style: `rgb(${byte(call.color[0] * k)},${byte(call.color[1] * k)},${byte(call.color[2] * k)})`,
        alpha, op,
      });
    }
  }

  tris.sort((p, q) => q.depth - p.depth); // far first
  for (const t of tris) {
    ctx.globalAlpha = t.alpha;
    ctx.globalCompositeOperation = t.op;
    ctx.fillStyle = t.style;
    ctx.beginPath();
    ctx.moveTo(t.x[0], t.y[0]); ctx.lineTo(t.x[1], t.y[1]); ctx.lineTo(t.x[2], t.y[2]);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return tris.length;
}

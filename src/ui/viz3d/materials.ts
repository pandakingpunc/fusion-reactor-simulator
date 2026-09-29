/**
 * What is drawn, in which order and how: the frame plan shared by the WebGL renderer and the canvas fallback. Given the built
 * scene and the run's state (temperatures, H-mode, ELM flash, disruption) it lists one `DrawCall` per mesh, in draw order.
 * Pure, so the look of the plasma (colours per flux surface, the greying of a disruption, the orange ELM shell) is tested
 * without a GPU; the renderers only execute the plan.
 */
import type { Scene3D, SceneItem } from './scene';
import { DisruptionLook, NO_DISRUPTION, Rgb, TempModel, greyOut, mixRgb, plasmaColor } from './palette';

/** Everything about the run that changes the picture without changing the geometry. */
export interface SceneState {
  temp: TempModel;
  hmode: boolean;
  /** ELM flash 0..1 (simulated time, from the event log) */
  elmFlash: number;
  disruption: DisruptionLook;
}

export const IDLE_STATE: SceneState = { temp: { T0_keV: 0, alphaT: 1 }, hmode: false, elmFlash: 0, disruption: NO_DISRUPTION };

export type Blend = 'opaque' | 'alpha' | 'additive';
/** lit: diffuse and specular; glow: translucent plasma with bright rims; flat: unlit colour */
export type Shading = 'lit' | 'glow' | 'flat';

/** In-plane deformation of a plasma mesh about the axis (R, Z): scale by `squash`, then shift by (dR, dZ) [m]. */
export interface Deform { axisR: number; axisZ: number; squash: number; dR: number; dZ: number }

export interface DrawCall {
  item: SceneItem;
  /** what this call is, for tests and debugging */
  label: string;
  blend: Blend;
  shading: Shading;
  color: Rgb;
  alpha: number;
  /** brightness multiplier of glow and flat colours */
  glow: number;
  /** discard back faces */
  cull: boolean;
  deform: Deform | null;
}

export const COIL_COLOR: Rgb = [0.55, 0.62, 0.78];
export const VESSEL_COLOR: Rgb = [0.4, 0.55, 0.8];
export const VESSEL_CAP_COLOR: Rgb = [0.24, 0.29, 0.4];
export const XPOINT_COLOR: Rgb = [1, 0.82, 0.4];
export const ELM_COLOR: Rgb = [0.97, 0.59, 0.12];
export const PEDESTAL_COLOR: Rgb = [0.3, 0.79, 0.94];
const WHITE: Rgb = [1, 1, 1];
const DISRUPT_RED: Rgb = [0.94, 0.28, 0.44];

const plasmaDeform = (scene: Scene3D, st: SceneState, extra = 1): Deform | null => {
  const d = st.disruption;
  if (d.squash === 1 && d.dR === 0 && d.dZ === 0 && extra === 1) return null;
  return { axisR: scene.axis[0], axisZ: scene.axis[1], squash: d.squash * extra, dR: d.dR * scene.a, dZ: d.dZ * scene.a };
};

/** colour of a plasma mesh at rho: temperature colour, greyed and whitened by a disruption */
function plasmaTint(st: SceneState, rho: number): Rgb {
  let c = plasmaColor(st.temp, rho);
  c = greyOut(c, st.disruption.grey);
  return mixRgb(c, WHITE, Math.min(1, st.disruption.flash));
}

/** the draw calls of one frame, back to front where blending needs it: opaque, then the vessel, the plasma, the effects */
export function planDraws(scene: Scene3D, st: SceneState): DrawCall[] {
  const opaque: DrawCall[] = [], vessel: DrawCall[] = [], plasma: DrawCall[] = [], effects: DrawCall[] = [];
  const shells = scene.items.filter((i) => i.kind === 'shell');
  const outer = shells.length ? shells[shells.length - 1] : null;
  const def = plasmaDeform(scene, st);
  const glow = 1 + 3 * st.disruption.flash;

  for (const item of scene.items) {
    switch (item.kind) {
      case 'coil':
        opaque.push({ item, label: 'coils', blend: 'opaque', shading: 'lit', color: COIL_COLOR, alpha: 1, glow: 1, cull: false, deform: null });
        break;
      case 'vesselCap':
        opaque.push({ item, label: 'vessel wall', blend: 'opaque', shading: 'lit', color: VESSEL_CAP_COLOR, alpha: 1, glow: 1, cull: false, deform: null });
        break;
      case 'xpoint':
        opaque.push({ item, label: 'x-point ring', blend: 'opaque', shading: 'flat', color: XPOINT_COLOR, alpha: 1, glow: 1, cull: false, deform: null });
        break;
      case 'cap':
        opaque.push({ item, label: `cut ${item.k}`, blend: 'opaque', shading: 'flat', color: plasmaTint(st, item.rho), alpha: 1, glow: Math.min(glow, 1.6), cull: false, deform: def });
        break;
      case 'vessel':
        vessel.push({ item, label: 'vessel', blend: 'alpha', shading: 'lit', color: VESSEL_COLOR, alpha: 0.12, glow: 1, cull: false, deform: null });
        break;
      case 'shell': {
        const n = shells.length, frac = n > 1 ? item.k / (n - 1) : 1;
        // every surface adds light: a little for the cool edge, more for the hot core; the boundary carries the rim
        const alpha = item === outer ? 0.2 : 0.06 + 0.1 * (1 - frac);
        plasma.push({ item, label: `surface ${item.k}`, blend: 'additive', shading: 'glow', color: plasmaTint(st, item.rho), alpha, glow, cull: true, deform: def });
        break;
      }
    }
  }
  if (outer) {
    if (st.hmode && st.disruption.grey < 0.5) {
      effects.push({ item: outer, label: 'pedestal', blend: 'additive', shading: 'glow', color: PEDESTAL_COLOR, alpha: 0.28, glow: 1, cull: true, deform: def });
    }
    if (st.elmFlash > 0) {
      effects.push({
        item: outer, label: 'elm', blend: 'additive', shading: 'glow', color: ELM_COLOR, alpha: 0.75 * st.elmFlash, glow: 1.4, cull: true,
        deform: plasmaDeform(scene, st, 1 + 0.06 * st.elmFlash),
      });
    }
    if (st.disruption.rim > 0 && st.disruption.grey > 0.05) {
      effects.push({ item: outer, label: 'disruption rim', blend: 'additive', shading: 'glow', color: DISRUPT_RED, alpha: 0.3 * st.disruption.rim * st.disruption.grey, glow: 1, cull: true, deform: def });
    }
  }
  return [...opaque, ...vessel, ...plasma, ...effects];
}

/**
 * The deformation applied to a vertex, in JS for the canvas fallback and the tests. The vertex shader of gl.ts does exactly this:
 * the point keeps its toroidal angle, and its (R, Z) is scaled about the axis by `squash` and shifted by (dR, dZ).
 */
export function applyDeform(x: number, y: number, z: number, d: Deform): [number, number, number] {
  const R = Math.hypot(x, y);
  const R2 = Math.max(1e-3, d.axisR + d.squash * (R - d.axisR) + d.dR);
  const Z2 = d.axisZ + d.squash * (z - d.axisZ) + d.dZ;
  const k = R > 1e-9 ? R2 / R : 0;
  return [x * k, y * k, Z2];
}

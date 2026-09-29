/**
 * From the run screen's state to the 3D view's input: the same fields the 2D cross-section reads (geometry of the run, the latest
 * equilibrium and profile frames of a 1.5D run, the central temperature, H-mode, the ELM log), mapped to a `ViewerInput`.
 * Type-only imports of the run screen's types, so this module is as pure as the rest of the directory.
 */
import type { MagneticConfig, SimEvent } from '../../physics/types';
import type { SimMeta, UiFrame } from '../../worker/protocol';
import { elmFlashAt } from './palette';
import type { SceneShape } from './scene';
import type { ViewerInput } from './viewer';

export interface Viz3DSource {
  meta: SimMeta;
  cfg: MagneticConfig;
  /** the latest frame */
  last: UiFrame;
  events: readonly SimEvent[];
  /** the shot ended in a disruption */
  disrupted: boolean;
  /** 1.5D: latest frames that carry the equilibrium snapshot and the radial profiles */
  eqFrame: UiFrame | null;
  profFrame: UiFrame | null;
}

const METHODS = ['tokamak', 'spherical_tokamak', 'stellarator'] as const;

export function toViewerInput(s: Viz3DSource): ViewerInput {
  const g = s.meta.geometry;
  const is15 = (g.profiles ?? 0) > 0;
  const method = (METHODS as readonly string[]).includes(s.meta.method) ? (s.meta.method as SceneShape['method']) : 'tokamak';
  const prof = is15 && s.profFrame?.prof ? { rho: s.profFrame.prof.rho, Te: s.profFrame.prof.Te } : null;
  const shape: SceneShape = {
    R: g.R, a: g.a, kappa: g.kappa, delta: g.delta,
    gap: g.gap ?? 0.5, coilThickness: g.coilThickness ?? 0.5,
    method,
    // a stellarator has no Grad-Shafranov equilibrium; a 0D run has no flux surfaces beyond the Miller model
    eq: is15 && method !== 'stellarator' ? s.eqFrame?.eq ?? null : null,
  };
  return {
    shape,
    temp: { T0_keV: s.last.d.Ti0 ?? s.last.d.Ti ?? 0, alphaT: s.cfg.transport?.alpha_T ?? 1, prof },
    hmode: (s.last.d.H_mode ?? 0) > 0.5,
    elmFlash: elmFlashAt(s.events, s.last.t, s.meta.tEnd),
    disrupted: s.disrupted,
  };
}

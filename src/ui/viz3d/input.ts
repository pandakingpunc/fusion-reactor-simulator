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

function interpQ(rho: readonly number[], q: readonly number[], target: number): number | undefined {
  if (!rho.length || rho.length !== q.length) return undefined;
  if (target <= rho[0]) return q[0];
  for (let i = 1; i < rho.length; i++) {
    if (target <= rho[i]) {
      const span = rho[i] - rho[i - 1];
      const f = span > 0 ? (target - rho[i - 1]) / span : 0;
      return q[i - 1] + (q[i] - q[i - 1]) * f;
    }
  }
  return q[q.length - 1];
}

export function toViewerInput(s: Viz3DSource): ViewerInput {
  const g = s.meta.geometry;
  const is15 = (g.profiles ?? 0) > 0;
  const method = (METHODS as readonly string[]).includes(s.meta.method) ? (s.meta.method as SceneShape['method']) : 'tokamak';
  const prof = is15 && s.profFrame?.prof ? { rho: s.profFrame.prof.rho, Te: s.profFrame.prof.Te } : null;
  let qRaw: number | undefined;
  if (is15 && s.profFrame?.prof?.q && s.profFrame.prof.rho) qRaw = interpQ(s.profFrame.prof.rho, s.profFrame.prof.q, 0.78);
  if (!(Number.isFinite(qRaw) && (qRaw as number) > 0.2)) {
    const q95 = Number.isFinite(s.last.d.q95) && s.last.d.q95 > 0.5 ? s.last.d.q95
      : Number.isFinite(s.eqFrame?.eq?.q95) && s.eqFrame!.eq!.q95 > 0.5 ? s.eqFrame!.eq!.q95 : undefined;
    if (q95 !== undefined) qRaw = method === 'stellarator' ? q95 : 0.75 * q95;
  }
  const q = Number.isFinite(qRaw) && (qRaw as number) > 0.2 ? Math.round((qRaw as number) * 10) / 10 : undefined;
  const shape: SceneShape = {
    R: g.R, a: g.a, kappa: g.kappa, delta: g.delta,
    gap: g.gap ?? 0.5, coilThickness: g.coilThickness ?? 0.5,
    method,
    // a stellarator has no Grad-Shafranov equilibrium; a 0D run has no flux surfaces beyond the Miller model
    eq: is15 && method !== 'stellarator' ? s.eqFrame?.eq ?? null : null,
    ...(q !== undefined ? { q } : {}),
  };
  return {
    shape,
    temp: { T0_keV: s.last.d.Ti0 ?? s.last.d.Ti ?? 0, alphaT: s.cfg.transport?.alpha_T ?? 1, prof },
    hmode: (s.last.d.H_mode ?? 0) > 0.5,
    elmFlash: elmFlashAt(s.events, s.last.t, s.meta.tEnd),
    disrupted: s.disrupted,
  };
}

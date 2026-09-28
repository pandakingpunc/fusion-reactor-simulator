/**
 * Helpers of the 1.5D tests that step a model themselves.
 */
import type { MagneticConfig } from '../types';
import type { ProfileContext } from './context';
import { ProfileModel } from './model';

export const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
export const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

/**
 * Steps a model of `cfg` to tEnd and calls `fn` after every accepted step, before the equilibrium
 * update check: the diagnostics of the step and the geometry they were evaluated on. Returns the number of steps.
 */
export function stepChecks(cfg: MagneticConfig, tEnd: number, fn: (ctx: ProfileContext, d: Readonly<Record<string, number>>) => void): number {
  const m = new ProfileModel(cfg);
  const y = m.initialState();
  m.diagnostics(0, y);
  let n = 0;
  const check = m.coupling.check.bind(m.coupling);
  m.coupling.check = (ctx, t, yy, update) => { fn(ctx, ctx.lastDiag); n++; return check(ctx, t, yy, update); };
  let t = 0;
  while (t < tEnd && !m.terminated) { const t0 = t; t = m.step(t, y, cfg.t_end); m.postStep(t, t - t0, y); }
  return n;
}
